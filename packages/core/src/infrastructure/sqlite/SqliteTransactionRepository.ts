import type { CategoryScope } from '../../domain/report/CategoryScope.ts';
import { Currency } from '../../domain/shared/Currency.ts';
import { transactionTagIdFor } from '../../domain/shared/DeterministicIds.ts';
import { CorruptRowError } from '../../domain/shared/errors.ts';
import {
    AccountId,
    BankStatementId,
    CreditCardId,
    GoalId,
    InvoiceId,
    PartnerId,
    ProfileId,
    RecurrenceId,
    SubCategoryId,
    TagId,
    TransactionId,
} from '../../domain/shared/ids.ts';
import { LocalDate } from '../../domain/shared/LocalDate.ts';
import { Money } from '../../domain/shared/Money.ts';
import { YearMonth } from '../../domain/shared/YearMonth.ts';
import { Transaction } from '../../domain/transaction/Transaction.ts';
import type { TransactionContainer } from '../../domain/transaction/TransactionContainer.ts';
import { parseTimestamp, type Clock, type Timestamp } from '../../ports/Clock.ts';
import type { Database, SqlParams, SqlRow } from '../../ports/Database.ts';
import type { RowStamps, TransactionRepository } from '../../repositories/TransactionRepository.ts';
import { decodeEnum, TRANSACTION_TYPE_CODE } from './enumCodes.ts';
import { cashDateSql, monthBounds, periodKey, REPORT_SOURCES_CTE } from './periodSql.ts';
import { RowReader } from './RowReader.ts';

// As tags vêm numa coluna só, por nome, para que toda leitura de transação já traga o
// conjunto sem uma segunda consulta por linha; vínculo ou tag excluídos ficam de fora.
// O perfil e a moeda vêm do contêiner (extrato → conta, fatura → cartão), porque a
// transação não tem `profile_id` próprio. Contêineres excluídos ficam de fora: uma
// transação num extrato excluído não existe mais para o usuário.
const SELECT_TRANSACTION = `
    SELECT t.id, t.sub_category_id, t.bank_statement_id, t.invoice_id, t.destination_account_id,
        t.partner_id, t.goal_id, t.recurrence_id, t.occurrence, t.name, t.description, t.value, t.currency,
        t.conversion_rate, t.due_date, t.paid, t.payment_date, t.charges, t.type,
        bs.account_id AS statement_account_id, bs.year AS statement_year, bs.month AS statement_month,
        i.credit_card_id AS invoice_card_id, i.year AS invoice_year, i.month AS invoice_month,
        p.id AS profile_id, p.currency AS profile_currency,
        (SELECT group_concat(linked.tag_id, ',') FROM (
            SELECT tt.tag_id FROM transactions_tags tt
            JOIN tags tg ON tg.id = tt.tag_id AND tg.deleted_at IS NULL
            WHERE tt.transaction_id = t.id AND tt.deleted_at IS NULL
            ORDER BY tg.name COLLATE NOCASE, tg.id
        ) linked) AS tag_ids
    FROM transactions t
    LEFT JOIN bank_statements bs ON bs.id = t.bank_statement_id AND bs.deleted_at IS NULL
    LEFT JOIN accounts a ON a.id = bs.account_id
    LEFT JOIN invoices i ON i.id = t.invoice_id AND i.deleted_at IS NULL
    LEFT JOIN credit_cards c ON c.id = i.credit_card_id
    JOIN profiles p ON p.id = COALESCE(a.profile_id, c.profile_id)
`;

const ORDER = 'ORDER BY t.due_date, t.created_at, t.id';

/** Implementação SQLite de `TransactionRepository`. */
export class SqliteTransactionRepository implements TransactionRepository {
    /**
     * @param database Conexão compartilhada da unidade de trabalho.
     * @param clock Relógio que carimba `updated_at` e `deleted_at`.
     */
    public constructor(private readonly database: Database, private readonly clock: Clock) {}

    /**
     * @param id Transação procurada.
     * @return A transação viva, ou `null`.
     */
    public findById(id: TransactionId): Transaction | null {
        const row = this.database.get(`${SELECT_TRANSACTION} WHERE t.id = :id AND t.deleted_at IS NULL`, { id });
        return row === undefined ? null : this.toTransaction(row);
    }

