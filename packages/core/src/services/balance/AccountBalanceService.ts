import type { Account } from '../../domain/account/Account.ts';
import { BalancePair } from '../../domain/balance/BalancePair.ts';
import { NotFoundError } from '../../domain/shared/errors.ts';
import type { AccountId, ProfileId } from '../../domain/shared/ids.ts';
import type { AccountRepository } from '../../repositories/AccountRepository.ts';
import type { ProfileRepository } from '../../repositories/ProfileRepository.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import type { BalanceRecalculationService } from './BalanceRecalculationService.ts';
import type { ProfileBalances } from './ProfileBalances.ts';

/**
 * Cálculo de saldo do perfil: contas com consolidado e previsto do mês corrente, e o total.
 * Lê o cache das contas — que existe justamente para a tela inicial abrir sem consultar
 * extratos (database-design §4.4) —, mas o confere contra o mês corrente antes, porque na
 * virada do mês o cache ainda aponta o fechamento do mês anterior.
 */
export class AccountBalanceService {
    /**
     * @param unitOfWork Leitura e eventual atualização do cache numa transação só.
     * @param profiles Perfil consultado.
     * @param accounts Contas do perfil.
     * @param recalculation Atualiza o cache e reconstrói a cadeia no reparo.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly profiles: ProfileRepository,
        private readonly accounts: AccountRepository,
        private readonly recalculation: BalanceRecalculationService,
    ) {}

    /**
     * Regra de negócio (Saldos): o total do perfil soma só as contas com
     * `consider_balance` ligado (database-design §4.4). Transferências entre contas do perfil
     * somam zero no total por construção — saem de uma e entram na outra —, então nunca
     * contam como receita ou despesa do perfil (§4.13); só os encargos da origem pesam.
     *
     * @param profileId Perfil consultado.
     * @return As contas com os saldos do mês corrente e o total consolidado e previsto.
     * @throws {NotFoundError} Quando o perfil não existe.
     */
    public profileBalances(profileId: ProfileId): ProfileBalances {
        return this.unitOfWork.run(() => {
            const profile = this.profiles.findById(profileId);
            if (profile === null) {
                throw new NotFoundError('Profile', profileId);
            }
            const accounts = this.accounts.listByProfile(profileId).map((account) => this.recalculation.refreshCurrentBalance(account));
            const total = accounts
                .filter((account) => account.considerBalance)
                .reduce((sum, account) => sum.add(account.balances), BalancePair.zero(profile.currency))
                .rounded();
            return { profile, accounts, total };
        });
    }

    /**
     * Reconstrói do zero todos os saldos de uma conta. É a ferramenta de reparo: um saldo
     * em cache que diverge do recalculado é bug a expor, não a corrigir em silêncio
     * (database-design §3.7) — por isso é uma ação explícita, e não algo que a leitura faz.
     *
     * @param accountId Conta a reconstruir.
     * @return A conta com os saldos reconstruídos.
     * @throws {NotFoundError} Quando a conta não existe.
     */
    public rebuildAccount(accountId: AccountId): Account {
        return this.unitOfWork.run(() => {
            if (this.accounts.findById(accountId) === null) {
                throw new NotFoundError('Account', accountId);
            }
            this.recalculation.recalculateAccountFully(accountId);
            const rebuilt = this.accounts.findById(accountId);
            if (rebuilt === null) {
                throw new NotFoundError('Account', accountId);
            }
            return rebuilt;
        });
    }
}
