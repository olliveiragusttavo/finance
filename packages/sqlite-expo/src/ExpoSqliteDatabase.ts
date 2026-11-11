import type { Database, SqlParams, SqlRow, SqlValue } from '@finance/core';

/**
 * Resultado de uma execução no `expo-sqlite` (`SQLiteExecuteSyncResult`), só com o que o
 * adaptador usa. A interface é própria, e não o tipo do pacote, porque as classes do
 * `expo-sqlite` têm membros privados e só o módulo nativo as instancia: com a interface, o
 * Vitest exercita o adaptador inteiro num dublê sobre o `better-sqlite3`, e a raiz de
 * composição do app confere, na compilação, que o objeto real cumpre esta forma.
 */
export interface ExpoExecuteResult<T> {
    readonly changes: number;
    getFirstSync(): T | null;
    getAllSync(): T[];
    resetSync(): void;
}

/** Instrução preparada do `expo-sqlite` (`SQLiteStatement`), só com o que o adaptador usa. */
export interface ExpoStatement {
    executeSync<T>(params: Record<string, SqlValue>): ExpoExecuteResult<T>;
    finalizeSync(): void;
}

/** Conexão síncrona do `expo-sqlite` (`SQLiteDatabase`), só com o que o adaptador usa. */
export interface ExpoConnection {
    prepareSync(source: string): ExpoStatement;
    execSync(source: string): void;
    withTransactionSync(task: () => void): void;
    closeSync(): void;
}

/**
 * Adaptador da porta `Database` do núcleo sobre a API síncrona do `expo-sqlite`, que chama o
 * SQLite pela JSI, sem ponte assíncrona (mobile-shell-design §4.2). Fino e sem regra, como o
 * `BetterSqliteDatabase` do desktop: as diferenças entre os dois drivers ficam resolvidas
 * aqui, e a suíte `DATABASE_CONTRACT` do núcleo prova que o resultado é o mesmo.
 */
export class ExpoSqliteDatabase implements Database {
    private readonly statements = new Map<string, ExpoStatement>();

    /**
     * @param connection Conexão aberta; privada para que nenhum código use o driver por fora
     * da porta.
     */
    private constructor(private readonly connection: ExpoConnection) {}

    /**
     * Envolve uma conexão já aberta. A abertura fica fora (`openExpoDatabase`) porque é ela
     * que carrega o módulo nativo; separada, a classe roda no Vitest.
     *
     * @param connection Conexão devolvida pelo `openDatabaseSync`.
     * @return O adaptador sobre a conexão.
     */
    public static wrap(connection: ExpoConnection): ExpoSqliteDatabase {
        return new ExpoSqliteDatabase(connection);
    }

    /**
     * @param sql Uma instrução sem retorno de linhas.
     * @param params Parâmetros nomeados (`:nome`).
     * @return Quantas linhas foram alteradas.
     */
    public run(sql: string, params: SqlParams = {}): { readonly changes: number } {
        const result = this.execute<SqlRow>(sql, params);
        try {
            return { changes: result.changes };
        } finally {
            result.resetSync();
        }
    }

    /**
     * Lê só a primeira linha e devolve o cursor ao início. Sem o `resetSync`, a instrução
     * ficaria parada no meio do resultado, segurando uma leitura aberta na conexão até a
     * próxima execução dela.
     *
     * @param sql Uma consulta.
     * @param params Parâmetros nomeados.
     * @return A primeira linha, ou `undefined` quando não há nenhuma (o driver devolve `null`).
     */
    public get(sql: string, params: SqlParams = {}): SqlRow | undefined {
        const result = this.execute<SqlRow>(sql, params);
        try {
            return result.getFirstSync() ?? undefined;
        } finally {
            result.resetSync();
        }
    }

    /**
     * @param sql Uma consulta.
     * @param params Parâmetros nomeados.
     * @return Todas as linhas.
     */
    public all(sql: string, params: SqlParams = {}): readonly SqlRow[] {
        const result = this.execute<SqlRow>(sql, params);
        try {
            return result.getAllSync();
        } finally {
            result.resetSync();
        }
    }