    /**
     * Grava uma transação nova. Uma ocorrência de recorrência tem id derivado do número
     * (`occurrenceIdFor`), então gerar de novo um número que já existiu e foi excluído encontra
     * a linha antiga: ela é **revivida** com o conteúdo novo, em vez de esbarrar na chave
     * primária (sync-design §5.6). A revivida ganha `created_at` novo, pelo relógio do motor
     * como no insert (database-design §3.6): para o usuário é uma ocorrência nova, e o
     * `created_at` antigo a faria parecer editada à mão no diálogo de revisão.
     *
     * @param transaction Transação nova.
     * @return void
     * @throws {Error} Quando o id já é de uma transação viva — um erro de programação, porque
     * ids aleatórios não colidem e a emissão de uma série pula os números que já estão vivos.
     * Ignorar a colisão aqui esconderia o erro e deixaria o Service somar no saldo o impacto de
     * uma linha que não foi gravada.
     */
    public insert(transaction: Transaction): void {
        const { changes } = this.database.run(
            `INSERT INTO transactions (id, sub_category_id, bank_statement_id, invoice_id, destination_account_id,
                partner_id, goal_id, recurrence_id, occurrence, name, description, value, currency, conversion_rate,
                due_date, paid, payment_date, charges, type, updated_at)
            VALUES (:id, :subCategoryId, :statementId, :invoiceId, :destinationAccountId,
                :partnerId, :goalId, :recurrenceId, :occurrence, :name, :description, :value, :currency, :conversionRate,
                :dueDate, :paid, :paymentDate, :charges, :type, :now)
            ON CONFLICT (id) DO UPDATE SET sub_category_id = excluded.sub_category_id, bank_statement_id = excluded.bank_statement_id,
                invoice_id = excluded.invoice_id, destination_account_id = excluded.destination_account_id,
                partner_id = excluded.partner_id, goal_id = excluded.goal_id, recurrence_id = excluded.recurrence_id,
                occurrence = excluded.occurrence, name = excluded.name, description = excluded.description, value = excluded.value,
                currency = excluded.currency, conversion_rate = excluded.conversion_rate, due_date = excluded.due_date,
                paid = excluded.paid, payment_date = excluded.payment_date, charges = excluded.charges, type = excluded.type,
                created_at = strftime('%Y-%m-%d %H:%M:%S', 'now'), updated_at = excluded.updated_at, deleted_at = NULL
            WHERE transactions.deleted_at IS NOT NULL`,
            { ...this.contentParams(transaction), recurrenceId: transaction.recurrenceId, occurrence: transaction.occurrence },
        );
        if (changes === 0) {
            throw new Error(`a transação ${transaction.id} já existe e está viva`);
        }
        this.syncTags(transaction);
    }

    /**
     * Regrava todos os campos editáveis; `recurrence_id` fica de fora porque o vínculo com a
     * regra nunca muda depois de emitido.
     *
     * @param transaction Transação editada.
     * @return void
     */
    public update(transaction: Transaction): void {
        this.database.run(
            `UPDATE transactions SET sub_category_id = :subCategoryId, bank_statement_id = :statementId,
                invoice_id = :invoiceId, destination_account_id = :destinationAccountId, partner_id = :partnerId,
                goal_id = :goalId, name = :name, description = :description, value = :value, currency = :currency,
                conversion_rate = :conversionRate, due_date = :dueDate, paid = :paid, payment_date = :paymentDate,
                charges = :charges, type = :type, updated_at = :now
            WHERE id = :id AND deleted_at IS NULL`,
            this.contentParams(transaction),
        );
        this.syncTags(transaction);
    }

