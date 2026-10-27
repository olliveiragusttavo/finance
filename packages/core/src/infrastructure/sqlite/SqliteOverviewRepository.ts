import type { PendingDirection, PendingTransaction } from '../../domain/overview/PendingItems.ts';
import type { CategorySpending } from '../../domain/overview/SpendingSummary.ts';
import type { MonthAmount } from '../../domain/report/ReportTotals.ts';
import type { Currency } from '../../domain/shared/Currency.ts';
import { CategoryId, TransactionId, type ProfileId } from '../../domain/shared/ids.ts';
import { LocalDate } from '../../domain/shared/LocalDate.ts';
import { Money } from '../../domain/shared/Money.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';
import type { Database } from '../../ports/Database.ts';
import type { OverviewRepository } from '../../repositories/OverviewRepository.ts';
import { TRANSACTION_TYPE_CODE } from './enumCodes.ts';
import { invoiceDueKeySql, periodFromKey, periodKey } from './periodSql.ts';
import { RowReader } from './RowReader.ts';

/**
 * Receitas e despesas do perfil (`:profileId`) com o mês em que cada uma pesa na Visão geral.
 * Regra de negócio (Visão geral, regime de caixa da regra-mestra antiga — desktop-mvp-plan §3.1):
 * - lançamento de conta: o mês do **extrato** em que está, que é o do pagamento quando pago e o do
 *   vencimento em aberto — ler o extrato garante que a Visão geral e Contas concordem;
 * - compra no cartão: o mês do **vencimento da fatura**, paga ou não (pedido do usuário). Pagar a
 *   fatura com atraso não muda o mês dos gastos, que é o do ciclo.
 *
 * Filtra o soft delete de toda tabela envolvida e o arco exclusivo íntegro, como as CTEs dos
 * relatórios. Uso: `WITH ${OVERVIEW_FLOWS_CTE} SELECT ... FROM overview_flows f ...`, com
 * `:income` e `:expense` nos parâmetros.
 */
const OVERVIEW_FLOWS_CTE = `
    overview_flows AS (
        SELECT bs.year * 100 + bs.month AS month_key, t.type, t.value, t.sub_category_id
        FROM transactions t
        JOIN bank_statements bs ON bs.id = t.bank_statement_id AND bs.deleted_at IS NULL
        JOIN accounts a ON a.id = bs.account_id AND a.deleted_at IS NULL AND a.profile_id = :profileId
        WHERE t.deleted_at IS NULL AND t.invoice_id IS NULL AND t.type IN (:income, :expense)
        UNION ALL
        SELECT ${invoiceDueKeySql('i', 'c')}, t.type, t.value, t.sub_category_id
        FROM transactions t
        JOIN invoices i ON i.id = t.invoice_id AND i.deleted_at IS NULL
        JOIN credit_cards c ON c.id = i.credit_card_id AND c.deleted_at IS NULL AND c.profile_id = :profileId
        WHERE t.deleted_at IS NULL AND t.bank_statement_id IS NULL AND t.type IN (:income, :expense)
    )
`;

/**
 * Os tipos que o `OVERVIEW_FLOWS_CTE` lê. Os parâmetros vão exatos para cada consulta, sem os que
 * ela não usa, porque um adaptador da porta `Database` pode recusar parâmetro sobrando.
 */
const FLOW_TYPES = { income: TRANSACTION_TYPE_CODE.income, expense: TRANSACTION_TYPE_CODE.expense } as const;

/** Os tipos que movem dinheiro entre contas: a transferência e o investimento. */
const MOVE_TYPES = { transference: TRANSACTION_TYPE_CODE.transference, investment: TRANSACTION_TYPE_CODE.investment } as const;

/** Lançamento ainda não pago, a mesma condição de `cashDateSql`: pago exige a data do pagamento. */
const UNPAID_SQL = 'NOT (t.paid = 1 AND t.payment_date IS NOT NULL)';

/** Implementação SQLite de `OverviewRepository`. */
export class SqliteOverviewRepository implements OverviewRepository {
    /**
     * @param database Conexão compartilhada da unidade de trabalho.
     */
    public constructor(private readonly database: Database) {}

