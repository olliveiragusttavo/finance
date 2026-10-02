import type {
    IncomingTotals,
    InvoiceTypeTotals,
    MovementSources,
    OpenInvoice,
    OriginTotals,
    PaidInvoiceTotals,
} from '../../domain/balance/MonthlyMovement.ts';
import { BillingCycle } from '../../domain/creditCard/BillingCycle.ts';
import type { Currency } from '../../domain/shared/Currency.ts';
import type { AccountId, InvoiceId } from '../../domain/shared/ids.ts';
import { LocalDate } from '../../domain/shared/LocalDate.ts';
import { Money } from '../../domain/shared/Money.ts';
import { YearMonth } from '../../domain/shared/YearMonth.ts';
import type { Database } from '../../ports/Database.ts';
import type { BalanceLedgerRepository } from '../../repositories/BalanceLedgerRepository.ts';
import { decodeEnum, TRANSACTION_TYPE_CODE } from './enumCodes.ts';
import { periodKey } from './periodSql.ts';
import { RowReader } from './RowReader.ts';

/**
 * Implementação SQLite de `BalanceLedgerRepository`. Toda consulta filtra
 * `deleted_at IS NULL` em cada tabela envolvida: esquecer isso numa soma de saldo
 * ressuscita transações excluídas nos totais — um número errado, não um erro
 * (database-design §3.6). Toda consulta também exige o arco exclusivo íntegro (exatamente
 * um contêiner), para que uma linha inválida não seja contada duas vezes.
 */
export class SqliteBalanceLedgerRepository implements BalanceLedgerRepository {
    /**
     * @param database Conexão compartilhada da unidade de trabalho.
     */
    public constructor(private readonly database: Database) {}

    /**
     * @param accountId Conta recalculada.
     * @param from Primeira competência considerada.
     * @param currency Moeda do perfil.
     * @return As somas que formam o movimento mensal da conta a partir de `from`.
     */
    public movementSources(accountId: AccountId, from: YearMonth, currency: Currency): MovementSources {
        return {
            origin: this.originTotals(accountId, from, currency),
            incoming: this.incomingTotals(accountId, from, currency),
            paidInvoices: this.paidInvoiceTotals(accountId, from, currency),
            openInvoices: this.openInvoices(accountId, from, currency),
        };
    }

    /**
     * @param invoiceId Fatura recalculada.
     * @param currency Moeda do perfil.
     * @return As somas por tipo das transações vivas da fatura, pagas ou não.
     */
    public invoiceTypeTotals(invoiceId: InvoiceId, currency: Currency): readonly InvoiceTypeTotals[] {
        return this.database
            .all(
                `SELECT t.type, SUM(t.value) AS value, SUM(t.charges) AS charges
                FROM transactions t
                WHERE t.invoice_id = :invoiceId AND t.bank_statement_id IS NULL AND t.deleted_at IS NULL
                GROUP BY t.type`,
                { invoiceId },
            )
            .map((row) => {
                const reader = new RowReader('transactions', row);
                return {
                    type: decodeEnum(TRANSACTION_TYPE_CODE, reader.number('type'), 'transactions'),
                    value: Money.of(reader.number('value'), currency),
                    charges: Money.of(reader.number('charges'), currency),
                };
            });
    }

    /**
     * @param accountId Conta recalculada.
     * @param from Primeira competência considerada.
     * @param currency Moeda do perfil.
     * @return Somas das transações dos extratos da conta, por mês, tipo e pago.
     */
    private originTotals(accountId: AccountId, from: YearMonth, currency: Currency): OriginTotals[] {
        return this.database
            .all(
                `SELECT bs.year, bs.month, t.type, t.paid, SUM(t.value) AS value, SUM(t.charges) AS charges
                FROM transactions t
                JOIN bank_statements bs ON bs.id = t.bank_statement_id
                WHERE bs.account_id = :accountId AND bs.deleted_at IS NULL AND (bs.year * 100 + bs.month) >= :from
                    AND t.deleted_at IS NULL AND t.invoice_id IS NULL
                GROUP BY bs.year, bs.month, t.type, t.paid`,
                { accountId, from: periodKey(from) },
            )
            .map((row) => {
                const reader = new RowReader('transactions', row);
                return {
                    period: YearMonth.of(reader.number('year'), reader.number('month')),
                    type: decodeEnum(TRANSACTION_TYPE_CODE, reader.number('type'), 'transactions'),
                    paid: reader.boolean('paid'),
                    value: Money.of(reader.number('value'), currency),
                    charges: Money.of(reader.number('charges'), currency),
                };
            });
    }

