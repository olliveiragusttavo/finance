import { BalancePair } from '../../domain/balance/BalancePair.ts';
import type { AccountClosingHistory, MonthAmount, PartnerContributionTotals } from '../../domain/report/ReportTotals.ts';
import type { Currency } from '../../domain/shared/Currency.ts';
import { AccountId, PartnerId, type ProfileId } from '../../domain/shared/ids.ts';
import { Money } from '../../domain/shared/Money.ts';
import { YearMonth } from '../../domain/shared/YearMonth.ts';
import type { Database } from '../../ports/Database.ts';
import type { FixedReportRepository } from '../../repositories/FixedReportRepository.ts';
import { TRANSACTION_TYPE_CODE } from './enumCodes.ts';
import { cashDateSql, PARTNER_ENTRIES_CTE, periodFromKey, periodKey, REPORT_SOURCES_CTE } from './periodSql.ts';
import { RowReader } from './RowReader.ts';

/**
 * Contas que entram no saldo do perfil.
 * Regra de negócio (Perfil): o saldo do perfil soma só as contas com "considerar no saldo"
 * ligado; contas desativadas continuam, porque o histórico não muda (desktop-mvp-plan §5.1).
 */
const BALANCE_ACCOUNTS_SQL = 'a.profile_id = :profileId AND a.deleted_at IS NULL AND a.consider_balance = 1';

/** Implementação SQLite de `FixedReportRepository`. */
export class SqliteFixedReportRepository implements FixedReportRepository {
    /**
     * @param database Conexão compartilhada da unidade de trabalho.
     */
    public constructor(private readonly database: Database) {}

    /**
     * Lê os extratos já calculados, e não recalcula: o extrato é o cache que a rotina de
     * recálculo mantém certo (database-design §4.6).
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
            WHERE ${BALANCE_ACCOUNTS_SQL}
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

    /**
     * @param profileId Perfil consultado.
     * @return O mês do primeiro extrato vivo das contas do saldo, ou `null` sem extrato.
     */
    public firstStatementPeriod(profileId: ProfileId): YearMonth | null {
        const row = this.database.get(
            `SELECT MIN(bs.year * 100 + bs.month) AS first_key
            FROM bank_statements bs
            JOIN accounts a ON a.id = bs.account_id
            WHERE bs.deleted_at IS NULL AND ${BALANCE_ACCOUNTS_SQL}`,
            { profileId },
        );
        const key = row === undefined ? null : new RowReader('bank_statements', row).nullableNumber('first_key');
        return key === null ? null : periodFromKey(key);
    }

