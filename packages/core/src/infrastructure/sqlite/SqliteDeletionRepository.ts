import { AccountId, BankStatementId, CreditCardId, InvoiceId, RecurrenceId, TransactionId } from '../../domain/shared/ids.ts';
import { CorruptRowError } from '../../domain/shared/errors.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { Database, SqlParams } from '../../ports/Database.ts';
import type { DeletionRepository, DeletionScope, DoomedTransaction, DoomedTransactionRole } from '../../repositories/DeletionRepository.ts';
import { decodeEnum, TRANSACTION_TYPE_CODE } from './enumCodes.ts';
import { RowReader } from './RowReader.ts';

/**
 * Transações vivas em contêiner vivo, com as contas que cada uma move: a dona do extrato
 * de origem, a pagadora do cartão da fatura de origem e a de destino. O filtro de arco
 * exclusivo é o mesmo do `SqliteBalanceLedgerRepository`, para que a exclusão apague
 * exatamente o que entra nos saldos.
 */
const SELECT_LIVE_TRANSACTIONS = `
    SELECT t.id, t.type, t.destination_account_id, bs.account_id AS statement_account_id,
        c.id AS card_id, c.account_id AS card_account_id
    FROM transactions t
    LEFT JOIN bank_statements bs ON bs.id = t.bank_statement_id AND bs.deleted_at IS NULL
    LEFT JOIN invoices i ON i.id = t.invoice_id AND i.deleted_at IS NULL
    LEFT JOIN credit_cards c ON c.id = i.credit_card_id AND c.deleted_at IS NULL
    WHERE t.deleted_at IS NULL
        AND ((bs.id IS NOT NULL AND t.invoice_id IS NULL) OR (c.id IS NOT NULL AND t.bank_statement_id IS NULL))
`;

/**
 * Uma fatura do escopo com as duas contas cujo saldo ela pode mover. As duas são guardadas
 * porque divergem quando a conta pagadora do cartão é trocada depois de a fatura ter sido
 * paga: o previsto da fatura em aberto pesa na pagadora atual, mas a fatura paga continua
 * pesando na conta dona do extrato em que o pagamento entrou.
 */
interface InvoiceRow {
    readonly id: InvoiceId;
    readonly payingAccountId: AccountId;
    readonly paidInAccountId: AccountId | null;
}

/** Implementação SQLite de `DeletionRepository`. */
export class SqliteDeletionRepository implements DeletionRepository {
    /**
     * @param database Conexão compartilhada da unidade de trabalho.
     * @param clock Relógio que carimba `deleted_at` e `updated_at`.
     */
    public constructor(private readonly database: Database, private readonly clock: Clock) {}

    /**
     * @param accountId Conta a excluir.
     * @return O escopo: a conta, seus extratos, cartões, faturas e transações, as
     * transferências que chegam a ela e as faturas de outros cartões pagas nos extratos dela.
     */
    public accountScope(accountId: AccountId): DeletionScope {
        const params = { accountId };
        const statements = this.ids(
            'SELECT id FROM bank_statements WHERE account_id = :accountId AND deleted_at IS NULL ORDER BY year, month',
            params,
            BankStatementId,
        );
        const creditCards = this.ids(
            'SELECT id FROM credit_cards WHERE account_id = :accountId AND deleted_at IS NULL ORDER BY id',
            params,
            CreditCardId,
        );
        const invoices = this.invoices(
            `WHERE c.account_id = :accountId AND c.deleted_at IS NULL AND i.deleted_at IS NULL`,
            params,
        );
        const reopened = this.invoices(
            `JOIN bank_statements bs ON bs.id = i.bank_statement_id AND bs.deleted_at IS NULL
            WHERE bs.account_id = :accountId AND i.deleted_at IS NULL AND c.deleted_at IS NULL AND c.account_id <> :accountId`,
            params,
        );
        const transactions = this.transactions(
            `AND (bs.account_id = :accountId OR c.account_id = :accountId OR t.destination_account_id = :accountId)`,
            params,
            (row) => {
                if (row.statementAccountId === accountId) {
                    return 'statement';
                }
                return row.cardAccountId === accountId ? 'creditCard' : 'incoming';
            },
        );
        return {
            accounts: [accountId],
            creditCards,
            statements,
            invoices: invoices.map((invoice) => invoice.id),
            transactions: transactions.map(({ doomed }) => doomed),
            recurrences: this.ids(
                `SELECT r.id FROM recurrences r LEFT JOIN credit_cards c ON c.id = r.credit_card_id
                WHERE r.deleted_at IS NULL AND (r.account_id = :accountId OR r.destination_account_id = :accountId OR c.account_id = :accountId)
                ORDER BY r.id`,
                params,
                RecurrenceId,
            ),
            reopenedInvoices: reopened.map((invoice) => invoice.id),
            touchedAccounts: unique([
                accountId,
                ...invoices.flatMap(accountsOf),
                ...reopened.map((invoice) => invoice.payingAccountId),
                ...transactions.flatMap(({ touched }) => touched),
            ]),
        };
    }

