import type { AccountType } from '../../domain/account/Account.ts';
import type { AccountId, ProfileId } from '../../domain/shared/ids.ts';

/**
 * Dados do cadastro da conta como o Service recebe: validados pela camada Request, mas com
 * dinheiro em `number`, porque só o Service conhece a moeda do perfil que o torna `Money`.
 */
export interface AccountInput {
    readonly name: string;
    readonly type: AccountType;
    /** Rótulo ISO 4217 da conta; `null` usa a moeda do perfil, o caso comum. */
    readonly currencyLabel: string | null;
    readonly considerBalance: boolean;
    readonly openingBalance: number;
}

/** Conta nova num perfil. */
export interface CreateAccountCommand extends AccountInput {
    readonly profileId: ProfileId;
}

/** Edição completa do cadastro de uma conta. */
export interface UpdateAccountCommand extends AccountInput {
    readonly id: AccountId;
}
