import type { Account } from '../../domain/account/Account.ts';
import { toBalancePairResponse, type BalancePairResponse } from '../shared/BalancePairResponse.ts';

/** Conta com os saldos atuais, como aparece na lista de saldos e no reparo de conta. */
export interface AccountBalanceResponse {
    readonly id: string;
    readonly name: string;
    readonly type: Account['type'];
    readonly considerBalance: boolean;
    readonly balances: BalancePairResponse;
}

/**
 * Mapper único da conta com saldos: antes o reparo de conta montava o objeto à mão no
 * Controller, e os dois formatos podiam divergir sem o compilador perceber campos novos.
 *
 * @param account Conta do domínio com os saldos já calculados; fonte dos dados exibidos.
 * @return A conta serializável com o par consolidado/previsto.
 */
export function toAccountBalanceResponse(account: Account): AccountBalanceResponse {
    return {
        id: account.id,
        name: account.name,
        type: account.type,
        considerBalance: account.considerBalance,
        balances: toBalancePairResponse(account.balances),
    };
}
