import { Invoice } from '../../domain/invoice/Invoice.ts';
import { Currency } from '../../domain/shared/Currency.ts';
import { BankStatementId, CreditCardId, InvoiceId, type AccountId } from '../../domain/shared/ids.ts';
import { LocalDate } from '../../domain/shared/LocalDate.ts';
import { Money } from '../../domain/shared/Money.ts';
import { YearMonth } from '../../domain/shared/YearMonth.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { Database, SqlRow } from '../../ports/Database.ts';
import type { InvoiceRepository, InvoiceWithCard } from '../../repositories/InvoiceRepository.ts';
import { SELECT_CREDIT_CARD_COLUMNS, toCreditCard } from './SqliteCreditCardRepository.ts';
import { periodKey } from './periodSql.ts';
import { RowReader } from './RowReader.ts';

// O extrato do pagamento entra por LEFT JOIN só se estiver vivo: uma fatura vinculada a um
// extrato excluído é tratada como em aberto em toda leitura, em vez de sumir das duas
// listas (nem paga, nem em aberto). O `payment_date` só vale junto desse vínculo.
const SELECT_INVOICE = `
    SELECT i.id, i.credit_card_id, i.year, i.month, i.balance, i.payment_date,
        ps.id AS paid_statement_id, ps.year AS paid_year, ps.month AS paid_month,
        ${SELECT_CREDIT_CARD_COLUMNS}, p.currency AS profile_currency
    FROM invoices i
    JOIN credit_cards c ON c.id = i.credit_card_id
    JOIN profiles p ON p.id = c.profile_id
    LEFT JOIN bank_statements ps ON ps.id = i.bank_statement_id AND ps.deleted_at IS NULL
`;

/** Implementação SQLite de `InvoiceRepository`. */
export class SqliteInvoiceRepository implements InvoiceRepository {
    /**
     * @param database Conexão compartilhada da unidade de trabalho.
     * @param clock Relógio que carimba `updated_at`.
     */
    public constructor(private readonly database: Database, private readonly clock: Clock) {}

    /**
     * @param id Fatura procurada.
     * @return A fatura viva, ou `null`.
     */
    public findById(id: InvoiceId): Invoice | null {
        const row = this.database.get(`${SELECT_INVOICE} WHERE i.id = :id AND i.deleted_at IS NULL`, { id });
        return row === undefined ? null : this.toInvoice(row);
    }

    /**
     * @param creditCardId Cartão dono da fatura.
     * @param period Competência procurada.
     * @return A fatura viva daquele mês, ou `null`.
     */
    public findByPeriod(creditCardId: CreditCardId, period: YearMonth): Invoice | null {
        const row = this.database.get(
            `${SELECT_INVOICE} WHERE i.credit_card_id = :creditCardId AND i.year = :year AND i.month = :month AND i.deleted_at IS NULL`,
            { creditCardId, year: period.year, month: period.month },
        );
        return row === undefined ? null : this.toInvoice(row);
    }

    /**
     * @param creditCardId Cartão dono das faturas.
     * @return As faturas vivas do cartão, em ordem cronológica.
     */
    public listByCard(creditCardId: CreditCardId): readonly Invoice[] {
        return this.database
            .all(`${SELECT_INVOICE} WHERE i.credit_card_id = :creditCardId AND i.deleted_at IS NULL ORDER BY i.year, i.month`, { creditCardId })
            .map((row) => this.toInvoice(row));
    }

    /**
     * @param invoice Fatura a garantir; revive a linha com o mesmo id determinístico.
     * @return void
     */
    public insertOrRevive(invoice: Invoice): void {
        this.database.run(
            `INSERT INTO invoices (id, credit_card_id, bank_statement_id, payment_date, month, year, balance, updated_at)
            VALUES (:id, :creditCardId, :statementId, :paymentDate, :month, :year, :balance, :now)
            ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, updated_at = excluded.updated_at
            WHERE invoices.deleted_at IS NOT NULL`,
            {
                id: invoice.id,
                creditCardId: invoice.creditCardId,
                statementId: invoice.payment?.statementId ?? null,
                paymentDate: invoice.payment?.date?.toString() ?? null,
                month: invoice.period.month,
                year: invoice.period.year,
                balance: invoice.balance.rounded().amount,
                now: this.clock.now(),
            },
        );
    }

