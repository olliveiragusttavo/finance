import type { CategoryScope } from '../domain/report/CategoryScope.ts';
import type { AccountId, BankStatementId, InvoiceId, ProfileId, RecurrenceId, TransactionId } from '../domain/shared/ids.ts';
import type { LocalDate } from '../domain/shared/LocalDate.ts';
import type { YearMonth } from '../domain/shared/YearMonth.ts';
import type { Transaction } from '../domain/transaction/Transaction.ts';

/** Acesso às transações. Toda leitura considera só transações vivas. */
export interface TransactionRepository {
    /**
     * @param id Transação procurada.
     * @return A transação viva, ou `null`.
     */
    findById(id: TransactionId): Transaction | null;

    /**
     * @param transaction Transação nova, com id gerado pela aplicação.
     * @return void
     */
    insert(transaction: Transaction): void;

    /**
     * @param transaction Transação editada; substitui todos os campos editáveis da linha.
     * @return void
     */
    update(transaction: Transaction): void;

    /**
     * Soft delete da transação e dos filhos que ela possui (tags e anexos). Nada é removido
     * fisicamente, e o cascade do banco não dispara num `UPDATE`, então a propagação é
     * explícita (database-design §3.6).
     *
     * @param id Transação a excluir.
     * @return void
     */
    softDelete(id: TransactionId): void;

    /**
     * @param recurrenceId Recorrência da série.
     * @param dueDate Data de vencimento procurada.
     * @param excluding Transação a desconsiderar — a própria ocorrência sendo editada.
     * @return `true` quando outra ocorrência viva da série já vence nessa data.
     */
    hasOccurrenceOn(recurrenceId: RecurrenceId, dueDate: LocalDate, excluding: TransactionId): boolean;

    /**
     * @param statementId Extrato de origem.
     * @return As transações vivas do extrato, por data.
     */
    listByStatement(statementId: BankStatementId): readonly Transaction[];

    /**
     * @param invoiceId Fatura de origem.
     * @return As transações vivas da fatura, por data.
     */
    listByInvoice(invoiceId: InvoiceId): readonly Transaction[];

    /**
     * @param accountId Conta de destino.
     * @param period Mês da data de caixa — pagamento, ou vencimento em aberto.
     * @return As transferências e investimentos vivos que chegam à conta naquele mês.
     */
    listIncoming(accountId: AccountId, period: YearMonth): readonly Transaction[];

    /**
     * @param profileId Perfil dono.
     * @param from Primeira data incluída.
     * @param to Última data incluída.
     * @return As transações vivas do perfil com `due_date` no intervalo, por data.
     */
    listByProfileBetween(profileId: ProfileId, from: LocalDate, to: LocalDate): readonly Transaction[];

    /**
     * Lista do drill-down do relatório por categoria. Não reaproveita o
     * `listByProfileBetween`, que filtra por `due_date`: a lista precisa somar exatamente o
     * valor da linha do relatório, então usa o mesmo mês de pagamento (reports-design §2).
     *
     * @param profileId Perfil dono.
     * @param period Mês de pagamento.
     * @param scope Categoria inteira ou uma subcategoria.
     * @return As despesas vivas do escopo que pesam no mês, por data.
     */
    listExpensesByPaymentPeriod(profileId: ProfileId, period: YearMonth, scope: CategoryScope): readonly Transaction[];
}
