import type { AccountId, CreditCardId, ProfileId } from '../../domain/shared/ids.ts';

/**
 * Dados do cadastro do cartão como o Service recebe: limite em `number`, porque só o
 * Service conhece a moeda do perfil, e dias ainda soltos, porque o `BillingCycle` é o único
 * validador de 1–31.
 */
export interface CreditCardInput {
    readonly accountId: AccountId;
    readonly name: string;
    readonly limit: number;
    readonly closingDay: number;
    readonly dueDay: number;
}

/** Cartão novo num perfil. */
export interface CreateCreditCardCommand extends CreditCardInput {
    readonly profileId: ProfileId;
}

/** Edição completa do cadastro de um cartão. */
export interface UpdateCreditCardCommand extends CreditCardInput {
    readonly id: CreditCardId;
}
