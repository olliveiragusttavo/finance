import { LocalDate } from '../../domain/shared/LocalDate.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';

/**
 * Chave ordenável de uma competência (`year * 100 + month`), comparada com a mesma
 * expressão sobre as colunas `year` e `month`. Existe porque comparar ano e mês em duas
 * condições separadas é onde a virada de dezembro para janeiro costuma quebrar.
 *
 * @param period Competência.
 * @return A chave numérica, ex.: `202603`.
 */
export function periodKey(period: YearMonth): number {
    return period.year * 100 + period.month;
}

/**
 * Primeiro e último dia de um mês como texto ISO, para filtrar `due_date` com `BETWEEN`.
 * Texto ISO-8601 ordena corretamente como string (database-design §3.9), então o filtro
 * usa o índice `idx_transactions_due_date` sem função sobre a coluna.
 *
 * @param period Competência.
 * @return Os limites inclusivos do mês.
 */
export function monthBounds(period: YearMonth): { readonly start: string; readonly end: string } {
    return {
        start: LocalDate.of(period.year, period.month, 1).toString(),
        end: LocalDate.of(period.year, period.month, period.lengthInDays()).toString(),
    };
}

/**
 * Data de caixa de uma transação em SQL — a mesma regra de `Transaction.cashDate`: a data
 * de pagamento quando paga, o vencimento enquanto em aberto.
 * Regra de negócio (Extrato): é esta data que decide o mês do extrato, na origem e no
 * destino de uma transferência (database-design §4.6). Fica num lugar só porque o
 * recálculo e a listagem do extrato precisam concordar sobre o mês de cada entrada.
 *
 * @param transaction Alias da tabela `transactions`.
 * @return A expressão da data, texto ISO `YYYY-MM-DD`.
 */
export function cashDateSql(transaction: string): string {
    return `(CASE WHEN ${transaction}.paid = 1 AND ${transaction}.payment_date IS NOT NULL THEN ${transaction}.payment_date ELSE ${transaction}.due_date END)`;
}
