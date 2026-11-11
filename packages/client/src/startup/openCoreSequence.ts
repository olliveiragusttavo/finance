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
    type Database,
    type IdGenerator,
    type MigrationReport,
    type OpenDatabaseOptions,
} from '@finance/core';

/**
 * Estado da abertura do banco, o mesmo nos dois shells: cada estado de bloqueio tem uma tela
 * própria, e o desktop e o celular precisam bloquear pelos mesmos motivos (mobile-mvp-plan,
 * Fase 4).
 */
export type StartupStatus =
    /** `schemaVersion`: o `user_version` do banco depois de migrar, mostrado em Ajustes. */
    | { readonly kind: 'ready'; readonly schemaVersion: number }
    /** O banco é de uma versão mais nova do app (backend-design §4.8). */
    | { readonly kind: 'schemaNewerThanApp'; readonly databaseVersion: number; readonly appVersion: number }
    /** Uma migration falhou e foi desfeita; `backupFile` é a cópia de antes, quando há uma. */
    | { readonly kind: 'migrationFailed'; readonly backupFile: string | null }
    /** A cópia de segurança falhou, e por isso nada foi migrado: o banco continua intacto. */
    | { readonly kind: 'backupFailed' }
    /** O arquivo não pôde ser aberto (corrompido, sem permissão). */
    | { readonly kind: 'openFailed' }
    /**
     * Uma restauração de backup começou e não terminou (o app caiu no meio, ou o disco recusou
     * desfazê-la). O banco não é aberto: abrir criaria um arquivo vazio no lugar, e os dados
     * ficariam esquecidos em `failedCopy`.
     */
    | { readonly kind: 'restoreIncomplete'; readonly failedCopy: string | null }
    /** Falha não prevista depois de migrar (montar o núcleo, verificar a integridade). */
    | { readonly kind: 'unexpected' };

/** Resultado de restaurar o backup na tela de falha de migration, nos dois shells. */
export type RestoreResult =
    | { readonly ok: true; readonly restoredFrom: string; readonly failedCopy: string }
    /**
     * `io-error`: o disco recusou uma etapa e tudo foi desfeito, o banco está no lugar.
     * `core-busy`: o processo do núcleo não liberou o banco a tempo; nada foi tocado.
     */
    | { readonly ok: false; readonly reason: 'no-backup' | 'not-blocked' | 'io-error' | 'core-busy' }
    /**
     * A restauração falhou e não foi possível devolver o banco ao lugar: ele está em
     * `failedCopy`. O app fica bloqueado até alguém resolver, em vez de abrir um banco vazio.
     */
    | { readonly ok: false; readonly reason: 'database-moved'; readonly failedCopy: string };

/** Gravidade de uma linha do log da abertura. */
export type StartupLogLevel = 'info' | 'warn' | 'error';

/**
 * Onde a abertura registra o que aconteceu. Porta porque cada shell grava num lugar (arquivo
 * do processo do núcleo no desktop, arquivo no diretório do app no celular), e o app sem
 * terminal só tem esse registro para explicar um bloqueio.
 */
export interface StartupLog {
    /**
     * @param level Gravidade.
     * @param event Nome estável do evento (`integrity.drift`), para filtrar o arquivo.
     * @param data Dados serializáveis do evento.
     */
    write(level: StartupLogLevel, event: string, data?: Readonly<Record<string, unknown>>): void;
}

/** O que a marca de migration que falhou guarda: o backup de antes da primeira tentativa. */
export interface MigrationFailureMarker {
    /** Backup gravado na primeira tentativa que falhou; `null` quando o banco era novo. */
    readonly backupFile: string | null;
}

/** O que a marca de restauração guarda: onde ficou o banco tirado do lugar. */
export interface RestoreMarker {
    /** Cópia do banco que falhou; `null` quando a marca não pôde ser lida. */
    readonly failedCopy: string | null;
}

/**
 * As marcas que sobrevivem entre aberturas. Porta porque são arquivos ao lado do banco, e o
 * disco é de cada plataforma; a regra de quando ler, gravar e apagar cada uma é a desta
 * sequência.
 */
