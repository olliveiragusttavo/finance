import {
    createCore,
    MigrationBackupError,
    MigrationFailedError,
    MigrationIntegrityError,
    newestBackup,
    openDatabase,
    SchemaNewerThanAppError,
    type BackupDirectory,
    type Clock,
    type Core,
    type IdGenerator,
    type OpenDatabaseOptions,
} from '@finance/core';
import { BetterSqliteDatabase, NodeBackupDirectory } from '@finance/sqlite-better';
import type { StartupStatus } from '../shared/bridge.ts';
import {
    clearMigrationFailureMarker,
    readMigrationFailureMarker,
    readRestoreMarker,
    writeMigrationFailureMarker,
    type MigrationFailureMarker,
} from './databaseFiles.ts';
import type { Log } from './FileLog.ts';

/** O que a abertura precisa do processo hospedeiro. */
export interface OpenCoreOptions {
    /** `userData/finance.sqlite`. */
    readonly databasePath: string;
    /** `userData/backups`, ao lado do banco (backend-design §4.6). */
    readonly backupsPath: string;
    /** Marca de restauração pela metade; enquanto existir, o banco não é aberto. */
    readonly restoreMarkerPath: string;
    /** Marca do backup de antes da primeira migration que falhou; ver `rememberedFailure`. */
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
}

/**
 * A sequência de abertura do desktop (backend-design §4.5): abrir o arquivo, migrar com
 * backup, montar o núcleo com as portas reais, rodar a verificação de integridade e o
 * complemento das recorrências. Cada
 * falha vira um `StartupStatus` de bloqueio em vez de exceção, porque o processo do núcleo
 * precisa continuar vivo para dizer à janela o que aconteceu. Qualquer erro bloqueia — exceto a
 * falha de uma série no complemento, abaixo: o app só segue com o banco aberto, migrado e
 * verificado.
 *
 * Antes de tudo, uma restauração de backup interrompida bloqueia sem abrir o arquivo: o
 * `better-sqlite3` criaria um banco vazio no lugar do que saiu, e o app abriria como se fosse
 * o primeiro uso, com os dados esquecidos na pasta de backups.
 *
 * Uma migration que falha deixa uma marca com o backup da tentativa, e as aberturas seguintes
 * oferecem esse mesmo backup e o protegem da rotação até a migration passar ou o backup ser
 * restaurado (`rememberedFailure`): as migrations anteriores à que falhou ficam aplicadas, e o backup de
 * uma nova tentativa já não serviria à versão anterior do app.
 *
 * A verificação de integridade só registra os desvios no log, sem bloquear nem corrigir
 * (desktop-mvp-plan Fase 0): corrigir em silêncio esconderia o bug que causou o desvio. Já a
 * verificação que não consegue rodar bloqueia, porque aí ninguém sabe se o banco está são.
 *
 * O complemento das recorrências vem por último (backend-design §4.5; database-design §4.12):
 * estende as séries fixas até 12 meses à frente de hoje, para que o previsto dos próximos meses
 * esteja completo assim que o app abre. Só depois da verificação, porque escreve no banco. Cada
 * série é complementada à parte, e a que falha só vai para o log: o banco continua íntegro, e
 * bloquear repetiria a mesma falha em toda abertura, sem o usuário chegar à tela para corrigir
 * a série. Já o complemento que nem consegue rodar bloqueia, como qualquer etapa.
 *
 * @param options Caminhos, portas e log.
 * @return O núcleo pronto, ou o estado de bloqueio com a conexão já fechada.
 */