    /**
     * Deixa vivos exatamente os vínculos das tags da transação. Só toca nos vínculos que
     * mudaram — tirar a tag que saiu e pôr a que entrou —, para que uma edição que não mexe
     * nas tags não carimbe `updated_at` em vínculos intactos e a sincronização não os trate
     * como alterados. A tag que volta reaproveita a linha excluída do mesmo par, cujo id é
     * derivado dele (`transactionTagIdFor`).
     *
     * @param transaction Transação gravada, com o conjunto de tags desejado.
     * @return void
     */
    private syncTags(transaction: Transaction): void {
        const now = this.clock.now();
        const linked = new Set(
            this.database
                .all('SELECT tag_id FROM transactions_tags WHERE transaction_id = :id AND deleted_at IS NULL', { id: transaction.id })
                .map((row) => TagId(new RowReader('transactions_tags', row).text('tag_id'))),
        );
        const wanted = new Set(transaction.tagIds);
        for (const tagId of linked) {
            if (!wanted.has(tagId)) {
                this.database.run(
                    'UPDATE transactions_tags SET deleted_at = :now, updated_at = :now WHERE transaction_id = :id AND tag_id = :tagId AND deleted_at IS NULL',
                    { id: transaction.id, tagId, now },
                );
            }
        }
        for (const tagId of wanted) {
            if (!linked.has(tagId)) {
                this.database.run(
                    `INSERT INTO transactions_tags (id, transaction_id, tag_id, updated_at)
                    VALUES (:linkId, :id, :tagId, :now)
                    ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, updated_at = excluded.updated_at`,
                    { linkId: transactionTagIdFor(transaction.id, tagId), id: transaction.id, tagId, now },
                );
            }
        }
    }

    /**
     * @param id Transação a excluir.
     * @return void
     */
    public softDelete(id: TransactionId): void {
        const params = { id, now: this.clock.now() };
        this.database.run('UPDATE transactions SET deleted_at = :now, updated_at = :now WHERE id = :id AND deleted_at IS NULL', params);
        this.database.run('UPDATE transactions_tags SET deleted_at = :now, updated_at = :now WHERE transaction_id = :id AND deleted_at IS NULL', params);
        this.database.run('UPDATE attachments SET deleted_at = :now, updated_at = :now WHERE transaction_id = :id AND deleted_at IS NULL', params);
    }

    /**
     * Consulta só a tabela de transações, sem os joins do contêiner: os carimbos são da linha,
     * e o conteúdo já vem por `listOccurrences`.
     *
     * @param recurrenceId Série consultada.
     * @return Os carimbos de criação e de última escrita de cada ocorrência viva, por id.
     * @throws {CorruptRowError} Quando um carimbo está fora do formato do schema.
     */
    public listOccurrenceStamps(recurrenceId: RecurrenceId): ReadonlyMap<TransactionId, RowStamps> {
        const rows = this.database.all(
            'SELECT id, created_at, updated_at FROM transactions WHERE recurrence_id = :recurrenceId AND deleted_at IS NULL',
            { recurrenceId },
        );
        return new Map(
            rows.map((row) => {
                const reader = new RowReader('transactions', row);
                return [TransactionId(reader.text('id')), { createdAt: stampOf(reader, 'created_at'), updatedAt: stampOf(reader, 'updated_at') }] as const;
            }),
        );
    }

    /**
     * @param recurrenceId Série consultada.
     * @return As ocorrências vivas da série, por data de vencimento e número.
     */
    public listOccurrences(recurrenceId: RecurrenceId): readonly Transaction[] {
        return this.list('WHERE t.recurrence_id = :recurrenceId AND t.deleted_at IS NULL ORDER BY t.due_date, t.occurrence', { recurrenceId });
    }

    /**
     * @param goalId Meta consultada.
     * @return As transações vivas vinculadas à meta, pelo índice `idx_transactions_goal_id`.
     */
    public listByGoal(goalId: GoalId): readonly Transaction[] {
        return this.list('WHERE t.goal_id = :goalId AND t.deleted_at IS NULL', { goalId });
    }

    /**
     * @param statementId Extrato de origem.
     * @return As transações vivas do extrato.
     */
    public listByStatement(statementId: BankStatementId): readonly Transaction[] {
        return this.list(`WHERE t.bank_statement_id = :statementId AND t.invoice_id IS NULL AND t.deleted_at IS NULL ${ORDER}`, { statementId });
    }

    /**
     * @param invoiceId Fatura de origem.
     * @return As transações vivas da fatura.
     */
    public listByInvoice(invoiceId: InvoiceId): readonly Transaction[] {
        return this.list(`WHERE t.invoice_id = :invoiceId AND t.bank_statement_id IS NULL AND t.deleted_at IS NULL ${ORDER}`, { invoiceId });
    }