export interface StartupMarkers {
    /** @return A restauração pela metade, ou `null` quando nenhuma está em andamento. */
    readRestore(): RestoreMarker | null;
    /** @return A falha de migration lembrada, ou `null`. */
    readMigrationFailure(): MigrationFailureMarker | null;
    /**
     * @param marker Backup a lembrar até a migration passar ou o backup ser restaurado.
     * @throws {unknown} Quando o disco recusa; a sequência registra e segue.
     */
    writeMigrationFailure(marker: MigrationFailureMarker): void;
    /** @throws {unknown} Quando o disco recusa; a sequência registra e segue. */
    clearMigrationFailure(): void;
}

/** Banco aberto pelo adaptador da plataforma, que o shell fecha antes de restaurar um backup. */
export interface ClosableDatabase extends Database {
    close(): void;
}

/** O que a abertura precisa da plataforma. */
export interface StartupPorts<D extends ClosableDatabase> {
    /**
     * Abre (ou cria) o arquivo do banco.
     *
     * @return A conexão aberta.
     * @throws {unknown} Quando o arquivo não abre; vira o bloqueio `openFailed`.
     */
    readonly openDatabase: () => D;
    /** Pasta `backups/` ao lado do banco (backend-design §4.6). */
    readonly backups: BackupDirectory;
    readonly markers: StartupMarkers;
    readonly clock: Clock;
    readonly ids: IdGenerator;
    readonly log: StartupLog;
    /** Migrations embutidas; parametrizável só para testar a falha de migration. */
    readonly migrations?: OpenDatabaseOptions['migrations'];
}

/** O núcleo aberto, ou o motivo de não ter aberto. */
export type StartupOutcome<D extends ClosableDatabase> =
    | { readonly status: Extract<StartupStatus, { readonly kind: 'ready' }>; readonly core: Core; readonly database: D; readonly close: () => void }
    /** Em qualquer bloqueio a conexão já está fechada: nada no banco pode ser lido nem gravado. */
    | { readonly status: Exclude<StartupStatus, { readonly kind: 'ready' }>; readonly core: null; readonly database: null; readonly close: () => void };

/**
 * A sequência de abertura dos dois shells (backend-design §4.5): abrir o arquivo, migrar com
 * backup, montar o núcleo com as portas da plataforma, verificar a integridade e completar as
 * recorrências. Mora no `client`, e não em cada shell, porque é regra — quando bloquear e com
 * qual tela — e o celular precisa bloquear pelos mesmos motivos do desktop (mobile-mvp-plan,
 * Fase 4). Cada falha vira um `StartupStatus` de bloqueio em vez de exceção, porque o shell
 * precisa continuar vivo para dizer ao usuário o que aconteceu.
 *
 * Antes de tudo, uma restauração de backup interrompida bloqueia sem abrir o arquivo: o driver
 * criaria um banco vazio no lugar do que saiu, e o app abriria como se fosse o primeiro uso,
 * com os dados esquecidos na pasta de backups.
 *
 * Uma migration que falha deixa uma marca com o backup da tentativa, e as aberturas seguintes
 * oferecem esse mesmo backup e o protegem da rotação até a migration passar ou o backup ser
 * restaurado (`rememberedFailure`): as migrations anteriores à que falhou ficam aplicadas, e o
 * backup de uma nova tentativa já não serviria à versão anterior do app.
 *
 * A verificação de integridade só registra os desvios, sem bloquear nem corrigir
 * (desktop-mvp-plan Fase 0): corrigir em silêncio esconderia o bug que causou o desvio. Já a
 * verificação que não consegue rodar bloqueia, porque aí ninguém sabe se o banco está são.
 *
 * O complemento das recorrências vem por último (database-design §4.12), porque escreve no
 * banco. A série que falha só vai para o log: bloquear repetiria a mesma falha em toda
 * abertura, sem o usuário chegar à tela para corrigir a série. Já o complemento que nem
 * consegue rodar bloqueia, como qualquer etapa.
 *
 * @param ports Banco, pasta de backups, marcas, relógio, ids e log da plataforma.
 * @return O núcleo pronto com a conexão, ou o estado de bloqueio com a conexão já fechada.
 */