export async function openCore(options: OpenCoreOptions): Promise<OpenedCore> {
    const { log } = options;
    const pendingRestore = readRestoreMarker(options.restoreMarkerPath);
    if (pendingRestore !== null) {
        log.write('error', 'database.restore-incomplete', { ...pendingRestore });
        return blocked({ kind: 'restoreIncomplete', failedCopy: pendingRestore.failedCopy }, () => undefined);
    }
    let database: BetterSqliteDatabase;
    try {
        database = BetterSqliteDatabase.open(options.databasePath);
    } catch (error) {
        log.write('error', 'database.open-failed', { error });
        return blocked({ kind: 'openFailed' }, () => undefined);
    }
    const close = (): void => {
        database.close();
    };

    const backups = new NodeBackupDirectory(options.backupsPath);
    const before = new Set(backups.list());
    const failure = readMigrationFailureMarker(options.migrationFailureMarkerPath);
    const kept = failure?.backupFile ?? null;
    const rotation = kept !== null && before.has(kept) ? new KeepingBackupDirectory(backups, kept) : backups;
    try {
        const report = openDatabase(database, { backups: rotation, clock: options.clock, ...(options.migrations === undefined ? {} : { migrations: options.migrations }) });
        log.write('info', 'database.opened', { ...report });
    } catch (error) {
        close();
        const createdBackup = newestBackup(backups.list().filter((fileName) => !before.has(fileName)));
        const status = rememberedFailure(failureStatus(error, createdBackup), failure, before, options);
        log.write('error', 'database.migration-blocked', { status, error });
        return blocked(status, () => undefined);
    }
    if (failure !== null) {
        try {
            clearMigrationFailureMarker(options.migrationFailureMarkerPath);
        } catch (error) {
            log.write('warn', 'database.migration-marker-clear-failed', { error });
        }
    }

    try {
        const core = createCore({
            database,
            clock: options.clock,
            ids: options.ids,
            onUnexpectedError: (error) => {
                log.write('error', 'core.unexpected', { error });
            },
        });
        const integrity = await core.call('integrity.verifyBalances', {});
        if (!integrity.ok) {
            close();
            log.write('error', 'integrity.failed', { error: integrity.error });
            return blocked({ kind: 'unexpected' }, () => undefined);
        }
        if (integrity.data.drifts.length > 0) {
            log.write('warn', 'integrity.drift', { checkedAccounts: integrity.data.checkedAccounts, drifts: integrity.data.drifts });
        } else {
            log.write('info', 'integrity.ok', { checkedAccounts: integrity.data.checkedAccounts });
        }
        const topUp = await core.call('recurrences.topUp', {});
        if (!topUp.ok) {
            close();
            log.write('error', 'recurrences.top-up-failed', { error: topUp.error });
            return blocked({ kind: 'unexpected' }, () => undefined);
        }
        // Uma série que falha não bloqueia: o banco está íntegro, só a previsão dela fica incompleta.
        if (topUp.data.failures.length > 0) {
            log.write('warn', 'recurrences.top-up-partial', { emitted: topUp.data.emitted, failures: topUp.data.failures });
        } else {
            log.write('info', 'recurrences.topped-up', { emitted: topUp.data.emitted });
        }
        return { status: { kind: 'ready' }, core, close };
    } catch (error) {
        close();
        log.write('error', 'core.start-failed', { error });
        return blocked({ kind: 'unexpected' }, () => undefined);
    }
}

/**
 * Classifica a falha da abertura na tela de bloqueio certa. A migration que falhou é
 * reconhecida pelo tipo do erro, e não pela existência de backup: banco novo não tem backup
 * (backend-design §4.6), e a falha da primeira migration seria tomada por arquivo corrompido.
 *
 * @param error O que `openDatabase` lançou.
 * @param createdBackup Backup gravado nesta tentativa; só existe se a migration chegou a
 * começar num banco com dados, e é ele que a tela oferece para restaurar.
 * @return O estado de bloqueio. Erro de SQLite fora de migration e sem backup novo é arquivo
 * que não abre (corrompido, sem permissão).
 */
function failureStatus(error: unknown, createdBackup: string | null): StartupStatus {
    if (error instanceof SchemaNewerThanAppError) {
        return { kind: 'schemaNewerThanApp', databaseVersion: numberDetail(error, 'databaseVersion'), appVersion: numberDetail(error, 'appVersion') };
    }
    if (error instanceof MigrationBackupError) {
        return { kind: 'backupFailed' };
    }
    if (error instanceof MigrationFailedError || error instanceof MigrationIntegrityError || createdBackup !== null) {
        return { kind: 'migrationFailed', backupFile: createdBackup };
    }
    return { kind: 'openFailed' };
}

