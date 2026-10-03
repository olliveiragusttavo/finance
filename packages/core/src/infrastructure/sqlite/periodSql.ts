import { LocalDate } from '../../domain/shared/LocalDate.ts';
import { YearMonth } from '../../domain/shared/YearMonth.ts';

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
 * Competência de volta a partir da chave de `periodKey`.
 *
 * @param key Chave numérica `year * 100 + month` lida do banco.
 * @return A competência.
 * @throws {InvalidValueError} Quando a chave não forma um mês válido.
 */
export function periodFromKey(key: number): YearMonth {
    return YearMonth.of(Math.floor(key / 100), key % 100);
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

/**
 * Mês de vencimento de uma fatura, a mesma regra de `BillingCycle.dueDateOf` em SQL: a
 * fatura vence no mês dela quando o fechamento vem antes do vencimento **depois** do ajuste
 * de dia inexistente para o último dia do mês; senão, no mês seguinte. Como fechamento e
 * vencimento são limitados ao mesmo último dia, "fechamento ajustado < vencimento ajustado"
 * equivale a `closing < due AND closing < último dia`. Um teste confere a equivalência com o
 * domínio para todos os pares de dias.
 *
 * @param invoice Alias da tabela `invoices`.
 * @param card Alias da tabela `credit_cards`.
 * @return A expressão da chave do mês de vencimento.
 */
export function invoiceDueKeySql(invoice: string, card: string): string {
    const lastDay = `CAST(strftime('%d', date(printf('%04d-%02d-01', ${invoice}.year, ${invoice}.month), '+1 month', '-1 day')) AS INTEGER)`;
    const sameMonth = `(${invoice}.year * 100 + ${invoice}.month)`;
    const nextMonth = `(CASE WHEN ${invoice}.month = 12 THEN (${invoice}.year + 1) * 100 + 1 ELSE ${sameMonth} + 1 END)`;
    return `(CASE WHEN ${card}.closing_date < ${card}.due_date AND ${card}.closing_date < ${lastDay} THEN ${sameMonth} ELSE ${nextMonth} END)`;
}

/**
 * Fonte única do **mês de pagamento** de todos os relatórios — o único lugar a mudar quando a
 * regra for refinada (desktop-mvp-plan §8).
 * Regra de negócio (Relatórios — reports-design §2): todo relatório agrupa pelo mês em que o
 * dinheiro de fato sai ou entra na conta (regime de caixa):
 *
 * - transação de conta: mês do **extrato** em que ela está, que é o do `payment_date`
 *   quando paga e o do `due_date` em aberto (`Transaction.cashDate`) — ler o extrato, e não
 *   repetir a regra das datas, garante que relatório e extrato concordem por construção;
 * - compra no cartão com fatura paga: mês do **extrato** em que a fatura foi paga;
 * - compra no cartão com fatura em aberto: mês do **vencimento** da fatura.
 *
 * São duas CTEs encadeadas, e não uma expressão solta, porque o critério da compra no
 * cartão depende da fatura: `report_invoices` dá o mês de pagamento de cada fatura (o
 * impacto do cartão lê só ela) e `report_transactions` aplica o critério a cada transação.
 * Filtram o perfil (`:profileId`), o soft delete de toda tabela envolvida e o arco exclusivo
 * íntegro, pelos mesmos motivos do `SqliteBalanceLedgerRepository`. Uma fatura cujo extrato
 * de pagamento foi excluído volta a contar como em aberto, como no saldo.
 *
 * Uso: `WITH ${REPORT_SOURCES_CTE} SELECT ... FROM report_transactions rt ...`.
 */
export const REPORT_SOURCES_CTE = `
    report_invoices AS (
        SELECT i.id, i.credit_card_id, i.year, i.month, i.balance,
            ps.id IS NOT NULL AS paid,
            CASE WHEN ps.id IS NOT NULL THEN ps.year * 100 + ps.month ELSE ${invoiceDueKeySql('i', 'c')} END AS payment_key
        FROM invoices i
        JOIN credit_cards c ON c.id = i.credit_card_id AND c.deleted_at IS NULL
        LEFT JOIN bank_statements ps ON ps.id = i.bank_statement_id AND ps.deleted_at IS NULL
        WHERE i.deleted_at IS NULL AND c.profile_id = :profileId
    ),
    report_transactions AS (
        SELECT t.id, t.type, t.value, t.charges, t.sub_category_id, t.invoice_id,
            CASE
                WHEN t.invoice_id IS NOT NULL THEN ri.payment_key
                ELSE bs.year * 100 + bs.month
            END AS payment_key
        FROM transactions t
        LEFT JOIN bank_statements bs ON bs.id = t.bank_statement_id AND bs.deleted_at IS NULL
        LEFT JOIN accounts a ON a.id = bs.account_id AND a.deleted_at IS NULL AND a.profile_id = :profileId
        LEFT JOIN report_invoices ri ON ri.id = t.invoice_id
        WHERE t.deleted_at IS NULL
            AND ((a.id IS NOT NULL AND t.invoice_id IS NULL) OR (ri.id IS NOT NULL AND t.bank_statement_id IS NULL))
    )
`;

/**
 * Placeholders nomeados para uma lista de competências num `IN (...)`. Existe porque a porta
 * `Database` só aceita parâmetros escalares, e montar o texto com os valores abriria espaço
 * para SQL montado à mão.
 *
 * @param periods Competências da lista; não pode ser vazia.
 * @param prefix Prefixo dos nomes dos parâmetros, para não colidir com outros da consulta.
 * @return O trecho `:p0, :p1, ...` e os parâmetros com as chaves de cada competência.
 * @throws {Error} Quando a lista é vazia — `IN ()` é erro de sintaxe no SQLite.
 */
export function periodListSql(periods: readonly YearMonth[], prefix = 'period'): { readonly sql: string; readonly params: Readonly<Record<string, number>> } {
    if (periods.length === 0) {
        throw new Error('periodListSql exige ao menos uma competência');
    }
    const params: Record<string, number> = {};
    periods.forEach((period, index) => {
        params[`${prefix}${index}`] = periodKey(period);
    });
    return { sql: Object.keys(params).map((name) => `:${name}`).join(', '), params };
}
