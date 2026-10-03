import type { DeletionImpact } from '../../services/deletion/DeletionImpact.ts';

/** Uma conta que sobrevive à exclusão e cujo saldo vai mudar. */
export interface AffectedAccountResponse {
    readonly id: string;
    readonly name: string;
}

/**
 * O alerta antes de excluir uma conta: tudo o que será apagado junto, contado, e as outras
 * contas cujo saldo muda (desktop-mvp-plan §5.1).
 */
export interface AccountDeletionImpactResponse {
    readonly accountId: string;
    readonly statements: number;
    /** Lançamentos dos extratos da conta. */
    readonly transactions: number;
    readonly creditCards: number;
    readonly invoices: number;
    /** Lançamentos das faturas dos cartões que a conta paga. */
    readonly cardTransactions: number;
    /** Transferências e investimentos de outras contas que chegam a esta. */
    readonly incomingTransfers: number;
    readonly affectedAccounts: readonly AffectedAccountResponse[];
}

/** O alerta antes de excluir um cartão (desktop-mvp-plan §5.1). */
export interface CreditCardDeletionImpactResponse {
    readonly creditCardId: string;
    readonly invoices: number;
    /** Todos os lançamentos das faturas, pagamentos parciais incluídos. */
    readonly transactions: number;
    /** Pagamentos parciais entre os lançamentos — devolvem dinheiro à conta que pagou. */
    readonly partialPayments: number;
    readonly affectedAccounts: readonly AffectedAccountResponse[];
}

/**
 * As contagens saem do mesmo escopo que a exclusão apaga; nenhuma é consultada à parte,
 * para que o alerta nunca mostre outra coisa que não o que vai ser apagado.
 *
 * @param impact Escopo e contas afetadas, montados pelo Service.
 * @return O alerta de exclusão de conta.
 */
export function toAccountDeletionImpactResponse(impact: DeletionImpact): AccountDeletionImpactResponse {
    const { scope } = impact;
    return {
        accountId: scope.accounts[0] ?? '',
        statements: scope.statements.length,
        transactions: scope.transactions.filter((transaction) => transaction.role === 'statement').length,
        creditCards: scope.creditCards.length,
        invoices: scope.invoices.length,
        cardTransactions: scope.transactions.filter((transaction) => transaction.role === 'creditCard').length,
        incomingTransfers: scope.transactions.filter((transaction) => transaction.role === 'incoming').length,
        affectedAccounts: impact.affectedAccounts.map((account) => ({ id: account.id, name: account.name })),
    };
}

/**
 * Regra de negócio (Fatura): pagamento parcial é uma transferência dentro da fatura
 * (database-design §4.7) — por isso é contado pelo tipo.
 *
 * @param impact Escopo e contas afetadas, montados pelo Service.
 * @return O alerta de exclusão de cartão.
 */
export function toCreditCardDeletionImpactResponse(impact: DeletionImpact): CreditCardDeletionImpactResponse {
    const { scope } = impact;
    return {
        creditCardId: scope.creditCards[0] ?? '',
        invoices: scope.invoices.length,
        transactions: scope.transactions.length,
        partialPayments: scope.transactions.filter((transaction) => transaction.type === 'transference').length,
        affectedAccounts: impact.affectedAccounts.map((account) => ({ id: account.id, name: account.name })),
    };
}
