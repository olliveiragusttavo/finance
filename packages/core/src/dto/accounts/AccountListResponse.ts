import type { AccountListView } from '../../services/account/AccountViews.ts';
import { toBalancePairResponse, type BalancePairResponse } from '../shared/BalancePairResponse.ts';
import { toAccountResponse, type AccountResponse } from './AccountResponse.ts';

/** Uma conta na lista do mês: o cadastro e o fechamento do mês pedido. */
export interface AccountInPeriodResponse extends AccountResponse {
    readonly balances: BalancePairResponse;
}

/** A lista de contas de um mês, com o total do perfil (tela de Contas). */
export interface AccountListResponse {
    readonly profileId: string;
    readonly period: string;
    readonly accounts: readonly AccountInPeriodResponse[];
    /** Soma só das contas com "considerar no saldo"; a UI não refaz o filtro. */
    readonly total: BalancePairResponse;
}

/**
 * @param view Lista montada pelo Service; fonte das contas, dos saldos do mês e do total.
 * @return A lista serializável.
 */
export function toAccountListResponse(view: AccountListView): AccountListResponse {
    return {
        profileId: view.profile.id,
        period: view.period.toString(),
        accounts: view.accounts.map(({ account, balances }) => ({ ...toAccountResponse(account), balances: toBalancePairResponse(balances) })),
        total: toBalancePairResponse(view.total),
    };
}
