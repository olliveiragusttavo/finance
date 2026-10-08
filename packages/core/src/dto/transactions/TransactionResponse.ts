import type { Transaction } from '../../domain/transaction/Transaction.ts';
import type { TransactionType } from '../../domain/transaction/TransactionType.ts';
import { toMoneyResponse, type MoneyResponse } from '../shared/MoneyResponse.ts';

/**
 * Onde a transação está lançada. União discriminada porque uma transação pertence a um
 * extrato de conta ou a uma fatura de cartão, nunca aos dois, e a UI precisa saber qual
 * para navegar até o contêiner.
 */
export type TransactionContainerResponse =
    | { readonly kind: 'statement'; readonly statementId: string; readonly accountId: string; readonly period: string }
    | { readonly kind: 'invoice'; readonly invoiceId: string; readonly creditCardId: string; readonly period: string };

/** Transação serializável, devolvida pelas rotas de criação, edição, consulta e listagem. */
export interface TransactionResponse {
    readonly id: string;
    readonly profileId: string;
    readonly type: TransactionType;
    readonly container: TransactionContainerResponse;
    readonly subCategoryId: string;
    readonly destinationAccountId: string | null;
    readonly partnerId: string | null;
    readonly goalId: string | null;
    readonly recurrenceId: string | null;
    /** Número da ocorrência na série (a 1ª é 1); `null` num lançamento avulso. */
    readonly occurrence: number | null;
    readonly name: string;
    readonly description: string | null;
    readonly value: MoneyResponse;
    readonly charges: MoneyResponse;
    readonly originCurrency: string;
    readonly conversionRate: number;
    readonly dueDate: string;
    readonly paid: boolean;
    readonly paymentDate: string | null;
    /** Efeito no saldo da origem; a UI usa para mostrar entrada/saída sem reaplicar a regra. */
    readonly originEffect: MoneyResponse;
    /** Efeito no saldo da conta de destino; `null` quando não há destino. */
    readonly destinationEffect: MoneyResponse | null;
    /** Tags do lançamento, por nome. */
    readonly tagIds: readonly string[];
}

/**
 * Converte a transação do domínio no contrato de saída. Os efeitos vão calculados porque a
 * regra de sinal por tipo pertence ao domínio — a UI não deve reimplementá-la; o do destino é
 * o que o extrato da conta que recebe a transferência mostra.
 *
 * @param transaction Transação do domínio; fonte de todos os campos e do efeito na origem.
 * @return A transação serializável, com datas e períodos como string ISO.
 */
export function toTransactionResponse(transaction: Transaction): TransactionResponse {
    const container = transaction.container;
    return {
        id: transaction.id,
        profileId: transaction.profileId,
        type: transaction.type,
        container: container.kind === 'statement'
            ? { kind: 'statement', statementId: container.statementId, accountId: container.accountId, period: container.period.toString() }
            : { kind: 'invoice', invoiceId: container.invoiceId, creditCardId: container.creditCardId, period: container.period.toString() },
        subCategoryId: transaction.subCategoryId,
        destinationAccountId: transaction.destinationAccountId,
        partnerId: transaction.partnerId,
        goalId: transaction.goalId,
        recurrenceId: transaction.recurrenceId,
        occurrence: transaction.occurrence,
        name: transaction.name,
        description: transaction.description,
        value: toMoneyResponse(transaction.value),
        charges: toMoneyResponse(transaction.charges),
        originCurrency: transaction.origin.currency.code,
        conversionRate: transaction.origin.conversionRate,
        dueDate: transaction.dueDate.toString(),
        paid: transaction.isPaid(),
        paymentDate: transaction.paymentDate?.toString() ?? null,
        originEffect: toMoneyResponse(transaction.originEffect()),
        destinationEffect: destinationEffectResponse(transaction),
        tagIds: transaction.tagIds,
    };
}

/**
 * @param transaction Transação do domínio.
 * @return O efeito no destino, ou `null` quando a transação não tem conta de destino.
 */
function destinationEffectResponse(transaction: Transaction): MoneyResponse | null {
    const effect = transaction.destinationEffect();
    return effect === null ? null : toMoneyResponse(effect);
}