    /**
     * @param invoice Fatura com o total recalculado.
     * @return void
     */
    public saveBalance(invoice: Invoice): void {
        this.database.run(
            'UPDATE invoices SET balance = :balance, updated_at = :now WHERE id = :id',
            { id: invoice.id, balance: invoice.balance.rounded().amount, now: this.clock.now() },
        );
    }

    /**
     * Grava o vínculo e o dia juntos, na mesma escrita, para que reabrir apague os dois — um dia
     * de pagamento sobrando numa fatura em aberto voltaria a valer no próximo pagamento.
     *
     * @param invoice Fatura paga ou reaberta.
     * @return void
     */
    public savePayment(invoice: Invoice): void {
        this.database.run(
            'UPDATE invoices SET bank_statement_id = :statementId, payment_date = :paymentDate, updated_at = :now WHERE id = :id',
            {
                id: invoice.id,
                statementId: invoice.payment?.statementId ?? null,
                paymentDate: invoice.payment?.date?.toString() ?? null,
                now: this.clock.now(),
            },
        );
    }

    /**
     * @param statementId Extrato do mês do pagamento.
     * @return As faturas vivas pagas naquele extrato, com o cartão.
     */
    public listPaidInStatement(statementId: BankStatementId): readonly InvoiceWithCard[] {
        return this.database
            .all(`${SELECT_INVOICE} WHERE ps.id = :statementId AND i.deleted_at IS NULL ORDER BY c.name COLLATE NOCASE, i.year, i.month`, { statementId })
            .map((row) => this.toInvoiceWithCard(row));
    }

    /**
     * @param accountId Conta que quita os cartões.
     * @param fromInvoicePeriod Primeira competência de fatura incluída.
     * @return As faturas em aberto dos cartões vivos da conta, com o cartão.
     */
    public listOpenByPayingAccount(accountId: AccountId, fromInvoicePeriod: YearMonth): readonly InvoiceWithCard[] {
        return this.database
            .all(
                `${SELECT_INVOICE}
                WHERE c.account_id = :accountId AND c.deleted_at IS NULL AND i.deleted_at IS NULL
                    AND ps.id IS NULL AND (i.year * 100 + i.month) >= :from
                ORDER BY i.year, i.month, c.name COLLATE NOCASE`,
                { accountId, from: periodKey(fromInvoicePeriod) },
            )
            .map((row) => this.toInvoiceWithCard(row));
    }

    /**
     * @param accountId Conta que quita os cartões.
     * @return Os ids das faturas vivas dos cartões vivos da conta.
     */
    public listIdsByPayingAccount(accountId: AccountId): readonly InvoiceId[] {
        return this.database
            .all(
                `SELECT i.id FROM invoices i
                JOIN credit_cards c ON c.id = i.credit_card_id
                WHERE c.account_id = :accountId AND c.deleted_at IS NULL AND i.deleted_at IS NULL
                ORDER BY i.year, i.month`,
                { accountId },
            )
            .map((row) => InvoiceId(new RowReader('invoices', row).text('id')));
    }

    /**
     * @param row Linha do `SELECT_INVOICE`, que já traz as colunas do cartão.
     * @return A fatura e o cartão dono; um só ponto de leitura para as listas que mostram o
     * cartão ou precisam do ciclo dele.
     */
    private toInvoiceWithCard(row: SqlRow): InvoiceWithCard {
        return {
            invoice: this.toInvoice(row),
            creditCard: toCreditCard(row, Currency.of(new RowReader('invoices', row).text('profile_currency'))),
        };
    }

    /**
     * @param row Linha do `SELECT_INVOICE`.
     * @return A fatura de domínio.
     */
    private toInvoice(row: SqlRow): Invoice {
        const reader = new RowReader('invoices', row);
        const paidStatementId = reader.nullableText('paid_statement_id');
        const paymentDate = reader.nullableText('payment_date');
        return Invoice.restore({
            id: InvoiceId(reader.text('id')),
            creditCardId: CreditCardId(reader.text('credit_card_id')),
            period: YearMonth.of(reader.number('year'), reader.number('month')),
            payment: paidStatementId === null
                ? null
                : {
                    statementId: BankStatementId(paidStatementId),
                    period: YearMonth.of(reader.number('paid_year'), reader.number('paid_month')),
                    date: paymentDate === null ? null : LocalDate.parse(paymentDate),
                },
            balance: Money.of(reader.number('balance'), Currency.of(reader.text('profile_currency'))),
        });
    }
}