    /**
     * @param creditCardId Cartão a excluir.
     * @return O escopo: o cartão, suas faturas e os lançamentos delas.
     */
    public creditCardScope(creditCardId: CreditCardId): DeletionScope {
        const params = { creditCardId };
        const invoices = this.invoices('WHERE i.credit_card_id = :creditCardId AND i.deleted_at IS NULL AND c.deleted_at IS NULL', params);
        const transactions = this.transactions('AND c.id = :creditCardId', params, () => 'creditCard');
        return {
            accounts: [],
            creditCards: [creditCardId],
            statements: [],
            invoices: invoices.map((invoice) => invoice.id),
            transactions: transactions.map(({ doomed }) => doomed),
            recurrences: this.ids('SELECT id FROM recurrences WHERE credit_card_id = :creditCardId AND deleted_at IS NULL ORDER BY id', params, RecurrenceId),
            reopenedInvoices: [],
            touchedAccounts: unique([
                ...invoices.flatMap(accountsOf),
                ...transactions.flatMap(({ touched }) => touched),
            ]),
        };
    }

    /**
     * Apaga de baixo para cima no grafo de propriedade — faturas, extratos, cartões, contas
     * — só por organização: dentro da unidade de trabalho a ordem não muda o resultado, e o
     * soft delete não dispara cascade nenhum (database-design §3.6). As recorrências do escopo
     * saem junto, com as tags do modelo, para que o complemento não emita para quem não existe.
     *
     * @param scope Escopo calculado na mesma unidade de trabalho.
     * @return void
     */
    public softDeleteContainers(scope: DeletionScope): void {
        const now = this.clock.now();
        const tables: readonly (readonly [string, readonly string[]])[] = [
            ['invoices', scope.invoices],
            ['bank_statements', scope.statements],
            ['credit_cards', scope.creditCards],
            ['accounts', scope.accounts],
        ];
        for (const [table, ids] of tables) {
            for (const id of ids) {
                this.database.run(`UPDATE ${table} SET deleted_at = :now, updated_at = :now WHERE id = :id AND deleted_at IS NULL`, { id, now });
            }
        }
        for (const id of scope.recurrences) {
            this.database.run('UPDATE recurrences SET deleted_at = :now, updated_at = :now WHERE id = :id AND deleted_at IS NULL', { id, now });
            this.database.run('UPDATE recurrences_tags SET deleted_at = :now, updated_at = :now WHERE recurrence_id = :id AND deleted_at IS NULL', { id, now });
        }
    }

    /**
     * @param sql Consulta que devolve a coluna `id`.
     * @param params Parâmetros nomeados.
     * @param parse Conversor do id marcado.
     * @return Os ids, na ordem da consulta.
     */
    private ids<T>(sql: string, params: SqlParams, parse: (raw: string) => T): readonly T[] {
        return this.database.all(sql, params).map((row) => parse(new RowReader('deletion', row).text('id')));
    }

