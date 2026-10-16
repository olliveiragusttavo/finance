import type { Account, AccountType } from '../../domain/account/Account.ts';
import { toMoneyResponse, type MoneyResponse } from '../shared/MoneyResponse.ts';

/** Cadastro serializável da conta — o que o formulário de edição carrega. */
export interface AccountResponse {
    readonly id: string;
    readonly profileId: string;
    readonly name: string;
    readonly type: AccountType;
    /** Moeda da conta no mundo real; só rótulo (database-design §4.4). */
    readonly currency: string;
    readonly considerBalance: boolean;
    /** Desativada some das escolhas de lançamentos novos (desktop-mvp-plan §5.1). */
    readonly disabled: boolean;
    readonly openingBalance: MoneyResponse;
}

/**
 * Separado do `AccountBalanceResponse` porque o cadastro e a lista de saldos mudam por
 * motivos diferentes: o formulário precisa do saldo inicial e do rótulo de moeda, a lista
 * de saldos não.
 *
 * @param account Conta do domínio; fonte dos dados do cadastro.
 * @return O cadastro serializável.
 */
export function toAccountResponse(account: Account): AccountResponse {
    return {
        id: account.id,
        profileId: account.profileId,
        name: account.name,
        type: account.type,
        currency: account.currencyLabel,
        considerBalance: account.considerBalance,
        disabled: account.disabled,
        openingBalance: toMoneyResponse(account.openingBalance),
    };
}
