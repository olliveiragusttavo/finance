import type { StartupStatus } from '../shared/bridge.ts';

/** Mensagens do processo principal ao processo do núcleo. */
export type MainToUtilityMessage =
    /** Acompanha uma ponta de `MessageChannelMain` ligada a uma janela recém-carregada. */
    | { readonly kind: 'connect' }
    /** Fecha a conexão com o banco antes de o principal restaurar um backup sobre o arquivo. */
    | { readonly kind: 'close-database' };

/** Mensagens do processo do núcleo ao processo principal. */
export type UtilityToMainMessage =
    | { readonly kind: 'startup'; readonly status: StartupStatus }
    | { readonly kind: 'database-closed' };

/** Argumento de linha de comando com a pasta de dados do app. */
const USER_DATA_FLAG = '--user-data=';

/**
 * Monta os argumentos do `utilityProcess.fork`. A pasta vai por argumento porque o processo
 * do núcleo não tem o `app.getPath` do Electron.
 *
 * @param userData Pasta `userData` do app.
 * @return Os argumentos.
 */
export function utilityArguments(userData: string): readonly string[] {
    return [`${USER_DATA_FLAG}${userData}`];
}

/**
 * @param argv `process.argv` do processo do núcleo.
 * @return A pasta de dados.
 * @throws {Error} Quando o argumento falta — erro de montagem do processo principal, que
 * precisa aparecer na hora em vez de abrir um banco num lugar qualquer.
 */
export function parseUtilityArguments(argv: readonly string[]): { readonly userData: string } {
    const flag = argv.find((arg) => arg.startsWith(USER_DATA_FLAG));
    if (flag === undefined || flag.length === USER_DATA_FLAG.length) {
        throw new Error(`Processo do núcleo iniciado sem ${USER_DATA_FLAG}`);
    }
    return { userData: flag.slice(USER_DATA_FLAG.length) };
}