    /**
     * @param accountId Conta de destino.
     * @param period Mês da data de caixa (`cashDateSql`), o mesmo critério do recálculo.
     * @return As transferências e investimentos vivos que chegam à conta no mês.
     */
    public listIncoming(accountId: AccountId, period: YearMonth): readonly Transaction[] {
        const { start, end } = monthBounds(period);
        return this.list(
            `WHERE t.destination_account_id = :accountId AND t.type IN (3, 4) AND t.deleted_at IS NULL
                AND ${cashDateSql('t')} BETWEEN :start AND :end ${ORDER}`,
            { accountId, start, end },
        );
    }

    /**
     * @param profileId Perfil dono.
     * @param from Primeira data incluída.
     * @param to Última data incluída.
     * @return As transações vivas do perfil no intervalo.
     */
    public listByProfileBetween(profileId: ProfileId, from: LocalDate, to: LocalDate): readonly Transaction[] {
        return this.list(
            `WHERE p.id = :profileId AND t.deleted_at IS NULL AND t.due_date BETWEEN :from AND :to ${ORDER}`,
            { profileId, from: from.toString(), to: to.toString() },
        );
    }

    /**
     * @param profileId Perfil dono.
     * @param period Mês de pagamento.
     * @param scope Categoria inteira ou uma subcategoria.
     * @return As despesas vivas do escopo que pesam no mês, pelo critério de
     * `REPORT_SOURCES_CTE`.
     */
    public listExpensesByPaymentPeriod(profileId: ProfileId, period: YearMonth, scope: CategoryScope): readonly Transaction[] {
        const filter = scope.kind === 'category'
            ? { sql: 'sc.category_id = :scopeId', scopeId: scope.categoryId }
            : { sql: 'sc.id = :scopeId', scopeId: scope.subCategoryId };
        return this.database
            .all(
                `WITH ${REPORT_SOURCES_CTE}
                ${SELECT_TRANSACTION}
                JOIN report_transactions rt ON rt.id = t.id
                JOIN transaction_sub_categories sc ON sc.id = t.sub_category_id
                WHERE rt.type = :expense AND rt.payment_key = :period AND ${filter.sql} ${ORDER}`,
                { profileId, expense: TRANSACTION_TYPE_CODE.expense, period: periodKey(period), scopeId: filter.scopeId },
            )
            .map((row) => this.toTransaction(row));
    }

    /**
     * @param clause `WHERE` e `ORDER BY` aplicados sobre `SELECT_TRANSACTION`.
     * @param params Parâmetros nomeados.
     * @return As transações de domínio.
     */
    private list(clause: string, params: SqlParams): readonly Transaction[] {
        return this.database.all(`${SELECT_TRANSACTION} ${clause}`, params).map((row) => this.toTransaction(row));
    }

    /**
     * Parâmetros dos campos editáveis, comuns ao insert e ao update. Dinheiro é arredondado
     * aqui, na fronteira de persistência (database-design §3.7).
     *
     * @param transaction Transação de origem.
     * @return Os parâmetros nomeados.
     */
    private contentParams(transaction: Transaction): SqlParams {
        return {
            id: transaction.id,
            subCategoryId: transaction.subCategoryId,
            statementId: transaction.container.kind === 'statement' ? transaction.container.statementId : null,
            invoiceId: transaction.container.kind === 'invoice' ? transaction.container.invoiceId : null,
            destinationAccountId: transaction.destinationAccountId,
            partnerId: transaction.partnerId,
            goalId: transaction.goalId,
            name: transaction.name,
            description: transaction.description,
            value: transaction.value.rounded().amount,
            currency: transaction.origin.currency.code,
            conversionRate: transaction.origin.conversionRate,
            dueDate: transaction.dueDate.toString(),
            paid: transaction.isPaid() ? 1 : 0,
            paymentDate: transaction.paymentDate?.toString() ?? null,
            charges: transaction.charges.rounded().amount,
            type: TRANSACTION_TYPE_CODE[transaction.type],
            now: this.clock.now(),
        };
    }