    /**
     * Regra de negócio (Relatórios, §9, B3): o mesmo efeito no saldo do extrato
     * (database-design §4.13, sinal de `value` e encargos), só dos lançamentos sem série e pagos,
     * pelo mês de caixa — o do extrato. Quatro caminhos levam dinheiro às contas do total:
     * - o lançamento de uma conta do total, na origem (a receita soma, os demais tipos subtraem, os
     *   encargos saem) e, na transferência ou no investimento para outra conta do total, também no
     *   destino — as duas pernas se anulam, e sobram os encargos;
     * - a transferência que chega a uma conta do total vinda de fora dele (outro perfil, ou conta
     *   fora do total), que só soma o valor;
     * - a compra no cartão, no mês em que a fatura foi paga, quando a conta que a pagou é do total:
     *   o pagamento da fatura é a saída de caixa (database-design §4.7); o pagamento parcial entra
     *   aqui também e abate as compras, porque a fatura é paga líquida dele;
     * - o pagamento parcial de fatura, que sai da conta do total no mês do próprio pagamento
     *   (database-design §4.7). Sem ele, o parcial ia parar nas "séries" (a diferença entre a
     *   variação do saldo e os avulsos) e a média dos avulsos saía com as compras brutas.
     *
     * @param profileId Perfil consultado.
     * @param from Primeiro mês pedido.
     * @param to Último mês pedido.
     * @param currency Moeda do perfil.
     * @return O efeito dos avulsos pagos por mês.
     */
    public nonRecurringResults(profileId: ProfileId, from: YearMonth, to: YearMonth, currency: Currency): readonly MonthAmount[] {
        const paid = 't.paid = 1 AND t.payment_date IS NOT NULL';
        /**
         * Os caminhos do dinheiro repetem o mesmo recorte de "conta do total" em aliases
         * diferentes; um só texto evita que um deles esqueça o `consider_balance` ou o soft delete.
         *
         * @param alias Alias da tabela `accounts` na junção.
         * @return A condição de conta viva, do perfil e no total.
         */
        const totalAccount = (alias: string): string => `${alias}.deleted_at IS NULL AND ${alias}.profile_id = :profileId AND ${alias}.consider_balance = 1`;
        const origin = `(CASE WHEN t.type = :income THEN t.value ELSE -t.value END) - t.charges`;
        return this.database
            .all(
                `SELECT flow.month_key, SUM(flow.amount) AS amount FROM (
                    SELECT bs.year * 100 + bs.month AS month_key,
                        ${origin} + CASE WHEN da.id IS NOT NULL THEN t.value ELSE 0 END AS amount
                    FROM transactions t
                    JOIN bank_statements bs ON bs.id = t.bank_statement_id AND bs.deleted_at IS NULL
                    JOIN accounts a ON a.id = bs.account_id AND ${totalAccount('a')}
                    LEFT JOIN accounts da ON da.id = t.destination_account_id AND t.type IN (:transference, :investment) AND ${totalAccount('da')}
                    WHERE t.deleted_at IS NULL AND t.recurrence_id IS NULL AND t.invoice_id IS NULL AND ${paid}
                    UNION ALL
                    SELECT bs.year * 100 + bs.month, t.value
                    FROM transactions t
                    JOIN bank_statements bs ON bs.id = t.bank_statement_id AND bs.deleted_at IS NULL
                    JOIN accounts oa ON oa.id = bs.account_id AND oa.deleted_at IS NULL
                    JOIN accounts da ON da.id = t.destination_account_id AND ${totalAccount('da')}
                    WHERE t.deleted_at IS NULL AND t.recurrence_id IS NULL AND t.invoice_id IS NULL AND ${paid}
                        AND t.type IN (:transference, :investment)
                        AND NOT (oa.profile_id = :profileId AND oa.consider_balance = 1)
                    UNION ALL
                    SELECT ps.year * 100 + ps.month, ${origin}
                    FROM transactions t
                    JOIN invoices i ON i.id = t.invoice_id AND i.deleted_at IS NULL
                    JOIN credit_cards c ON c.id = i.credit_card_id AND c.deleted_at IS NULL AND c.profile_id = :profileId
                    JOIN bank_statements ps ON ps.id = i.bank_statement_id AND ps.deleted_at IS NULL
                    JOIN accounts pa ON pa.id = ps.account_id AND ${totalAccount('pa')}
                    WHERE t.deleted_at IS NULL AND t.recurrence_id IS NULL AND t.bank_statement_id IS NULL
                        AND t.type IN (:income, :expense, :transference)
                    UNION ALL
                    SELECT CAST(strftime('%Y', ${cashDateSql('t')}) AS INTEGER) * 100 + CAST(strftime('%m', ${cashDateSql('t')}) AS INTEGER), t.value
                    FROM transactions t
                    JOIN invoices i ON i.id = t.invoice_id AND i.deleted_at IS NULL
                    JOIN accounts da ON da.id = t.destination_account_id AND ${totalAccount('da')}
                    WHERE t.deleted_at IS NULL AND t.recurrence_id IS NULL AND t.bank_statement_id IS NULL AND ${paid}
                        AND t.type = :transference
                ) flow
                WHERE flow.month_key BETWEEN :from AND :to
                GROUP BY flow.month_key`,
                {
                    profileId,
                    from: periodKey(from),
                    to: periodKey(to),
                    income: TRANSACTION_TYPE_CODE.income,
                    expense: TRANSACTION_TYPE_CODE.expense,
                    transference: TRANSACTION_TYPE_CODE.transference,
                    investment: TRANSACTION_TYPE_CODE.investment,
                },
            )
            .map((row) => {
                const reader = new RowReader('transactions', row);
                return { period: periodFromKey(reader.number('month_key')), amount: Money.of(reader.number('amount'), currency) };
            });
    }

    /**
     * O sócio entra pelo `LEFT JOIN` só quando está vivo e é do perfil consultado: um vínculo com
     * sócio excluído — o `SET NULL` da chave só age na exclusão física, e o app exclui com soft
     * delete — cai no grupo sem sócio, que a tela pede para atribuir de novo.
     *
     * @param profileId Perfil empresarial consultado.
     * @param period Mês de referência, que recorta a parte do mês de cada soma.
     * @param currency Moeda do perfil.
     * @return As somas das entradas por sócio, de todos os períodos e do mês, e a das sem sócio
     * com `partnerId` nulo.
     */
    public contributionTotalsByPartner(profileId: ProfileId, period: YearMonth, currency: Currency): readonly PartnerContributionTotals[] {
        return this.database
            .all(
                `WITH ${REPORT_SOURCES_CTE}, ${PARTNER_ENTRIES_CTE}
                SELECT pa.id AS partner_id, SUM(pe.amount) AS total, COUNT(*) AS count,
                    SUM(CASE WHEN pe.payment_key = :period THEN pe.amount ELSE 0 END) AS month_total,
                    SUM(CASE WHEN pe.payment_key = :period THEN 1 ELSE 0 END) AS month_count
                FROM partner_entries pe
                LEFT JOIN partners pa ON pa.id = pe.partner_id AND pa.deleted_at IS NULL AND pa.profile_id = :profileId
                GROUP BY pa.id`,
                { profileId, income: TRANSACTION_TYPE_CODE.income, transference: TRANSACTION_TYPE_CODE.transference, period: periodKey(period) },
            )
            .map((row) => {
                const reader = new RowReader('transactions', row);
                const partnerId = reader.nullableText('partner_id');
                return {
                    partnerId: partnerId === null ? null : PartnerId(partnerId),
                    total: Money.of(reader.number('total'), currency),
                    count: reader.number('count'),
                    month: Money.of(reader.number('month_total'), currency),
                    monthCount: reader.number('month_count'),
                };
            });
    }
}
