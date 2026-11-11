import { DirectCoreClient, type CoreCallScheduler, type CoreClient } from '@finance/client';
import { openCoreSequence, SystemClock, type RestoreResult, type StartupStatus } from '@finance/client/startup';
import { copyDatabaseTo, inspectDatabaseCopy, type Clock, type Database } from '@finance/core';
import { fileUriToPath } from '@finance/sqlite-expo';
import { databaseLocation, openExpoDatabase, openExpoDatabaseFile } from '@finance/sqlite-expo/open';
import { Paths } from 'expo-file-system';
import { expoFileSystem, joinUri, type AppFileSystem } from '../platform/AppFileSystem.ts';
import { ExpoIdGenerator, FileAppLog } from '../platform/systemAdapters.ts';
import { BENCHMARK_ENABLED, scheduleBenchmark } from './benchmark.ts';
import { replaceWithCopy, type DatabaseCopies } from './databaseCopy.ts';
import { databaseFiles, fileMarkers } from './databaseFiles.ts';
import { restoreBackup } from './restoreBackup.ts';
import { markCoreOpened } from './startupTiming.ts';

/** O app aberto, ou o motivo de não ter aberto, com o que as telas de bloqueio podem fazer. */
export interface MobileStartup {
    readonly status: StartupStatus;
    /** O núcleo como as telas o enxergam; `null` em qualquer bloqueio. */
    readonly client: CoreClient | null;
    /** Fecha a conexão; chamado antes de restaurar e quando a raiz desmonta. */
    readonly close: () => void;
    /**
     * Restaura o backup oferecido pelo bloqueio de migration que falhou.
     *
     * @return O resultado; `not-blocked` em qualquer outro estado.
     */
    readonly restore: () => RestoreResult;
    /** Exportar e importar a cópia do banco e o log, para Ajustes; `null` em qualquer bloqueio. */
    readonly copies: DatabaseCopies | null;
}

/**
 * Agenda a chamada para depois do frame corrente (mobile-shell-design §4.3): o
 * `requestAnimationFrame` espera o frame que vai ser desenhado, e o `setTimeout` seguinte roda
 * depois dele. Assim o retorno visual do toque já está na tela quando a thread JavaScript
 * para no SQLite. A ordem de chegada é mantida, porque as duas filas são FIFO.
 *
 * @param task Chamada ao núcleo.
 */
export const afterFrame: CoreCallScheduler = (task) => {
    requestAnimationFrame(() => {
        setTimeout(task, 0);
    });
};

/**
 * Raiz de composição do celular (mobile-mvp-plan, Fase 4): o único lugar do app que conhece o
 * núcleo e os adaptadores concretos. Abre `finance.sqlite` pelo `expo-sqlite`, roda a
 * sequência de abertura do `client` — a mesma do desktop — com a pasta de backups, as marcas e
 * o log no diretório do app, e entrega às telas só um `CoreClient` com agendamento pós-frame.
 * Marca o fim da abertura para a medição do tempo até a primeira tela, e, no APK de medição
 * (`EXPO_PUBLIC_BENCHMARK=1`), agenda a medição das chamadas interativas (Fase 5).
 *
 * @param files Disco do aparelho; trocado nos testes.
 * @param clock Relógio; trocado nos testes.
 * @return O app aberto, ou o bloqueio com a conexão já fechada.
 */
