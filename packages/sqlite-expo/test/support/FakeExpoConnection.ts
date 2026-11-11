import BetterSqlite3 from 'better-sqlite3';
import type { SqlValue } from '@finance/core';
import type { ExpoConnection, ExpoExecuteResult, ExpoStatement } from '../../src/ExpoSqliteDatabase.ts';

/**
 * Dublê da conexão síncrona do `expo-sqlite` sobre o `better-sqlite3`, fiel nos pontos em que
 * o adaptador pode errar, conferidos no código do `expo-sqlite` 58:
 * - só liga a chave que bate com o parâmetro do SQL (`:nome`); chave sem prefixo é ignorada,
 *   como o `sqlite3_bind_parameter_index` do nativo, que devolve 0;
 * - `executeSync` já dá o primeiro passo, e o cursor de uma leitura fica aberto até
 *   `resetSync` ou até o fim do resultado — no `better-sqlite3`, um cursor aberto bloqueia
 *   qualquer outra instrução, então esquecer o `resetSync` falha alto aqui;
 * - `getFirstSync`/`getAllSync` recusam ler de novo sem `resetSync`;
 * - `withTransactionSync` faz `BEGIN`/`COMMIT`, desfaz e propaga a exceção;
 * - `finalizeSync` lança de novo o erro da última execução, se ela falhou.
 * Não substitui o teste no Hermes (`apps/mobile-contract`), que roda o driver real.
 */
export class FakeExpoConnection implements ExpoConnection {
    public readonly prepared: string[] = [];
    public readonly finalized: string[] = [];
    public closed = false;
    private readonly connection = new BetterSqlite3(':memory:');

    /**
     * @param source Instrução SQL.
     * @return A instrução preparada; registra o SQL para o teste conferir o cache.
     */
    public prepareSync(source: string): ExpoStatement {
        this.prepared.push(source);
        return new FakeStatement(this.connection.prepare(source), () => {
            this.finalized.push(source);
        });
    }

    /**
     * @param source Script SQL.
     */
    public execSync(source: string): void {
        this.connection.exec(source);
    }

    /**
     * @param task Trabalho síncrono.
     * @throws {unknown} A exceção da tarefa, depois do rollback.
     */
    public withTransactionSync(task: () => void): void {
        try {
            this.execSync('BEGIN');
            task();
            this.execSync('COMMIT');
        } catch (error: unknown) {
            if (this.connection.inTransaction) {
                this.execSync('ROLLBACK');
            }
            throw error;
        }
    }

    /** Fecha a conexão. */
    public closeSync(): void {
        this.closed = true;
        this.connection.close();
    }
}

/** Linha como o `better-sqlite3` devolve, antes de chegar ao adaptador. */
type DriverRow = Record<string, SqlValue>;

/** Instrução preparada do dublê; segue o ciclo do `NativeStatement` do Expo. */
class FakeStatement implements ExpoStatement {
    private cursor: IterableIterator<unknown> | null = null;

    /** Erro da última execução, que o SQLite guarda na instrução até a próxima. */
    private failure: Error | null = null;

    /**
     * @param statement Instrução do `better-sqlite3`.
     * @param onFinalize Aviso ao dublê da conexão, para o teste conferir a finalização.
     */
    public constructor(private readonly statement: BetterSqlite3.Statement, private readonly onFinalize: () => void) {}

    /**
     * @param params Parâmetros no formato do Expo (`{ ':nome': valor }`).
     * @return O resultado, com o primeiro passo dado.
     */
    public executeSync<T>(params: Record<string, SqlValue>): ExpoExecuteResult<T> {
        try {
            return this.executeFirstStep<T>(params);
        } catch (error: unknown) {
            this.failure = error instanceof Error ? error : new Error(String(error));
            throw error;
        }
    }

    /**
     * @param params Parâmetros no formato do Expo.
     * @return O resultado, com o primeiro passo dado; separado do `executeSync` para que toda
     * falha passe pelo registro do erro.
     */
    private executeFirstStep<T>(params: Record<string, SqlValue>): ExpoExecuteResult<T> {
        this.closeCursor();
        this.failure = null;
        const bound = bindable(params);
        if (!this.statement.reader) {
            const changes = this.statement.run(...bound).changes;
            return new FakeResult<T>(changes, [], null);
        }
        const cursor = this.statement.iterate(...bound);
        this.cursor = cursor;
        const first = cursor.next();
        return new FakeResult<T>(0, first.done === true ? [] : [first.value], first.done === true ? null : this);
    }

