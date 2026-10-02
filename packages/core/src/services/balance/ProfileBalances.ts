import type { Account } from '../../domain/account/Account.ts';
import type { BalancePair } from '../../domain/balance/BalancePair.ts';
import type { Profile } from '../../domain/profile/Profile.ts';

/**
 * Saldos do perfil como a tela inicial mostra. Fica fora do arquivo do
 * `AccountBalanceService` para que a camada DTO dependa só do contrato de saída, e não da
 * implementação do caso de uso.
 */
export interface ProfileBalances {
    readonly profile: Profile;
    readonly accounts: readonly Account[];
    /** Soma só das contas com "considerar no saldo" ligado. */
    readonly total: BalancePair;
}
