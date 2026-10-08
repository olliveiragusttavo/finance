import type { AccountId, BankStatementId, CreditCardId, InvoiceId, RecurrenceId, TransactionId } from '../domain/shared/ids.ts';
import type { TransactionType } from '../domain/transaction/TransactionType.ts';

/**
 * Por que uma transação entra na exclusão em cadeia — é o que separa as contagens do alerta
 * (desktop-mvp-plan §5.1): lançamento do extrato da conta, lançamento de fatura de um
 * cartão excluído, ou transferência de outro contêiner que chega à conta excluída.
 */
export type DoomedTransactionRole = 'statement' | 'creditCard' | 'incoming';

/** Uma transação que a exclusão em cadeia vai apagar. */
export interface DoomedTransaction {
    readonly id: TransactionId;
    readonly type: TransactionType;
    readonly role: DoomedTransactionRole;
}

/**
 * Tudo o que uma exclusão em cadeia apaga, e as contas cujo saldo ela mexe.
 * Regra de negócio (Contas e Cartões): o alerta mostra **tudo o que será apagado junto**, e
 * só isso é apagado (desktop-mvp-plan §5.1). Por isso o escopo é calculado uma vez, pela
 * mesma consulta, e serve tanto à contagem do alerta quanto à exclusão — duas consultas
 * poderiam discordar e apagar mais (ou menos) do que o usuário confirmou.
 */
export interface DeletionScope {
    readonly accounts: readonly AccountId[];
    readonly creditCards: readonly CreditCardId[];
    readonly statements: readonly BankStatementId[];
    readonly invoices: readonly InvoiceId[];
    readonly transactions: readonly DoomedTransaction[];
    /**
     * Recorrências que emitem a partir de uma conta ou de um cartão excluído, ou para uma conta
     * excluída: a regra não emite para quem não existe mais (database-design §4.12).
     */
    readonly recurrences: readonly RecurrenceId[];
    /**
     * Faturas que sobrevivem, mas estavam pagas num extrato que vai ser excluído (o cartão
     * trocou de conta pagadora depois do pagamento). Voltam a ficar em aberto, como quando o
     * extrato some (database-design §4.7).
     */
    readonly reopenedInvoices: readonly InvoiceId[];
    /**
     * Todas as contas cujo saldo algo do escopo move: origem e destino das transações e
     * conta pagadora das faturas. Inclui as próprias contas excluídas; quem usa filtra.
     */
    readonly touchedAccounts: readonly AccountId[];
}

/**
 * Calcula e aplica o escopo das exclusões em cadeia de conta e de cartão. Separado dos
 * Repositories de entidade porque atravessa o grafo de propriedade inteiro — conta →
 * extratos → transações, conta → cartões → faturas → transações — numa leitura só.
 */
export interface DeletionRepository {
    /**
     * Regra de negócio (Contas): excluir a conta apaga seus extratos e transações, os
     * cartões que ela paga com faturas e lançamentos, e as transferências e investimentos em
     * que ela é a conta de destino (desktop-mvp-plan §5.1).
     *
     * @param accountId Conta a excluir.
     * @return O escopo da exclusão.
     */
    accountScope(accountId: AccountId): DeletionScope;

    /**
     * Regra de negócio (Cartões): excluir o cartão apaga suas faturas e os lançamentos
     * delas, incluindo os pagamentos parciais (desktop-mvp-plan §5.1).
     *
     * @param creditCardId Cartão a excluir.
     * @return O escopo da exclusão.
     */
    creditCardScope(creditCardId: CreditCardId): DeletionScope;

    /**
     * Soft delete das faturas, extratos, cartões e contas do escopo. As transações ficam de
     * fora porque o soft delete delas, com tags e anexos, já é do `TransactionRepository`.
     *
     * @param scope Escopo calculado na mesma unidade de trabalho.
     * @return void
     */
    softDeleteContainers(scope: DeletionScope): void;
}