    /**
     * Regra de negócio (Visão geral): gasto é a **despesa**, da conta e do cartão. A soma é do
     * `value` como gravado, sem os encargos, como nos relatórios (reports-design §3, soma do
     * valor): o estorno (negativo) abate o mês dele.
     *
     * @param profileId Perfil consultado.
     * @param from Primeiro mês pedido.
     * @param to Último mês pedido.
     * @param currency Moeda do perfil.
     * @return As despesas por mês, só dos meses com despesa.
     */
    public expensesByMonth(profileId: ProfileId, from: YearMonth, to: YearMonth, currency: Currency): readonly MonthAmount[] {
        return this.database
            .all(
                `WITH ${OVERVIEW_FLOWS_CTE}
                SELECT f.month_key, SUM(f.value) AS amount FROM overview_flows f
                WHERE f.type = :expense AND f.month_key BETWEEN :from AND :to
                GROUP BY f.month_key`,
                { ...FLOW_TYPES, profileId, from: periodKey(from), to: periodKey(to) },
            )
            .map((row) => {
                const reader = new RowReader('transactions', row);
                return { period: periodFromKey(reader.number('month_key')), amount: Money.of(reader.number('amount'), currency) };
            });
    }

    /**
     * Regra de negócio (Visão geral): entrada é a **receita** do perfil e a **transferência que
     * chega de outro perfil**, pelo valor que chega (os encargos são da origem). A transferência
     * entre contas do próprio perfil não é entrada: o dinheiro já era do perfil, e contá-la
     * inflaria as entradas a cada movimentação entre contas. A transferência de fora conta no mês
     * do extrato de origem, que é o da mesma data de caixa (database-design §4.6).
     *
     * @param profileId Perfil consultado.
     * @param period Mês consultado.
     * @param currency Moeda do perfil.
     * @return A soma das entradas do mês; zero sem entrada.
     */
    public incomeOfMonth(profileId: ProfileId, period: YearMonth, currency: Currency): Money {
        const row = this.database.get(
            `WITH ${OVERVIEW_FLOWS_CTE}
            SELECT COALESCE(SUM(amount), 0) AS amount FROM (
                SELECT f.value AS amount FROM overview_flows f
                WHERE f.type = :income AND f.month_key = :period
                UNION ALL
                SELECT t.value FROM transactions t
                JOIN bank_statements bs ON bs.id = t.bank_statement_id AND bs.deleted_at IS NULL
                JOIN accounts oa ON oa.id = bs.account_id AND oa.deleted_at IS NULL
                JOIN accounts da ON da.id = t.destination_account_id AND da.deleted_at IS NULL
                WHERE t.deleted_at IS NULL AND t.invoice_id IS NULL AND t.type IN (:transference, :investment)
                    AND da.profile_id = :profileId AND oa.profile_id <> :profileId
                    AND bs.year * 100 + bs.month = :period
            )`,
            { ...FLOW_TYPES, ...MOVE_TYPES, profileId, period: periodKey(period) },
        );
        return Money.of(row === undefined ? 0 : new RowReader('transactions', row).number('amount'), currency);
    }

    /**
     * A categoria é a da subcategoria do lançamento. O nome vem da linha mesmo quando a
     * categoria foi excluída e o gasto continua vivo, como nos relatórios (reports-design §3, Nomes).
     *
     * @param profileId Perfil consultado.
     * @param period Mês consultado.
     * @param currency Moeda do perfil.
     * @return As despesas do mês por categoria.
     */
    public expensesByCategory(profileId: ProfileId, period: YearMonth, currency: Currency): readonly CategorySpending[] {
        return this.database
            .all(
                `WITH ${OVERVIEW_FLOWS_CTE}
                SELECT c.id AS category_id, c.name, SUM(f.value) AS amount
                FROM overview_flows f
                JOIN transaction_sub_categories s ON s.id = f.sub_category_id
                JOIN transaction_categories c ON c.id = s.category_id
                WHERE f.type = :expense AND f.month_key = :period
                GROUP BY c.id, c.name`,
                { ...FLOW_TYPES, profileId, period: periodKey(period) },
            )
            .map((row) => {
                const reader = new RowReader('transaction_categories', row);
                return { categoryId: CategoryId(reader.text('category_id')), name: reader.text('name'), amount: Money.of(reader.number('amount'), currency) };
            });
    }