    /**
     * Transferências e investimentos que chegam à conta caem no mês do `due_date`, não no
     * mês do contêiner de origem — a transferência é uma linha só, com uma data só
     * (database-design §4.13).
     *
     * @param accountId Conta de destino.
     * @param from Primeira competência considerada.
     * @param currency Moeda do perfil.
     * @return Somas das entradas por mês e pago.
     */
    private incomingTotals(accountId: AccountId, from: YearMonth, currency: Currency): IncomingTotals[] {
        return this.database
            .all(
                `SELECT CAST(substr(t.due_date, 1, 4) AS INTEGER) AS due_year, CAST(substr(t.due_date, 6, 2) AS INTEGER) AS due_month,
                    t.paid, SUM(t.value) AS value
                FROM transactions t
                LEFT JOIN bank_statements bs ON bs.id = t.bank_statement_id AND bs.deleted_at IS NULL
                LEFT JOIN invoices i ON i.id = t.invoice_id AND i.deleted_at IS NULL
                WHERE t.destination_account_id = :accountId AND t.type IN (3, 4) AND t.deleted_at IS NULL
                    AND t.due_date >= :fromDate
                    AND ((bs.id IS NOT NULL AND t.invoice_id IS NULL) OR (i.id IS NOT NULL AND t.bank_statement_id IS NULL))
                GROUP BY due_year, due_month, t.paid`,
                { accountId, fromDate: LocalDate.of(from.year, from.month, 1).toString() },
            )
            .map((row) => {
                const reader = new RowReader('transactions', row);
                return {
                    period: YearMonth.of(reader.number('due_year'), reader.number('due_month')),
                    paid: reader.boolean('paid'),
                    value: Money.of(reader.number('value'), currency),
                };
            });
    }

    /**
     * @param accountId Conta dona dos extratos de pagamento.
     * @param from Primeira competência considerada.
     * @param currency Moeda do perfil.
     * @return Somas dos totais das faturas pagas, por mês do extrato de pagamento.
     */
    private paidInvoiceTotals(accountId: AccountId, from: YearMonth, currency: Currency): PaidInvoiceTotals[] {
        return this.database
            .all(
                `SELECT bs.year, bs.month, SUM(i.balance) AS balance
                FROM invoices i
                JOIN bank_statements bs ON bs.id = i.bank_statement_id
                WHERE bs.account_id = :accountId AND bs.deleted_at IS NULL AND i.deleted_at IS NULL
                    AND (bs.year * 100 + bs.month) >= :from
                GROUP BY bs.year, bs.month`,
                { accountId, from: periodKey(from) },
            )
            .map((row) => {
                const reader = new RowReader('invoices', row);
                return {
                    period: YearMonth.of(reader.number('year'), reader.number('month')),
                    balance: Money.of(reader.number('balance'), currency),
                };
            });
    }

    /**
     * Busca a partir do mês anterior a `from` porque o vencimento cai no mês da fatura ou no
     * seguinte (`BillingCycle.dueDateOf`): uma fatura de fevereiro pode vencer em março.
     * Quem descarta vencimentos anteriores a `from` é o domínio, que conhece a regra.
     *
     * @param accountId Conta que quita os cartões.
     * @param from Primeira competência considerada.
     * @param currency Moeda do perfil.
     * @return As faturas em aberto dos cartões vivos da conta, com o ciclo de cada cartão.
     */
    private openInvoices(accountId: AccountId, from: YearMonth, currency: Currency): OpenInvoice[] {
        return this.database
            .all(
                `SELECT i.year, i.month, i.balance, c.closing_date, c.due_date
                FROM invoices i
                JOIN credit_cards c ON c.id = i.credit_card_id
                LEFT JOIN bank_statements bs ON bs.id = i.bank_statement_id AND bs.deleted_at IS NULL
                WHERE c.account_id = :accountId AND c.deleted_at IS NULL AND i.deleted_at IS NULL AND bs.id IS NULL
                    AND (i.year * 100 + i.month) >= :from`,
                // Um ano antes, e não `from.previous()`: cobre o mês anterior sem quebrar em
                // 1900-01, e o excesso é descartado pelo filtro de vencimento abaixo.
                { accountId, from: periodKey(from) - 100 },
            )
            .map((row) => {
                const reader = new RowReader('invoices', row);
                return {
                    invoicePeriod: YearMonth.of(reader.number('year'), reader.number('month')),
                    billingCycle: BillingCycle.of(reader.number('closing_date'), reader.number('due_date')),
                    balance: Money.of(reader.number('balance'), currency),
                };
            })
            .filter((invoice) => !invoice.billingCycle.dueDateOf(invoice.invoicePeriod).period.isBefore(from));
    }
}
