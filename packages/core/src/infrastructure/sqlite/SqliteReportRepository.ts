import { BalancePair } from '../../domain/balance/BalancePair.ts';
import type {
    AccountClosingHistory,
    CashFlowTotals,
    InvoiceExpenseTotals,
    SubCategoryExpenseTotals,
} from '../../domain/report/ReportTotals.ts';
import type { Currency } from '../../domain/shared/Currency.ts';
import { AccountId, CategoryId, CreditCardId, InvoiceId, SubCategoryId, type ProfileId } from '../../domain/shared/ids.ts';
import { Money } from '../../domain/shared/Money.ts';
import { YearMonth } from '../../domain/shared/YearMonth.ts';
import type { Database } from '../../ports/Database.ts';
import type { ReportRepository } from '../../repositories/ReportRepository.ts';
import { TRANSACTION_TYPE_CODE } from './enumCodes.ts';
import { CROSS_PROFILE_TRANSFERS_CTE, periodFromKey, periodKey, periodListSql, REPORT_SOURCES_CTE } from './periodSql.ts';
import { RowReader } from './RowReader.ts';

/**
 * Implementação SQLite de `ReportRepository`. O critério de período, o soft delete e o arco
 * exclusivo vêm todos de `REPORT_SOURCES_CTE`; as consultas daqui só agrupam e somam, para
 * que nenhum relatório tenha uma versão própria de "em que mês este valor pesa".
 */
export class SqliteReportRepository implements ReportRepository {
    /**
     * @param database Conexão compartilhada da unidade de trabalho.
     */
    public constructor(private readonly database: Database) {}

    /**
     * Receitas e despesas somam junto com as transferências entre perfis
     * (`CROSS_PROFILE_TRANSFERS_CTE`) num `UNION ALL` antes do agrupamento, para que a Visão
     * geral e o peso nas entradas (C3) as contem sem uma segunda consulta por relatório.
     *
     * @param profileId Perfil consultado.
     * @param periods Meses de pagamento pedidos.
     * @param currency Moeda do perfil.
     * @return Somas de receitas e despesas por mês de pagamento, com as transferências entre
     * perfis no sentido que têm para este perfil.
     */
    public cashFlowTotals(profileId: ProfileId, periods: readonly YearMonth[], currency: Currency): readonly CashFlowTotals[] {
        const list = periodListSql(periods);
        return this.database
            .all(
                `WITH ${REPORT_SOURCES_CTE}, ${CROSS_PROFILE_TRANSFERS_CTE}
                SELECT flows.payment_key, flows.type, SUM(flows.value) AS value, SUM(flows.charges) AS charges, COUNT(*) AS count
                FROM (
                    SELECT rt.payment_key, rt.type, rt.value, rt.charges
                    FROM report_transactions rt
                    WHERE rt.type IN (:income, :expense)
                    UNION ALL
                    SELECT cpt.payment_key, cpt.type, cpt.value, cpt.charges
                    FROM cross_profile_transfers cpt
                ) flows
                WHERE flows.payment_key IN (${list.sql})
                GROUP BY flows.payment_key, flows.type`,
                {
                    profileId,
                    income: TRANSACTION_TYPE_CODE.income,
                    expense: TRANSACTION_TYPE_CODE.expense,
                    transference: TRANSACTION_TYPE_CODE.transference,
                    ...list.params,
                },
            )
            .map((row) => {
                const reader = new RowReader('transactions', row);
                return {
                    period: periodFromKey(reader.number('payment_key')),
                    type: reader.number('type') === TRANSACTION_TYPE_CODE.income ? 'income' : 'expense',
                    value: Money.of(reader.number('value'), currency),
                    charges: Money.of(reader.number('charges'), currency),
                    count: reader.number('count'),
                };
            });
    }

    /**
     * Os nomes de categoria e subcategoria são lidos sem filtrar `deleted_at`: são só
     * rótulos, e esconder a despesa de uma subcategoria excluída tiraria dinheiro do total.
     * O fluxo normal nem chega a isso — excluir subcategoria em uso exige mover os
     * lançamentos antes.
     *
     * @param profileId Perfil consultado.
     * @param periods Meses de pagamento pedidos.
     * @param currency Moeda do perfil.
     * @return Somas das despesas por subcategoria e mês de pagamento.
     */
    public expenseTotalsBySubCategory(profileId: ProfileId, periods: readonly YearMonth[], currency: Currency): readonly SubCategoryExpenseTotals[] {
        const list = periodListSql(periods);
        return this.database
            .all(
                `WITH ${REPORT_SOURCES_CTE}
                SELECT rt.payment_key, sc.id AS sub_category_id, sc.name AS sub_category_name,
                    tc.id AS category_id, tc.name AS category_name,
                    SUM(rt.value) AS value, SUM(rt.charges) AS charges, COUNT(*) AS count
                FROM report_transactions rt
                JOIN transaction_sub_categories sc ON sc.id = rt.sub_category_id
                JOIN transaction_categories tc ON tc.id = sc.category_id
                WHERE rt.type = :expense AND rt.payment_key IN (${list.sql})
                GROUP BY rt.payment_key, sc.id`,
                { profileId, expense: TRANSACTION_TYPE_CODE.expense, ...list.params },
            )
            .map((row) => {
                const reader = new RowReader('transactions', row);
                return {
                    period: periodFromKey(reader.number('payment_key')),
                    categoryId: CategoryId(reader.text('category_id')),
                    categoryName: reader.text('category_name'),
                    subCategoryId: SubCategoryId(reader.text('sub_category_id')),
                    subCategoryName: reader.text('sub_category_name'),
                    value: Money.of(reader.number('value'), currency),
                    charges: Money.of(reader.number('charges'), currency),
                    count: reader.number('count'),
                };
            });
    }

