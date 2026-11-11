import { DirectCoreClient, type CoreCallScheduler, type CoreClient } from '@finance/client';
import { openCoreSequence, SystemClock, type RestoreResult, type StartupStatus } from '@finance/client/startup';
import type { Clock } from '@finance/core';
import { databaseLocation, openExpoDatabase } from '@finance/sqlite-expo/open';
import { Paths } from 'expo-file-system';
import { expoFileSystem, type AppFileSystem } from '../platform/AppFileSystem.ts';
import { ExpoIdGenerator, FileAppLog } from '../platform/systemAdapters.ts';
import { databaseFiles, fileMarkers } from './databaseFiles.ts';
import { restoreBackup } from './restoreBackup.ts';

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
    const { status } = outcome;
    return {
        status,
        client: outcome.core === null ? null : new DirectCoreClient(outcome.core, afterFrame),
        close: outcome.close,
        restore: () => {
            if (status.kind !== 'migrationFailed' || status.backupFile === null) {
                return { ok: false, reason: 'not-blocked' };
            }
            outcome.close();
            const result = restoreBackup(files, paths, status.backupFile, backupInstant(clock));
            log.write(result.ok ? 'info' : 'error', 'database.restore', { ...result });
            return result;
        },
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
