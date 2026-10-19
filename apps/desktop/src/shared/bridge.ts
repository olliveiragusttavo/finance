import type { CoreClient, MappingTemplate } from '@finance/client';

/** Tema escolhido no aparelho; `system` acompanha o sistema operacional. */
export type ThemePreference = 'system' | 'light' | 'dark';

/**
 * Preferências do **aparelho**, não do perfil: ficam num JSON em `userData`, fora do banco,
 * porque no banco seriam replicadas pela sincronização para o celular (desktop-mvp-plan §2).
 */
export interface DevicePreferences {
    readonly theme: ThemePreference;
    /** Perfil aberto por último; `null` antes do primeiro uso. */
    readonly lastProfileId: string | null;
    /** Último mês de referência aberto, `YYYY-MM`; `null` abre no mês atual. */
    readonly lastPeriod: string | null;
}

/**
 * Como terminou a abertura do banco no `utilityProcess` (backend-design §4.5). Só `ready`
 * deixa o app seguir; as outras viram telas de bloqueio, porque abrir mesmo assim produziria
 * número errado ou gravaria num banco pela metade.
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

/** Resultado de restaurar o backup na tela de falha de migration. */
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

/**
 * Falha que derruba o app em funcionamento e vem de fora do renderer: o processo do núcleo
 * que terminou ou uma exceção não tratada no processo principal.
 */
export interface FatalFailure {
    readonly source: 'core-process' | 'main-process';
    /** Texto técnico, para a tela de erro e para o relato. */
    readonly message: string;
}

/** Para onde o relato de problema é enviado. */
export type ReportChannel = 'github' | 'email';

/** O que a tela de relato manda ao processo principal; validado lá, porque vem do renderer. */
export interface ProblemReport {
    /** Título do erro, que vira o título da issue ou o assunto do e-mail. */
    readonly title: string;
    /** Mensagem e detalhes técnicos do erro (pilha, código). */
    readonly details: string;
    /** O que o usuário estava fazendo, nas palavras dele; pode ficar vazio. */
    readonly description: string;
    /** Se o fim dos arquivos de log entra no relato. */
    readonly includeLog: boolean;
}

/** Resultado de abrir o relato no navegador ou no programa de e-mail. */
export type ReportResult =
    /** `logTruncated`: o log foi cortado para caber no limite do endereço. */
    | { readonly ok: true; readonly logTruncated: boolean }
    | { readonly ok: false };

/** O que Ajustes mostra sobre o app e o arquivo do banco (desktop-mvp-plan Fase 13). */
export interface AppInfo {
    /** Versão do app, a do `package.json`. */
    readonly appVersion: string;
    /** `user_version` do banco aberto; `null` quando a abertura bloqueou. */
    readonly schemaVersion: number | null;
    /** Caminho do `finance.sqlite`, só para leitura: o renderer nunca escolhe caminho. */
    readonly databasePath: string;
    /** Instante (ISO 8601, UTC) da última cópia exportada neste aparelho; `null` antes da primeira. */
    readonly lastExportAt: string | null;
}

/** Resultado de exportar uma cópia do banco. */
export type DatabaseExportResult =
    /** `file`: onde a cópia foi gravada; `exportedAt`: o instante registrado como última cópia. */
    | { readonly ok: true; readonly file: string; readonly exportedAt: string }
    /**
     * `canceled`: o usuário fechou o diálogo de salvar. `same-as-database`: o destino escolhido é
     * o próprio banco, que a cópia substituiria. `write-failed`: o disco recusou a gravação.
     * `unavailable`: o núcleo não está com o banco aberto (caiu ou bloqueou).
     */
    | { readonly ok: false; readonly reason: DatabaseExportFailure };

/** Por que uma exportação não gravou a cópia. */
export type DatabaseExportFailure = 'canceled' | 'same-as-database' | 'write-failed' | 'unavailable';