/**
 * Mantém na tela o backup de antes da primeira tentativa que falhou. Cada migration roda na
 * própria transação (backend-design §4.5, passo 4), então as anteriores à que falhou ficam
 * aplicadas: um banco na v3 com as migrations 4 e 5, falhando na 5, fica na v4. A abertura
 * seguinte grava `pre-v4-…`, que a versão anterior do app — que só conhece até a v3 — recusaria
 * por ser mais novo. Por isso a primeira falha grava uma marca com o seu backup, e as
 * seguintes oferecem esse, enquanto ele ainda estiver na pasta.
 *
 * @param status Estado de bloqueio calculado para esta tentativa.
 * @param failure Marca de uma falha anterior; `null` quando esta é a primeira.
 * @param before Backups presentes antes desta tentativa, para saber se o da marca ainda existe.
 * @param options Caminho da marca e log, para registrar se ela não pôde ser gravada.
 * @return O estado com o backup da primeira falha; o próprio `status` quando não é falha de
 * migration ou quando não há marca utilizável — e então a marca é gravada com o backup atual.
 */
function rememberedFailure(status: StartupStatus, failure: MigrationFailureMarker | null, before: ReadonlySet<string>, options: OpenCoreOptions): StartupStatus {
    if (status.kind !== 'migrationFailed') {
        return status;
    }
    if (failure !== null && (failure.backupFile === null || before.has(failure.backupFile))) {
        return { kind: 'migrationFailed', backupFile: failure.backupFile };
    }
    try {
        writeMigrationFailureMarker(options.migrationFailureMarkerPath, { backupFile: status.backupFile });
    } catch (error) {
        options.log.write('warn', 'database.migration-marker-write-failed', { error });
    }
    return status;
}

/**
 * Pasta de backups que esconde da rotação a cópia guardada pela marca de migration que falhou.
 * Sem isso, cada nova abertura com falha grava um backup e, depois de três, a rotação
 * (backend-design §4.6) apagaria justamente a cópia de antes da atualização — a única que a
 * versão anterior do app consegue abrir. Fica no shell, e não na rotação do núcleo, porque
 * é a marca do shell que sabe qual cópia proteger; enquanto ela existir, a pasta guarda até
 * quatro cópias.
 */
class KeepingBackupDirectory implements BackupDirectory {
    /**
     * @param directory Pasta real, que grava e apaga os arquivos.
     * @param kept Backup que a rotação não pode ver nem apagar.
     */
    public constructor(
        private readonly directory: BackupDirectory,
        private readonly kept: string,
    ) {}

    /**
     * @param fileName Nome do backup.
     * @return O caminho completo, como na pasta real.
     */
    public pathOf(fileName: string): string {
        return this.directory.pathOf(fileName);
    }

    /**
     * @return Os arquivos da pasta, sem o backup protegido, para que a rotação não o conte
     * entre os três mais recentes nem o descarte.
     */
    public list(): readonly string[] {
        return this.directory.list().filter((fileName) => fileName !== this.kept);
    }

    /**
     * @param fileName Arquivo a apagar.
     */
    public remove(fileName: string): void {
        if (fileName !== this.kept) {
            this.directory.remove(fileName);
        }
    }
}

/**
 * @param error Erro do núcleo com detalhes estruturados.
 * @param key Detalhe numérico procurado.
 * @return O número, ou zero se o detalhe faltar — a tela ainda bloqueia, só sem a versão.
 */
function numberDetail(error: SchemaNewerThanAppError, key: string): number {
    const value = error.details[key];
    return typeof value === 'number' ? value : 0;
}

/**
 * @param status Estado de bloqueio.
 * @param close O que fechar; a conexão já foi fechada em quase todos os casos.
 * @return O resultado sem núcleo.
 */
function blocked(status: StartupStatus, close: () => void): OpenedCore {
    return { status, core: null, close };
}