    /**
     * @param sql Script com várias instruções (migrations).
     */
    public exec(sql: string): void {
        this.connection.execSync(sql);
    }

    /**
     * O `withTransactionSync` não devolve o resultado da tarefa, então o valor é capturado
     * pela closure. A exceção da tarefa desfaz a transação e é propagada pelo próprio driver.
     *
     * @param fn Trabalho síncrono a executar atomicamente; não pode abrir outra transação,
     * o que o `UnitOfWork` do núcleo já garante.
     * @return O que `fn` devolveu.
     */
    public transaction<T>(fn: () => T): T {
        // Lista, e não `let`, porque o TypeScript não acompanha a atribuição feita dentro da
        // closure e trataria o valor como nunca preenchido.
        const outcomes: { readonly value: T }[] = [];
        this.connection.withTransactionSync(() => {
            outcomes.push({ value: fn() });
        });
        const [outcome] = outcomes;
        if (outcome === undefined) {
            throw new Error('a transação terminou sem executar o trabalho');
        }
        return outcome.value;
    }

    /**
     * Finaliza as instruções em cache e fecha a conexão. Não faz parte da porta: abrir e
     * fechar é da plataforma. Finalizar antes evita depender da limpeza automática do driver,
     * que só acontece no fechamento e não libera a memória das instruções antes disso.
     */
    public close(): void {
        for (const statement of this.statements.values()) {
            statement.finalizeSync();
        }
        this.statements.clear();
        this.connection.closeSync();
    }

    /**
     * Prepara (com cache) e executa. O cache existe pelo mesmo motivo do adaptador do
     * desktop: o recálculo roda as mesmas consultas para cada conta afetada, e preparar de
     * novo a cada chamada é o custo dominante de consultas pequenas. O driver reinicia a
     * instrução e limpa os parâmetros a cada execução, então reusar é seguro.
     *
     * Uma instrução cuja execução falhou sai do cache e é finalizada na hora: o SQLite guarda o
     * erro na instrução, e o `finalizeSync` do `expo-sqlite` o lança de novo. Em cache, a
     * restrição violada horas antes reaparecia no `close` — no aparelho, como exceção fatal
     * fora de qualquer `try` (achado do `apps/mobile-contract`, mobile-mvp-plan Fase 3).
     *
     * @param sql Instrução SQL.
     * @param params Parâmetros nomeados, sem o prefixo.
     * @return O resultado da execução, com o primeiro passo já dado pelo driver.
     * @throws {unknown} O erro do driver na execução, depois de tirar a instrução do cache.
     */
    private execute<T>(sql: string, params: SqlParams): ExpoExecuteResult<T> {
        let statement = this.statements.get(sql);
        if (statement === undefined) {
            statement = this.connection.prepareSync(sql);
            this.statements.set(sql, statement);
        }
        try {
            return statement.executeSync<T>(prefixParams(params));
        } catch (error: unknown) {
            this.statements.delete(sql);
            try {
                statement.finalizeSync();
            } catch {
                // O finalize repete o erro da execução, que é o que o chamador precisa ver.
            }
            throw error;
        }
    }
}

/**
 * Traduz `{ nome: valor }` para `{ ':nome': valor }`. O SQL do núcleo usa `:nome`, e o
 * `expo-sqlite` procura cada chave do objeto, como veio, em `sqlite3_bind_parameter_index`;
 * uma chave sem o prefixo não é encontrada e o parâmetro fica `NULL` **sem erro**, o que
 * gravaria dado errado em vez de falhar.
 *
 * @param params Parâmetros como o núcleo os passa.
 * @return Os mesmos valores, com as chaves no formato do driver.
 */
export function prefixParams(params: SqlParams): Record<string, SqlValue> {
    const prefixed: Record<string, SqlValue> = {};
    for (const [name, value] of Object.entries(params)) {
        prefixed[`:${name}`] = value;
    }
    return prefixed;
}
