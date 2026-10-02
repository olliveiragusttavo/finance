import BetterSqlite3 from 'better-sqlite3';

/*
 * Os tipos abaixo espelham a porta `Database` do `@finance/core` em vez de importá-la. O
 * adaptador é fino e não tem regra (backend-design §3.4), e o TypeScript é estrutural: a
 * suíte de contrato do `core` atribui esta classe a uma variável do tipo `Database`, então
 * qualquer divergência quebra a compilação lá. Importar a porta criaria um ciclo entre os
 * pacotes do workspace, já que o `core` usa este adaptador nos próprios testes.
 */
export type SqlValue = string | number | null;
export type SqlParams = Readonly<Record<string, SqlValue>>;
export type SqlRow = Readonly<Record<string, SqlValue>>;

/**
 * Adaptador da porta `Database` sobre o `better-sqlite3`: API síncrona madura, com
 * `transaction()`, e a mesma versão do SQLite embarcada em produção e nos testes
 * (backend-design §3.7).
 */
export class BetterSqliteDatabase {
    private readonly statements = new Map<string, BetterSqlite3.Statement>();

    /**
     * @param connection Conexão aberta; privada para que nenhum código use o driver por
     * fora da porta.
     */
    private constructor(private readonly connection: BetterSqlite3.Database) {}

    /**
     * @param filename Caminho do arquivo do banco, ou `:memory:` para os testes.
     * @return O adaptador sobre a conexão aberta. A configuração obrigatória
     * (`foreign_keys`, WAL) é aplicada pelo núcleo, num lugar só (database-design §3.2).
     */
    public static open(filename: string): BetterSqliteDatabase {
        return new BetterSqliteDatabase(new BetterSqlite3(filename));
    }

    /**
     * @param sql Uma instrução sem retorno de linhas.
     * @param params Parâmetros nomeados (`:nome`).
     * @return Quantas linhas foram alteradas.
     */
    public run(sql: string, params: SqlParams = {}): { readonly changes: number } {
        return { changes: this.bind(sql, params, (statement, args) => statement.run(...args)).changes };
    }

    /**
     * @param sql Uma consulta.
     * @param params Parâmetros nomeados.
     * @return A primeira linha, ou `undefined`.
     */
    public get(sql: string, params: SqlParams = {}): SqlRow | undefined {
        return this.bind(sql, params, (statement, args) => statement.get(...args) as SqlRow | undefined);
    }

    /**
     * @param sql Uma consulta.
     * @param params Parâmetros nomeados.
     * @return Todas as linhas.
     */
    public all(sql: string, params: SqlParams = {}): readonly SqlRow[] {
        return this.bind(sql, params, (statement, args) => statement.all(...args) as SqlRow[]);
    }

    /**
     * @param sql Script com várias instruções (migrations).
     * @return void
     */
    public exec(sql: string): void {
        this.connection.exec(sql);
    }

    /**
     * @param fn Trabalho síncrono a executar atomicamente.
     * @return O que `fn` devolveu; qualquer exceção desfaz a transação.
     */
    public transaction<T>(fn: () => T): T {
        return this.connection.transaction(fn)();
    }

    /**
     * Fecha a conexão. Não faz parte da porta: abrir e fechar é responsabilidade da
     * plataforma, não do núcleo.
     *
     * @return void
     */
    public close(): void {
        this.connection.close();
    }

    /**
     * Prepara (com cache) e executa uma instrução. O cache existe porque o recálculo roda as
     * mesmas consultas para cada conta afetada, e preparar de novo a cada chamada é o custo
     * dominante de consultas pequenas. Sem parâmetros, nada é passado: o driver recusa um
     * objeto de parâmetros numa instrução que não declara nenhum.
     *
     * @param sql Instrução SQL.
     * @param params Parâmetros nomeados.
     * @param execute Como executar a instrução preparada.
     * @return O que `execute` devolveu.
     */
    private bind<T>(sql: string, params: SqlParams, execute: (statement: BetterSqlite3.Statement, args: [SqlParams] | []) => T): T {
        let statement = this.statements.get(sql);
        if (statement === undefined) {
            statement = this.connection.prepare(sql);
            this.statements.set(sql, statement);
        }
        return execute(statement, Object.keys(params).length === 0 ? [] : [params]);
    }
}
