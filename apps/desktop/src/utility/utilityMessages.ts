import type { StartupStatus } from '../shared/bridge.ts';
import type { DatabaseExportOutcome } from './exportDatabase.ts';
import type { DatabaseImportPreparation } from './importDatabase.ts';

/** Mensagens do processo principal ao processo do núcleo. */
export type MainToUtilityMessage =
    /** Acompanha uma ponta de `MessageChannelMain` ligada a uma janela recém-carregada. */
    | { readonly kind: 'connect' }
    /** Fecha a conexão com o banco antes de o principal restaurar um backup sobre o arquivo. */
    | { readonly kind: 'close-database' }
    /**
     * Grava a cópia exportada no destino escolhido no diálogo de salvar. `requestId` casa a
     * resposta com o pedido: o processo do núcleo responde pela mesma porta das outras mensagens.
     */
    | { readonly kind: 'export-database'; readonly requestId: number; readonly destination: string }
    /**
     * Confere a cópia escolhida no diálogo de abrir e a grava em `staged`, ao lado do banco,
     * antes de o principal fechar o banco e trocá-lo por ela. `requestId` como na exportação.
     */
    | { readonly kind: 'prepare-import'; readonly requestId: number; readonly source: string; readonly staged: string };

/** Mensagens do processo do núcleo ao processo principal. */
export type UtilityToMainMessage =
    | { readonly kind: 'startup'; readonly status: StartupStatus }
    | { readonly kind: 'database-closed' }
    | { readonly kind: 'database-exported'; readonly requestId: number; readonly outcome: DatabaseExportOutcome }
    | { readonly kind: 'import-prepared'; readonly requestId: number; readonly outcome: DatabaseImportPreparation };

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