    /**
     * Finaliza a instrução e, como o `sqlite3_finalize` pelo `expo-sqlite`, lança de novo o erro
     * da última execução, se ela falhou — o que derrubou o app de contrato no emulador.
     *
     * @throws {unknown} O erro da última execução, quando ela falhou.
     */
    public finalizeSync(): void {
        this.closeCursor();
        this.onFinalize();
        if (this.failure !== null) {
            throw this.failure;
        }
    }

    /**
     * @return O próximo resultado do cursor aberto, ou `null` no fim.
     */
    public step(): unknown {
        const next = this.cursor?.next();
        if (next === undefined || next.done === true) {
            this.cursor = null;
            return null;
        }
        return next.value;
    }

    /** Devolve o cursor ao início, liberando a conexão. */
    public closeCursor(): void {
        this.cursor?.return?.();
        this.cursor = null;
    }
}

/** Resultado do dublê; segue o `SQLiteExecuteSyncResult` do Expo. */
class FakeResult<T> implements ExpoExecuteResult<T> {
    private stepped = false;

    /**
     * @param changes Linhas alteradas pela escrita.
     * @param firstRows A primeira linha já lida pelo `executeSync`, se houver.
     * @param owner Instrução com o cursor aberto; `null` quando o resultado já terminou.
     */
    public constructor(public readonly changes: number, private readonly firstRows: readonly unknown[], private readonly owner: FakeStatement | null) {}

    /**
     * @return A primeira linha, ou `null`.
     * @throws {Error} Quando o cursor já foi movido, como no Expo.
     */
    public getFirstSync(): T | null {
        this.assertFresh();
        this.stepped = true;
        return this.rows(this.firstRows)[0] ?? null;
    }

    /**
     * @return Todas as linhas.
     * @throws {Error} Quando o cursor já foi movido, como no Expo.
     */
    public getAllSync(): T[] {
        this.assertFresh();
        this.stepped = true;
        const rest: unknown[] = [];
        for (let row = this.owner?.step() ?? null; row !== null; row = this.owner?.step() ?? null) {
            rest.push(row);
        }
        return this.rows([...this.firstRows, ...rest]);
    }

    /** Devolve o cursor ao início. */
    public resetSync(): void {
        this.owner?.closeCursor();
        this.stepped = false;
    }

    /**
     * @throws {Error} Quando a leitura já começou, como no Expo.
     */
    private assertFresh(): void {
        if (this.stepped) {
            throw new Error('The SQLite cursor has been shifted and is unable to retrieve rows without being reset.');
        }
    }

    /**
     * Repassa as linhas ao tipo pedido pelo adaptador. O dublê só é usado com `SqlRow`, a
     * mesma forma que o `better-sqlite3` devolve, e o filtro confere cada linha em vez de
     * converter às cegas.
     *
     * @param rows Linhas do driver.
     * @return As linhas, com o tipo pedido.
     */
    private rows(rows: readonly unknown[]): T[] {
        return rows.filter((row): row is T => typeof row === 'object' && row !== null);
    }
}

/**
 * Converte os parâmetros do formato do Expo para o do `better-sqlite3`, que liga `{ nome }` a
 * `:nome`. Chave sem `:` é descartada, como o índice 0 do nativo — se o adaptador esquecer o
 * prefixo, o `better-sqlite3` acusa o parâmetro que falta.
 *
 * @param params Parâmetros no formato do Expo.
 * @return Os argumentos do `better-sqlite3`: nenhum quando não há parâmetro, porque ele recusa
 * um objeto numa instrução que não declara parâmetros.
 */
function bindable(params: Record<string, SqlValue>): [] | [DriverRow] {
    const entries = Object.entries(params).filter(([key]) => key.startsWith(':')).map(([key, value]): [string, SqlValue] => [key.slice(1), value]);
    return entries.length === 0 ? [] : [Object.fromEntries(entries)];
}
