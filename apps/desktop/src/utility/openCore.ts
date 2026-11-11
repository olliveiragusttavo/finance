import type { Clock, Core, IdGenerator, OpenDatabaseOptions } from '@finance/core';
import { openCoreSequence, type StartupMarkers } from '@finance/client/startup';
import { BetterSqliteDatabase, NodeBackupDirectory } from '@finance/sqlite-better';
import type { StartupStatus } from '../shared/bridge.ts';
import { clearMigrationFailureMarker, readMigrationFailureMarker, readRestoreMarker, writeMigrationFailureMarker } from './databaseFiles.ts';
import { exportDatabaseFile, type DatabaseExportOutcome } from './exportDatabase.ts';
import type { Log } from './FileLog.ts';

/** O que a abertura precisa do processo hospedeiro. */
export interface OpenCoreOptions {
    /** `userData/finance.sqlite`. */
    readonly databasePath: string;
    /** `userData/backups`, ao lado do banco (backend-design §4.6). */
    readonly backupsPath: string;
    /** Marca de restauração pela metade; enquanto existir, o banco não é aberto. */
    readonly restoreMarkerPath: string;
    /** Marca do backup de antes da primeira migration que falhou. */
    readonly migrationFailureMarkerPath: string;
    readonly clock: Clock;
    readonly ids: IdGenerator;
    readonly log: Log;
    /** Migrations embutidas; parametrizável só para testar a falha de migration. */
    readonly migrations?: OpenDatabaseOptions['migrations'];
}

/** O núcleo aberto, ou o motivo de não ter aberto. */
export interface OpenedCore {
    readonly status: StartupStatus;
    /** `null` em qualquer estado de bloqueio: nada no banco pode ser lido nem gravado. */
    readonly core: Core | null;
    /** Fecha a conexão; o processo principal pede antes de restaurar um backup. */
    close(): void;
    /**
     * Grava a cópia exportada do banco (desktop-mvp-plan Fase 13).
     *
     * @param destination Arquivo escolhido no diálogo de salvar do processo principal.
     * @return `ok`, ou o motivo da recusa; `unavailable` em qualquer estado de bloqueio, em que
     * não há conexão aberta para copiar.
     */
    exportCopy(destination: string): DatabaseExportOutcome;
}

/**
 * A abertura do desktop: a sequência compartilhada com o celular (`openCoreSequence`, no
 * `client`), sobre o `better-sqlite3` e as marcas em arquivo de `userData`. Aqui fica só o
 * que é do desktop — onde as marcas moram e a exportação da cópia, que precisa do caminho do
 * arquivo; as regras de quando bloquear e com qual tela são as da sequência.
 *
 * @param options Caminhos, portas e log.
 * @return O núcleo pronto, ou o estado de bloqueio com a conexão já fechada.
 */
export async function openCore(options: OpenCoreOptions): Promise<OpenedCore> {
    const outcome = await openCoreSequence({
        openDatabase: () => BetterSqliteDatabase.open(options.databasePath),
        backups: new NodeBackupDirectory(options.backupsPath),
        markers: fileMarkers(options),
        clock: options.clock,
        ids: options.ids,
        log: options.log,
        ...(options.migrations === undefined ? {} : { migrations: options.migrations }),
    });
    const database = outcome.database;
    if (database === null) {
        return { status: outcome.status, core: null, close: outcome.close, exportCopy: () => ({ ok: false, reason: 'unavailable' }) };
    }
    return {
        status: outcome.status,
        core: outcome.core,
        close: outcome.close,
        exportCopy: (destination) => {
            const exported = exportDatabaseFile(database, options.databasePath, destination);
            options.log.write(exported.ok ? 'info' : 'warn', 'database.exported', { ...exported });
            return exported;
        },
    };
}

/**
 * @param options Caminhos das duas marcas.
 * @return As marcas da abertura sobre os arquivos JSON de `userData`.
 */
function fileMarkers(options: Pick<OpenCoreOptions, 'restoreMarkerPath' | 'migrationFailureMarkerPath'>): StartupMarkers {
    return {
        readRestore: () => readRestoreMarker(options.restoreMarkerPath),
        readMigrationFailure: () => readMigrationFailureMarker(options.migrationFailureMarkerPath),
        writeMigrationFailure: (marker) => {
            writeMigrationFailureMarker(options.migrationFailureMarkerPath, marker);
        },
        clearMigrationFailure: () => {
            clearMigrationFailureMarker(options.migrationFailureMarkerPath);
        },
    };
}
