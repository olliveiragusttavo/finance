import { CorruptRowError } from '../../domain/shared/errors.ts';
import type { SqlRow } from '../../ports/Database.ts';

/**
 * Lê colunas de uma linha conferindo o tipo em tempo de execução. O `STRICT` garante o
 * tipo armazenado, mas não o que cada driver devolve: um adaptador que entregasse `REAL`
 * como string, ou um `SELECT` com alias errado, viraria `NaN` num saldo. A conferência
 * aqui transforma isso num erro explícito na fronteira do Repository.
 */
export class RowReader {
    /**
     * @param table Tabela de origem; identifica a linha no erro.
     * @param row Linha devolvida pela porta `Database`.
     */
    public constructor(private readonly table: string, private readonly row: SqlRow) {}

    /**
     * @param column Nome da coluna (ou alias) no `SELECT`.
     * @return O texto da coluna.
     * @throws {CorruptRowError} Quando a coluna não é texto.
     */
    public text(column: string): string {
        const value = this.row[column];
        if (typeof value !== 'string') {
            throw this.unexpected(column, 'texto', value);
        }
        return value;
    }

    /**
     * @param column Nome da coluna anulável.
     * @return O texto, ou `null`.
     * @throws {CorruptRowError} Quando a coluna não é texto nem nula.
     */
    public nullableText(column: string): string | null {
        const value = this.row[column];
        if (value !== null && typeof value !== 'string') {
            throw this.unexpected(column, 'texto ou nulo', value);
        }
        return value ?? null;
    }

    /**
     * @param column Nome da coluna numérica (`INTEGER` ou `REAL`).
     * @return O número.
     * @throws {CorruptRowError} Quando a coluna não é um número finito.
     */
    public number(column: string): number {
        const value = this.row[column];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw this.unexpected(column, 'número finito', value);
        }
        return value;
    }

    /**
     * @param column Nome da coluna booleana, gravada como `0`/`1` (database-design §3.9).
     * @return O booleano.
     * @throws {CorruptRowError} Quando a coluna não é `0` nem `1`.
     */
    public boolean(column: string): boolean {
        const value = this.number(column);
        if (value !== 0 && value !== 1) {
            throw this.unexpected(column, 'booleano 0/1', value);
        }
        return value === 1;
    }

    /**
     * @param column Coluna com o valor inesperado.
     * @param expected Tipo esperado, para a mensagem.
     * @param actual Valor recebido.
     * @return O erro a lançar; devolvido em vez de lançado para que o chamador use `throw`
     * e o compilador enxergue o fluxo.
     */
    private unexpected(column: string, expected: string, actual: unknown): CorruptRowError {
        return new CorruptRowError(this.table, `coluna ${column}: esperado ${expected}, recebido ${typeof actual} (${String(actual)})`);
    }
}
