import type { ProfileBalances } from '../../services/balance/ProfileBalances.ts';
import { toAccountBalanceResponse, type AccountBalanceResponse } from '../accounts/AccountBalanceResponse.ts';
import { toBalancePairResponse, type BalancePairResponse } from '../shared/BalancePairResponse.ts';

/** Saldos de todas as contas do perfil e o total, para a tela inicial. */
export interface ProfileBalancesResponse {
    readonly profileId: string;
    readonly accounts: readonly AccountBalanceResponse[];
    readonly total: BalancePairResponse;
}

/**
 * O total vem pronto do Service porque só ele sabe quais contas entram na soma
 * (`considerBalance`); a UI não deve refazer esse filtro.
 *
 * @param balances Saldos do perfil montados pelo Service; fonte das contas e do total.
 * @return Os saldos serializáveis do perfil.
 */
export function toProfileBalancesResponse(balances: ProfileBalances): ProfileBalancesResponse {
    return {
        profileId: balances.profile.id,
        accounts: balances.accounts.map(toAccountBalanceResponse),
        total: toBalancePairResponse(balances.total),
    };
}