    /**
     * Duas fontes: os lançamentos das contas do perfil e as transferências de outro perfil que
     * chegam a elas. A compra no cartão fica fora — ela é paga com a fatura, e a fatura em aberto
     * vem do `InvoiceRepository`.
     * Regra de negócio (Extrato): o lançamento move o saldo pelo efeito na origem — a receita
     * entra sem os encargos, a despesa e a transferência saem com eles (database-design §4.13). O
     * sinal do efeito decide o sentido, para que o estorno em aberto apareça como o que é: dinheiro
     * a receber.
     *
     * @param profileId Perfil consultado.
     * @param until Último dia de vencimento.
     * @param currency Moeda do perfil.
     * @return Os lançamentos em aberto até `until`.
     */
    public pendingTransactions(profileId: ProfileId, until: LocalDate, currency: Currency): readonly PendingTransaction[] {
        const own = this.database
            .all(
                `SELECT t.id, t.name, t.type, t.value, t.charges, t.due_date, a.name AS account_name,
                    da.name AS destination_name, da.profile_id = :profileId AS internal
                FROM transactions t
                JOIN bank_statements bs ON bs.id = t.bank_statement_id AND bs.deleted_at IS NULL
                JOIN accounts a ON a.id = bs.account_id AND a.deleted_at IS NULL AND a.profile_id = :profileId
                LEFT JOIN accounts da ON da.id = t.destination_account_id AND da.deleted_at IS NULL
                WHERE t.deleted_at IS NULL AND t.invoice_id IS NULL AND ${UNPAID_SQL} AND t.due_date <= :until`,
                { profileId, until: until.toString() },
            )
            .map((row): PendingTransaction => {
                const reader = new RowReader('transactions', row);
                const type = reader.number('type');
                const value = reader.number('value');
                const charges = reader.number('charges');
                const destination = reader.nullableText('destination_name');
                const account = reader.text('account_name');
                const moves = type === TRANSACTION_TYPE_CODE.transference || type === TRANSACTION_TYPE_CODE.investment;
                const effect = type === TRANSACTION_TYPE_CODE.income ? value - charges : -(value + charges);
                const direction: PendingDirection = moves && row['internal'] === 1 ? 'transfer' : effect < 0 ? 'out' : 'in';
                return {
                    kind: 'transaction',
                    id: TransactionId(reader.text('id')),
                    name: reader.text('name'),
                    dueDate: LocalDate.parse(reader.text('due_date')),
                    direction,
                    amount: Money.of(Math.abs(effect), currency),
                    where: moves && destination !== null ? `${account} → ${destination}` : account,
                    canMarkPaid: true,
                };
            });
        const incoming = this.database
            .all(
                `SELECT t.id, t.name, t.value, t.due_date, oa.name AS origin_name, da.name AS destination_name
                FROM transactions t
                JOIN bank_statements bs ON bs.id = t.bank_statement_id AND bs.deleted_at IS NULL
                JOIN accounts oa ON oa.id = bs.account_id AND oa.deleted_at IS NULL
                JOIN accounts da ON da.id = t.destination_account_id AND da.deleted_at IS NULL
                WHERE t.deleted_at IS NULL AND t.invoice_id IS NULL AND t.type IN (:transference, :investment)
                    AND da.profile_id = :profileId AND oa.profile_id <> :profileId
                    AND ${UNPAID_SQL} AND t.due_date <= :until`,
                { ...MOVE_TYPES, profileId, until: until.toString() },
            )
            .map((row): PendingTransaction => {
                const reader = new RowReader('transactions', row);
                return {
                    kind: 'transaction',
                    id: TransactionId(reader.text('id')),
                    name: reader.text('name'),
                    dueDate: LocalDate.parse(reader.text('due_date')),
                    direction: 'in',
                    amount: Money.of(reader.number('value'), currency),
                    where: `${reader.text('origin_name')} → ${reader.text('destination_name')}`,
                    canMarkPaid: false,
                };
            });
        return [...own, ...incoming];
    }
}
