/**
 * Valores que atravessam a porta. Só os três tipos que o schema usa (`TEXT`, `INTEGER`,
 * `REAL`) mais `NULL`: booleanos viram `0`/`1` e datas viram texto antes de chegar aqui,
 * para que nenhum driver precise decidir uma conversão (database-design §3.9).
 */
export type SqlValue = string | number | null;

/**
 * Parâmetros nomeados, referenciados no SQL como `:nome`. Nomeados, e não posicionais,
 * porque as consultas de saldo repetem o mesmo valor em vários pontos e um `?` fora de
 * ordem produz um número errado em vez de um erro.
 */
export type SqlParams = Readonly<Record<string, SqlValue>>;

/** Uma linha devolvida pelo driver, ainda sem tipo de domínio. */
export type SqlRow = Readonly<Record<string, SqlValue>>;

/**
 * Porta estreita de acesso ao SQLite (database-design §3.3). O driver muda por plataforma
 * — `better-sqlite3` no desktop, `expo-sqlite` no mobile —, então o núcleo só enxerga isto
 * e cada plataforma escreve um adaptador fino, sem regra.
 *
 * É **síncrona** de propósito (backend-design §3.5): as duas pontas de uma escrita e o
 * recálculo de saldos precisam estar na mesma transação de banco, e com API síncrona nada
 * consegue intercalar um `await` no meio da transação de outro trecho de código.
 */
export interface Database {
    /**
     * Executa uma instrução que não devolve linhas (INSERT, UPDATE, PRAGMA de escrita).
     *
     * @param sql Uma única instrução SQL, com parâmetros `:nome`.
     * @param params Valores dos parâmetros nomeados.
     * @return Quantas linhas a instrução alterou; usado para detectar uma escrita que não
     * encontrou a linha esperada.
     */
    run(sql: string, params?: SqlParams): { readonly changes: number };

    /**
     * @param sql Uma consulta SQL, com parâmetros `:nome`.
     * @param params Valores dos parâmetros nomeados.
     * @return A primeira linha, ou `undefined` quando não há nenhuma.
     */
    get(sql: string, params?: SqlParams): SqlRow | undefined;

    /**
     * @param sql Uma consulta SQL, com parâmetros `:nome`.
     * @param params Valores dos parâmetros nomeados.
     * @return Todas as linhas, possivelmente nenhuma.
     */
    all(sql: string, params?: SqlParams): readonly SqlRow[];

    /**
     * Executa um script com várias instruções e sem parâmetros. Existe para as migrations,
     * que são arquivos `.sql` inteiros.
     *
     * @param sql Script SQL completo.
     * @return void
     */
    exec(sql: string): void;

    /**
     * Executa `fn` numa transação: confirma no retorno e desfaz em qualquer exceção.
     * Recebe uma função síncrona porque a porta é síncrona por inteiro.
     *
     * @param fn Trabalho a executar atomicamente.
     * @return O que `fn` devolveu.
     */
    transaction<T>(fn: () => T): T;
}