/** Resultado de importar uma cópia do banco no lugar do atual. */
export type DatabaseImportResult =
    /**
     * `file`: a cópia importada, como escolhida no diálogo; `previousCopy`: onde ficou o banco que
     * saiu do lugar, para o usuário voltar a ele se escolheu a cópia errada.
     */
    | { readonly ok: true; readonly file: string; readonly previousCopy: string }
    | { readonly ok: false; readonly reason: DatabaseImportFailure }
    /**
     * A troca falhou e não foi possível devolver o banco ao lugar: ele está em `failedCopy`. O
     * app fica bloqueado até alguém resolver, como na restauração de backup.
     */
    | { readonly ok: false; readonly reason: 'database-moved'; readonly failedCopy: string };

/**
 * Por que uma importação não trocou o banco. `canceled`: o usuário fechou o diálogo de abrir.
 * `same-as-database`: o arquivo escolhido é o próprio banco do app. `unreadable`: não é SQLite ou
 * está corrompido. `not-app-database`: é SQLite, mas não deste app. `newer-than-app`: é de uma
 * versão mais nova do app. `write-failed`: o disco recusou o arquivo provisório. `unavailable`:
 * o núcleo não está com o banco aberto. `core-busy`: o núcleo não liberou o banco a tempo.
 * `io-error`: o disco recusou a troca, e tudo foi desfeito. Em todos, o banco é o de antes.
 */
export type DatabaseImportFailure =
    | 'canceled'
    | 'same-as-database'
    | 'unreadable'
    | 'not-app-database'
    | 'newer-than-app'
    | 'write-failed'
    | 'unavailable'
    | 'core-busy'
    | 'io-error';

/** Arquivo escolhido para importar (desktop-mvp-plan Fase 13.1). */
export type ImportFileResult =
    /** `name`: só o nome-base, para a tela; o caminho fica no processo principal. */
    | { readonly ok: true; readonly name: string; readonly size: number; readonly bytes: Uint8Array }
    /**
     * `canceled`: o usuário fechou o diálogo. `too-large`: passa do limite de leitura.
     * `read-failed`: o disco recusou a leitura.
     */
    | { readonly ok: false; readonly reason: 'canceled' | 'too-large' | 'read-failed' };

/**
 * Tamanho máximo do nome de um modelo de mapeamento. Fica na ponte, que os dois processos usam,
 * para que a tela limite o campo e corte o nome sugerido pelo mesmo número que o processo
 * principal valida; com números diferentes, o nome sugerido seria recusado ao salvar.
 */
export const TEMPLATE_NAME_MAX_LENGTH = 60;

/**
 * Tudo o que o preload expõe ao renderer (desktop-shell-design §3.6): o `CoreClient`, as
 * preferências do aparelho, o estado da abertura com a única ação que ele pede, o aviso de
 * falha fatal, o relato de problema e as ações de Ajustes sobre o arquivo do banco. Nenhuma função genérica de IPC, `fs` ou `shell` — o
 * renderer é tratado como entrada não confiável, e por isso o relato não recebe endereço
 * algum dele, só texto.
 */