    /**
     * Lê também a conta do extrato de pagamento (alias `ps`, para não colidir com o `bs`
     * que as cláusulas podem juntar), porque apagar uma fatura paga refaz o saldo dessa
     * conta, que não é necessariamente a pagadora atual do cartão.
     *
     * @param clause Joins extras e `WHERE` sobre `invoices i` e `credit_cards c`.
     * @param params Parâmetros nomeados.
     * @return As faturas com a conta pagadora do cartão e, se pagas, a conta do extrato em
     * que foram pagas, em ordem estável.
     */
    private invoices(clause: string, params: SqlParams): readonly InvoiceRow[] {
        return this.database
            .all(
                `SELECT i.id, c.account_id, ps.account_id AS paid_in_account_id
                FROM invoices i
                JOIN credit_cards c ON c.id = i.credit_card_id
                LEFT JOIN bank_statements ps ON ps.id = i.bank_statement_id AND ps.deleted_at IS NULL
                ${clause}
                ORDER BY i.year, i.month, i.id`,
                params,
            )
            .map((row) => {
                const reader = new RowReader('invoices', row);
                return {
                    id: InvoiceId(reader.text('id')),
                    payingAccountId: AccountId(reader.text('account_id')),
                    paidInAccountId: optionalAccount(reader.nullableText('paid_in_account_id')),
                };
            });
    }

    /**
     * @param clause Condição extra sobre `SELECT_LIVE_TRANSACTIONS`.
     * @param params Parâmetros nomeados.
     * @param roleOf Classifica a transação no escopo, a partir das contas que ela move.
     * @return As transações do escopo, cada uma com as contas cujo saldo ela move.
     * @throws {CorruptRowError} Quando uma transação viva não tem conta de origem — o arco
     * exclusivo do filtro garante que sempre tem.
     */
    private transactions(
        clause: string,
        params: SqlParams,
        roleOf: (row: { readonly statementAccountId: AccountId | null; readonly cardAccountId: AccountId | null }) => DoomedTransactionRole,
    ): readonly { readonly doomed: DoomedTransaction; readonly touched: readonly AccountId[] }[] {
        return this.database.all(`${SELECT_LIVE_TRANSACTIONS} ${clause} ORDER BY t.due_date, t.id`, params).map((row) => {
            const reader = new RowReader('transactions', row);
            const statementAccountId = optionalAccount(reader.nullableText('statement_account_id'));
            const cardAccountId = optionalAccount(reader.nullableText('card_account_id'));
            const destinationAccountId = optionalAccount(reader.nullableText('destination_account_id'));
            const origin = statementAccountId ?? cardAccountId;
            if (origin === null) {
                throw new CorruptRowError('transactions', `transação ${reader.text('id')} sem conta de origem`);
            }
            return {
                doomed: {
                    id: TransactionId(reader.text('id')),
                    type: decodeEnum(TRANSACTION_TYPE_CODE, reader.number('type'), 'transactions'),
                    role: roleOf({ statementAccountId, cardAccountId }),
                },
                touched: destinationAccountId === null ? [origin] : [origin, destinationAccountId],
            };
        });
    }
}

/**
 * Regra de negócio (Exclusão em cadeia, desktop-mvp-plan §5.1): apagar uma fatura refaz o
 * saldo de toda conta em que ela pesa — a pagadora atual do cartão (previsto) e a dona do
 * extrato em que foi paga (realizado), que divergem se a pagadora mudou após o pagamento.
 *
 * @param invoice Fatura do escopo.
 * @return As contas cujo saldo a exclusão da fatura altera.
 */
function accountsOf(invoice: InvoiceRow): readonly AccountId[] {
    return invoice.paidInAccountId === null ? [invoice.payingAccountId] : [invoice.payingAccountId, invoice.paidInAccountId];
}

/**
 * @param raw Id lido de uma coluna anulável.
 * @return A conta, ou `null`.
 */
function optionalAccount(raw: string | null): AccountId | null {
    return raw === null ? null : AccountId(raw);
}

/**
 * @param ids Contas com possíveis repetições.
 * @return As contas sem repetição, na ordem da primeira aparição — ordem estável para o
 * alerta e para o recálculo.
 */
function unique(ids: readonly AccountId[]): readonly AccountId[] {
    return [...new Set(ids)];
}