    /**
     * As somas de despesa vêm por `SUM(CASE ...)` sobre todas as transações da fatura, e não
     * filtrando o tipo no `WHERE`, porque uma fatura só com pagamento parcial ainda precisa
     * aparecer (com total zero) para a situação dela não sumir da grade.
     *
     * @param profileId Perfil consultado.
     * @param periods Meses de pagamento pedidos.
     * @param currency Moeda do perfil.
     * @return As faturas da janela com as somas das despesas.
     */
    public invoicesByPaymentPeriod(profileId: ProfileId, periods: readonly YearMonth[], currency: Currency): readonly InvoiceExpenseTotals[] {
        const list = periodListSql(periods);
        return this.database
            .all(
                `WITH ${REPORT_SOURCES_CTE}
                SELECT ri.id, ri.credit_card_id, ri.year, ri.month, ri.balance, ri.paid, ri.payment_key,
                    SUM(CASE WHEN rt.type = :expense THEN rt.value ELSE 0 END) AS expense_value,
                    SUM(CASE WHEN rt.type = :expense THEN rt.charges ELSE 0 END) AS expense_charges
                FROM report_invoices ri
                JOIN report_transactions rt ON rt.invoice_id = ri.id
                WHERE ri.payment_key IN (${list.sql})
                GROUP BY ri.id`,
                { profileId, expense: TRANSACTION_TYPE_CODE.expense, ...list.params },
            )
            .map((row) => {
                const reader = new RowReader('invoices', row);
                return {
                    invoiceId: InvoiceId(reader.text('id')),
                    creditCardId: CreditCardId(reader.text('credit_card_id')),
                    invoicePeriod: YearMonth.of(reader.number('year'), reader.number('month')),
                    paymentPeriod: periodFromKey(reader.number('payment_key')),
                    paid: reader.boolean('paid'),
                    balance: Money.of(reader.number('balance'), currency),
                    expenseValue: Money.of(reader.number('expense_value'), currency),
                    expenseCharges: Money.of(reader.number('expense_charges'), currency),
                };
            });
    }

    /**
     * Regra de negócio (Perfil): o saldo do perfil soma só as contas com "considerar no
     * saldo" ligado; contas desativadas continuam, porque o histórico não muda
     * (desktop-mvp-plan §5.1).
     *
     * @param profileId Perfil consultado.
     * @param from Primeiro mês da série.
     * @param to Último mês da série.
     * @param currency Moeda do perfil.
     * @return Os fechamentos de cada conta na janela, mais o último anterior a ela.
     */
    public closingHistories(profileId: ProfileId, from: YearMonth, to: YearMonth, currency: Currency): readonly AccountClosingHistory[] {
        const rows = this.database.all(
            `SELECT a.id AS account_id, a.opening_balance, bs.year, bs.month, bs.closing_balance, bs.projected_closing_balance
            FROM accounts a
            LEFT JOIN bank_statements bs ON bs.account_id = a.id AND bs.deleted_at IS NULL
                AND (bs.year * 100 + bs.month) <= :to
                AND (bs.year * 100 + bs.month) >= COALESCE(
                    (SELECT MAX(prev.year * 100 + prev.month) FROM bank_statements prev
                    WHERE prev.account_id = a.id AND prev.deleted_at IS NULL AND (prev.year * 100 + prev.month) < :from),
                    :from)
            WHERE a.profile_id = :profileId AND a.deleted_at IS NULL AND a.consider_balance = 1
            ORDER BY a.id, bs.year, bs.month`,
            { profileId, from: periodKey(from), to: periodKey(to) },
        );
        const histories = new Map<AccountId, { opening: BalancePair; statements: { period: YearMonth; closing: BalancePair }[] }>();
        for (const row of rows) {
            const reader = new RowReader('bank_statements', row);
            const accountId = AccountId(reader.text('account_id'));
            const history = histories.get(accountId) ?? { opening: BalancePair.same(Money.of(reader.number('opening_balance'), currency)), statements: [] };
            if (row['year'] !== null) {
                history.statements.push({
                    period: YearMonth.of(reader.number('year'), reader.number('month')),
                    closing: BalancePair.of(Money.of(reader.number('closing_balance'), currency), Money.of(reader.number('projected_closing_balance'), currency)),
                });
            }
            histories.set(accountId, history);
        }
        return [...histories.entries()].map(([accountId, history]) => ({ accountId, ...history }));
    }
}