export interface FinanceBridge {
    readonly core: CoreClient;
    readonly preferences: {
        /** @return As preferências salvas, ou as padrão quando o arquivo falta ou é inválido. */
        get(): Promise<DevicePreferences>;
        /**
         * @param patch Campos a mudar; validados no processo principal.
         * @return As preferências como ficaram gravadas.
         */
        update(patch: Partial<DevicePreferences>): Promise<DevicePreferences>;
    };
    readonly startup: {
        /** @return O estado da abertura, esperando o `utilityProcess` terminar de abrir o banco. */
        status(): Promise<StartupStatus>;
        /**
         * Restaura a cópia de antes da migration que falhou. Só vale na tela de bloqueio da
         * migration; o processo principal recusa em qualquer outro estado.
         *
         * @return O backup restaurado e onde ficou a cópia do banco que falhou.
         */
        restoreBackup(): Promise<RestoreResult>;
    };
    readonly failures: {
        /**
         * @param listener Avisado quando o núcleo cai ou o processo principal falha.
         * @return Função que cancela o aviso.
         */
        onFatal(listener: (failure: FatalFailure) => void): () => void;
    };
    readonly about: {
        /** @return As versões, o caminho do banco e a data da última cópia exportada. */
        info(): Promise<AppInfo>;
    };
    readonly database: {
        /**
         * Pergunta o destino no diálogo de salvar do sistema e grava ali uma cópia do banco. O
         * caminho é escolhido no processo principal, e não recebido do renderer, pelo mesmo
         * motivo do relato: o renderer não pode mandar gravar em lugar nenhum.
         *
         * @return Onde a cópia ficou e quando, ou por que não foi gravada.
         */
        exportCopy(): Promise<DatabaseExportResult>;
        /**
         * Pergunta a cópia no diálogo de abrir do sistema e a põe no lugar do banco atual, que vai
         * para a pasta de backups. O caminho é escolhido no processo principal, como na
         * exportação. Quando o banco chega a ser fechado, o processo principal reabre o núcleo e
         * recarrega as janelas, e o resultado fica guardado para `takeImportNotice`: a resposta
         * desta chamada pode não chegar a uma tela que já recarregou.
         *
         * @return Onde ficou o banco anterior, ou por que a cópia não foi importada.
         */
        importCopy(): Promise<DatabaseImportResult>;
        /**
         * @return O resultado da importação que recarregou as janelas, uma vez só; `null` quando
         * não há aviso pendente.
         */
        takeImportNotice(): Promise<DatabaseImportResult | null>;
        /** Abre a pasta do banco no gerenciador de arquivos, com o arquivo selecionado. */
        showInFolder(): Promise<void>;
    };
    readonly importFile: {
        /**
         * Pergunta o arquivo no diálogo de abrir do sistema e devolve o conteúdo. O caminho é
         * escolhido e lido no processo principal: o renderer recebe os bytes e o nome, nunca um
         * caminho que pudesse mandar ler de novo.
         *
         * @return O arquivo, ou por que não foi lido.
         */
        open(): Promise<ImportFileResult>;
        /** @return Os modelos de mapeamento salvos neste aparelho, do mais antigo ao mais novo. */
        templates(): Promise<readonly MappingTemplate[]>;
        /**
         * @param template Modelo a salvar; substitui o de mesmo nome. Validado no processo principal.
         * @return Os modelos como ficaram gravados.
         */
        saveTemplate(template: MappingTemplate): Promise<readonly MappingTemplate[]>;
    };
    readonly report: {
        /** @return O fim dos logs como entraria no relato, para o usuário ver antes de enviar. */
        logTail(): Promise<string>;
        /**
         * Abre a issue pré-preenchida no navegador ou o e-mail no programa padrão. O endereço é
         * montado no processo principal, com destino fixo: o renderer manda só o texto.
         *
         * @param channel Destino escolhido.
         * @param report Conteúdo do relato.
         * @return Se o destino abriu e se o log precisou ser cortado.
         */
        send(channel: ReportChannel, report: ProblemReport): Promise<ReportResult>;
    };
}

/** Nome da propriedade de `window` onde o preload publica a ponte. */
export const BRIDGE_KEY = 'finance';

/** Canais de IPC entre o preload e o processo principal; fora daqui nenhum é aceito. */
export const IPC_CHANNELS = {
    corePort: 'core:port',
    coreClosed: 'core:closed',
    preferencesGet: 'preferences:get',
    preferencesUpdate: 'preferences:update',
    startupStatus: 'startup:status',
    startupRestore: 'startup:restore-backup',
    mainFailed: 'main:failed',
    reportLogTail: 'report:log-tail',
    reportSend: 'report:send',
    aboutInfo: 'about:info',
    databaseExport: 'database:export',
    databaseImport: 'database:import',
    databaseImportNotice: 'database:import-notice',
    databaseShowInFolder: 'database:show-in-folder',
    importOpenFile: 'import:open-file',
    importTemplates: 'import:templates',
    importSaveTemplate: 'import:save-template',
} as const;
