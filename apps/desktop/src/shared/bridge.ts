import type { CoreClient } from '@finance/client';

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
    | { readonly kind: 'ready' }
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

/**
 * Tudo o que o preload expõe ao renderer (desktop-shell-design §3.6): o `CoreClient`, as
 * preferências do aparelho, o estado da abertura com a única ação que ele pede, o aviso de
 * falha fatal e o relato de problema. Nenhuma função genérica de IPC, `fs` ou `shell` — o
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
} as const;
