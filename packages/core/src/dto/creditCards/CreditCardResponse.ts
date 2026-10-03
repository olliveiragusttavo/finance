import type { CreditCard } from '../../domain/creditCard/CreditCard.ts';
import { toMoneyResponse, type MoneyResponse } from '../shared/MoneyResponse.ts';

/** Cadastro serializável do cartão — o que o formulário de edição carrega. */
export interface CreditCardResponse {
    readonly id: string;
    readonly profileId: string;
    /** Conta que paga as faturas. */
    readonly accountId: string;
    readonly name: string;
    readonly limit: MoneyResponse;
    readonly closingDay: number;
    readonly dueDay: number;
    readonly disabled: boolean;
}

/**
 * @param creditCard Cartão do domínio; fonte dos dados do cadastro.
 * @return O cadastro serializável, com o ciclo como dias do mês.
 */
export function toCreditCardResponse(creditCard: CreditCard): CreditCardResponse {
    return {
        id: creditCard.id,
        profileId: creditCard.profileId,
        accountId: creditCard.accountId,
        name: creditCard.name,
        limit: toMoneyResponse(creditCard.limit),
        closingDay: creditCard.billingCycle.closingDay,
        dueDay: creditCard.billingCycle.dueDay,
        disabled: creditCard.disabled,
    };
}