export async function openCoreSequence<D extends ClosableDatabase>(ports: StartupPorts<D>): Promise<StartupOutcome<D>> {
    const { log, markers } = ports;
    const pendingRestore = markers.readRestore();
    if (pendingRestore !== null) {
        log.write('error', 'database.restore-incomplete', { ...pendingRestore });
        return blocked({ kind: 'restoreIncomplete', failedCopy: pendingRestore.failedCopy });
    }
    let database: D;
    try {
        database = ports.openDatabase();
    } catch (error: unknown) {
        log.write('error', 'database.open-failed', { error });
        return blocked({ kind: 'openFailed' });
    }
    const close = (): void => {
        database.close();
    };

    const before = new Set(ports.backups.list());
    const failure = markers.readMigrationFailure();
    const kept = failure?.backupFile ?? null;
    const rotation = kept !== null && before.has(kept) ? new KeepingBackupDirectory(ports.backups, kept) : ports.backups;
    let report: MigrationReport;
    try {
        report = openDatabase(database, { backups: rotation, clock: ports.clock, ...(ports.migrations === undefined ? {} : { migrations: ports.migrations }) });
        log.write('info', 'database.opened', { ...report });
    } catch (error: unknown) {
        close();
        const createdBackup = newestBackup(ports.backups.list().filter((fileName) => !before.has(fileName)));
        const status = rememberedFailure(failureStatus(error, createdBackup), failure, before, ports);
        log.write('error', 'database.migration-blocked', { status, error });
        return blocked(status);
    }
    if (failure !== null) {
        try {
            markers.clearMigrationFailure();
        } catch (error: unknown) {
            log.write('warn', 'database.migration-marker-clear-failed', { error });
        }
    }

    try {
        const core = createCore({
            database,
            clock: ports.clock,
            ids: ports.ids,
            onUnexpectedError: (error) => {
                log.write('error', 'core.unexpected', { error });
            },
        });
        const integrity = await core.call('integrity.verifyBalances', {});
        if (!integrity.ok) {
            close();
            log.write('error', 'integrity.failed', { error: integrity.error });
            return blocked({ kind: 'unexpected' });
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
            return blocked({ kind: 'unexpected' });
        }
        // Uma série que falha não bloqueia: o banco está íntegro, só a previsão dela fica incompleta.
        if (topUp.data.failures.length > 0) {
            log.write('warn', 'recurrences.top-up-partial', { emitted: topUp.data.emitted, failures: topUp.data.failures });
        } else {
            log.write('info', 'recurrences.topped-up', { emitted: topUp.data.emitted });
        }
        return { status: { kind: 'ready', schemaVersion: report.toVersion }, core, database, close };
    } catch (error: unknown) {
        close();
        log.write('error', 'core.start-failed', { error });
        return blocked({ kind: 'unexpected' });
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
function failureStatus(error: unknown, createdBackup: string | null): Exclude<StartupStatus, { readonly kind: 'ready' }> {
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
 * @param ports Marcas e log, para gravar a marca e registrar se ela não pôde ser gravada.
 * @return O estado com o backup da primeira falha; o próprio `status` quando não é falha de
 * migration ou quando não há marca utilizável — e então a marca é gravada com o backup atual.
 */
function rememberedFailure(
    status: Exclude<StartupStatus, { readonly kind: 'ready' }>,
    failure: MigrationFailureMarker | null,
    before: ReadonlySet<string>,
    ports: Pick<StartupPorts<ClosableDatabase>, 'markers' | 'log'>,
): Exclude<StartupStatus, { readonly kind: 'ready' }> {
    if (status.kind !== 'migrationFailed') {
        return status;
    }
    if (failure !== null && (failure.backupFile === null || before.has(failure.backupFile))) {
        return { kind: 'migrationFailed', backupFile: failure.backupFile };
    }
    try {
        ports.markers.writeMigrationFailure({ backupFile: status.backupFile });
    } catch (error: unknown) {
        ports.log.write('warn', 'database.migration-marker-write-failed', { error });
    }
    return status;
}

/**
 * Pasta de backups que esconde da rotação a cópia guardada pela marca de migration que falhou.
 * Sem isso, cada nova abertura com falha grava um backup e, depois de três, a rotação
 * (backend-design §4.6) apagaria justamente a cópia de antes da atualização — a única que a
 * versão anterior do app consegue abrir. Fica nesta sequência, e não na rotação do núcleo,
 * porque é a marca do shell que sabe qual cópia proteger; enquanto ela existir, a pasta guarda
 * até quatro cópias.
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
 * @return O resultado sem núcleo nem conexão; fechar não faz nada, porque a conexão já foi
 * fechada (ou nem chegou a abrir).
 */
function blocked<D extends ClosableDatabase>(status: Exclude<StartupStatus, { readonly kind: 'ready' }>): StartupOutcome<D> {
    return { status, core: null, database: null, close: () => undefined };
}