    /**
     * @param row Linha do `SELECT_TRANSACTION`.
     * @return A transação de domínio.
     * @throws {CorruptRowError} Quando `paid` e `payment_date` discordam ou o arco exclusivo
     * está quebrado — estados que a aplicação nunca grava.
     */
    private toTransaction(row: SqlRow): Transaction {
        const reader = new RowReader('transactions', row);
        const currency = Currency.of(reader.text('profile_currency'));
        const paid = reader.boolean('paid');
        const paymentDate = reader.nullableText('payment_date');
        if (paid !== (paymentDate !== null)) {
            throw new CorruptRowError('transactions', `paid e payment_date discordam na transação ${reader.text('id')}`);
        }
        /**
         * Lê uma referência anulável já como id marcado, para que cada FK opcional passe pela
         * mesma validação de UUID das obrigatórias.
         *
         * @param column Coluna da chave estrangeira.
         * @param parse Conversor do id marcado da entidade referenciada.
         * @return O id, ou `null` quando a referência está vazia.
         */
        const nullableId = <T>(column: string, parse: (raw: string) => T): T | null => {
            const value = reader.nullableText(column);
            return value === null ? null : parse(value);
        };
        return Transaction.restore({
            id: TransactionId(reader.text('id')),
            profileId: ProfileId(reader.text('profile_id')),
            recurrenceId: nullableId('recurrence_id', RecurrenceId),
            occurrence: reader.nullableNumber('occurrence'),
            type: decodeEnum(TRANSACTION_TYPE_CODE, reader.number('type'), 'transactions'),
            container: this.toContainer(reader),
            subCategoryId: SubCategoryId(reader.text('sub_category_id')),
            destinationAccountId: nullableId('destination_account_id', AccountId),
            partnerId: nullableId('partner_id', PartnerId),
            goalId: nullableId('goal_id', GoalId),
            name: reader.text('name'),
            description: reader.nullableText('description'),
            value: Money.of(reader.number('value'), currency),
            charges: Money.of(reader.number('charges'), currency),
            origin: { currency: Currency.of(reader.text('currency')), conversionRate: reader.number('conversion_rate') },
            dueDate: LocalDate.parse(reader.text('due_date')),
            paymentDate: paymentDate === null ? null : LocalDate.parse(paymentDate),
            tagIds: (reader.nullableText('tag_ids') ?? '').split(',').filter((id) => id !== '').map((id) => TagId(id)),
        });
    }

    /**
     * @param reader Leitor da linha da transação.
     * @return O contêiner da transação.
     * @throws {CorruptRowError} Quando a linha não está em exatamente um contêiner vivo —
     * a "ausência silenciosa" que a verificação de integridade procura (database-design §4.13).
     */
    private toContainer(reader: RowReader): TransactionContainer {
        const statementId = reader.nullableText('bank_statement_id');
        const invoiceId = reader.nullableText('invoice_id');
        if (statementId !== null && invoiceId === null) {
            return {
                kind: 'statement',
                statementId: BankStatementId(statementId),
                accountId: AccountId(reader.text('statement_account_id')),
                period: YearMonth.of(reader.number('statement_year'), reader.number('statement_month')),
            };
        }
        if (invoiceId !== null && statementId === null) {
            return {
                kind: 'invoice',
                invoiceId: InvoiceId(invoiceId),
                creditCardId: CreditCardId(reader.text('invoice_card_id')),
                period: YearMonth.of(reader.number('invoice_year'), reader.number('invoice_month')),
            };
        }
        throw new CorruptRowError('transactions', `transação ${reader.text('id')} fora de exatamente um contêiner`);
    }
}

/**
 * Lê um carimbo da linha. Um carimbo fora do formato só existe se alguém escreveu na tabela
 * por fora do app — o `CHECK` do schema recusaria —, então vira `CorruptRowError`, como as
 * outras colunas ilegíveis, e não um erro de valor do usuário.
 *
 * @param reader Leitor da linha.
 * @param column `created_at` ou `updated_at`.
 * @return O carimbo marcado.
 * @throws {CorruptRowError} Quando o texto não está no formato `YYYY-MM-DD HH:MM:SS`.
 */
function stampOf(reader: RowReader, column: 'created_at' | 'updated_at'): Timestamp {
    const raw = reader.text(column);
    try {
        return parseTimestamp(raw);
    } catch {
        throw new CorruptRowError('transactions', `${column} fora do formato: "${raw}"`);
    }
}