export async function openMobileCore(files: AppFileSystem = expoFileSystem, clock: Clock = new SystemClock()): Promise<MobileStartup> {
    const location = databaseLocation();
    const paths = databaseFiles(location.folder.uri, location.databaseFile.name, Paths.document.uri);
    const log = new FileAppLog(files, paths.logUri);
    const outcome = await openCoreSequence({
        openDatabase: () => {
            const opened = openExpoDatabase(location);
            log.write('info', 'database.sqlite-version', { version: opened.sqliteVersion });
            return opened.database;
        },
        backups: location.backups,
        markers: fileMarkers(files, paths),
        clock,
        ids: new ExpoIdGenerator(),
        log,
    });
    markCoreOpened();
    if (BENCHMARK_ENABLED && outcome.core !== null) {
        scheduleBenchmark(outcome.core, log);
    }
    const { status } = outcome;
    // Fechar duas vezes acontece de propósito: a importação fecha o banco, e a raiz fecha de
    // novo ao reabrir o núcleo. A segunda vez não faz nada.
    let closed = false;
    const close = (): void => {
        if (!closed) {
            closed = true;
            outcome.close();
        }
    };
    return {
        status,
        client: outcome.core === null ? null : new DirectCoreClient(outcome.core, afterFrame),
        close,
        copies: outcome.database === null ? null : databaseCopies({ database: outcome.database, files, paths, clock, log, close }),
        restore: () => {
            if (status.kind !== 'migrationFailed' || status.backupFile === null) {
                return { ok: false, reason: 'not-blocked' };
            }
            close();
            const result = restoreBackup(files, paths, status.backupFile, backupInstant(clock));
            log.write(result.ok ? 'info' : 'error', 'database.restore', { ...result });
            return result;
        },
    };
}

/**
 * Exportar e importar a cópia do banco (mobile-mvp-plan, Fase 18; mobile-shell-design §6.2). Fica
 * na raiz de composição porque só ela conhece o banco aberto e o núcleo: a exportação usa o
 * `copyDatabaseTo` — `VACUUM INTO`, nunca o arquivo vivo, que está em WAL — e a importação confere
 * a cópia pelo `inspectDatabaseCopy`, as mesmas regras do desktop, antes de fechar o banco.
 *
 * @param deps.database Banco aberto.
 * @param deps.files Disco do aparelho.
 * @param deps.paths Onde ficam o banco, os backups, as marcas e o log.
 * @param deps.clock Relógio, para o nome dos arquivos.
 * @param deps.log Log do app, que registra cada exportação e importação.
 * @param deps.close Fecha o banco antes da troca.
 * @return As operações de Ajustes.
 */
function databaseCopies(deps: {
    readonly database: Database;
    readonly files: AppFileSystem;
    readonly paths: ReturnType<typeof databaseFiles>;
    readonly clock: Clock;
    readonly log: FileAppLog;
    readonly close: () => void;
}): DatabaseCopies {
    const { database, files, paths, clock, log, close } = deps;
    return {
        exportCopy: () => {
            const fileName = `financas-${backupInstant(clock)}.sqlite`;
            const uri = joinUri(Paths.cache.uri, fileName);
            try {
                if (files.exists(uri)) {
                    files.remove(uri);
                }
                copyDatabaseTo(database, fileUriToPath(uri));
            } catch (error: unknown) {
                log.write('error', 'database.export', { message: error instanceof Error ? error.message : String(error) });
                return { ok: false, reason: 'write-failed' };
            }
            log.write('info', 'database.export', { fileName });
            return { ok: true, uri, fileName };
        },
        discard: (uri) => {
            try {
                files.remove(uri);
            } catch {
                // O sistema limpa o cache sozinho; sobrar a cópia não impede nada.
            }
        },
        importCopy: (uri, fileName) => {
            let inspection: ReturnType<typeof inspectDatabaseCopy>;
            try {
                const copy = openExpoDatabaseFile(uri);
                try {
                    inspection = inspectDatabaseCopy(copy);
                } finally {
                    copy.close();
                }
            } catch {
                inspection = { ok: false, reason: 'unreadable' };
            }
            if (!inspection.ok) {
                log.write('info', 'database.import', { result: inspection.reason });
                return { result: { ok: false, reason: inspection.reason }, closed: false };
            }
            close();
            const result = replaceWithCopy(files, paths, uri, fileName, backupInstant(clock));
            log.write(result.ok ? 'info' : 'error', 'database.import', { ...result });
            return { result, closed: true };
        },
        logUri: () => (files.exists(paths.logUri) ? paths.logUri : null),
    };
}

/**
 * @param clock Relógio do app.
 * @return O instante UTC no formato do nome da cópia do banco que falhou, `YYYYMMDD-HHMMSS`,
 * o mesmo do desktop.
 */
function backupInstant(clock: Clock): string {
    return clock.now().replace(/-/g, '').replace(' ', '-').replace(/:/g, '');
}
