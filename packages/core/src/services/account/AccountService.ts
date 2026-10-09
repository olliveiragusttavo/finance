import { Account, type AccountContent } from '../../domain/account/Account.ts';
import { BalancePair } from '../../domain/balance/BalancePair.ts';
import { currentAccountBalances } from '../../domain/balance/StatementChain.ts';
import type { Profile } from '../../domain/profile/Profile.ts';
import { NotFoundError } from '../../domain/shared/errors.ts';
import { AccountId, type ProfileId } from '../../domain/shared/ids.ts';
import { Money } from '../../domain/shared/Money.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';
import type { IdGenerator } from '../../ports/IdGenerator.ts';
import type { AccountRepository } from '../../repositories/AccountRepository.ts';
import type { BankStatementRepository } from '../../repositories/BankStatementRepository.ts';
import { BalanceImpact } from '../balance/BalanceImpact.ts';
import { BEGINNING_OF_TIME, type BalanceRecalculationService } from '../balance/BalanceRecalculationService.ts';
import type { ProfileService } from '../profile/ProfileService.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import type { AccountInput, CreateAccountCommand, UpdateAccountCommand } from './AccountCommands.ts';
import type { AccountListView, TransferTarget } from './AccountViews.ts';

/**
 * Cadastro de contas: listar com saldos do mês, criar, editar, desativar e reativar. A
 * exclusão em cadeia fica no `CascadeDeletionService`, que também exclui cartões.
 */
export class AccountService {
    /**
     * @param unitOfWork Escrita e recálculo na mesma transação de banco.
     * @param ids Gera o UUID v4 da conta nova.
     * @param profiles Perfil dono: existência e moeda.
     * @param accounts Contas.
     * @param statements Fechamento do mês pedido na lista.
     * @param recalculation A rotina única de recálculo, para o saldo inicial editado.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly ids: IdGenerator,
        private readonly profiles: ProfileService,
        private readonly accounts: AccountRepository,
        private readonly statements: BankStatementRepository,
        private readonly recalculation: BalanceRecalculationService,
    ) {}

    /**
     * Lista as contas com o saldo de um mês.
     * Regra de negócio (Contas): o saldo de um mês é o fechamento do extrato dele; um mês
     * sem extrato herda o fechamento do último anterior, e uma conta sem extrato até ali
     * mostra o saldo inicial (database-design §4.6) — a mesma regra do saldo exibido, só
     * que no mês pedido em vez do corrente. O total soma só as contas com "considerar no
     * saldo" (§4.4); desativada continua somando, porque o dinheiro dela existe
     * (desktop-mvp-plan §5.1).
     *
     * @param profileId Perfil consultado.
     * @param period Mês de referência da tela.
     * @return As contas, ativas e desativadas, com o fechamento do mês e o total.
     * @throws {NotFoundError} Quando o perfil não existe.
     */
    public list(profileId: ProfileId, period: YearMonth): AccountListView {
        return this.unitOfWork.run(() => {
            const profile = this.profiles.require(profileId);
            const accounts = this.accounts.listByProfile(profileId).map((account) => ({
                account,
                balances: currentAccountBalances(
                    BalancePair.same(account.openingBalance.rounded()),
                    this.statements.findLatestBefore(account.id, period.next()),
                ),
            }));
            const total = accounts
                .filter(({ account }) => account.considerBalance)
                .reduce((sum, { balances }) => sum.add(balances), BalancePair.zero(profile.currency))
                .rounded();
            return { profile, period, accounts, total };
        });
    }

    /**
     * Contas de outros perfis oferecidas como destino de uma transferência.
     * Regra de negócio (Transferência entre perfis): só perfis com a mesma moeda, pelo mesmo
     * motivo que o `TransactionComposer` recusa os outros — a transação grava um único valor.
     * Filtrar aqui, e não só na escrita, evita oferecer no formulário uma conta que o núcleo
     * recusaria ao salvar. As desativadas vêm junto, para que a edição de uma transferência
     * antiga ainda mostre o nome do destino; quem esconde as desativadas é a UI, como nas
     * contas do próprio perfil.
     *
     * @param profileId Perfil de onde a transferência sai.
     * @return As contas vivas dos outros perfis com a mesma moeda, por perfil e nome; vazio
     * quando não há outro perfil compatível.
     * @throws {NotFoundError} Quando o perfil não existe.
     */
    public transferTargets(profileId: ProfileId): readonly TransferTarget[] {
        return this.unitOfWork.run(() => {
            const origin = this.profiles.require(profileId);
            return this.profiles
                .list()
                .filter((profile) => profile.id !== origin.id && profile.currency.equals(origin.currency))
                .flatMap((profile) => this.accounts.listByProfile(profile.id).map((account) => ({ account, profile })));
        });
    }

    /**
     * @param command Perfil dono e dados do cadastro.
     * @return A conta gravada, relida do banco.
     * @throws {NotFoundError} Quando o perfil não existe.
     * @throws {InvalidValueError} Quando o nome ou o rótulo de moeda é inválido.
     */
    public create(command: CreateAccountCommand): Account {
        return this.unitOfWork.run(() => {
            const profile = this.profiles.require(command.profileId);
            const account = Account.create(AccountId(this.ids.random()), profile.id, this.toContent(profile, command));
            this.accounts.save(account);
            return this.require(account.id);
        });
    }

    /**
     * Edita o cadastro.
     * Regra de negócio (Contas): editar o `opening_balance` recalcula **todos** os extratos
     * da conta, já que todos dependem dele (database-design §4.4). Mudar "considerar no
     * saldo" não recalcula nada: o total do perfil é somado na leitura.
     *
     * @param command Novo cadastro completo, com o id da conta.
     * @return A conta editada, relida do banco com os saldos em dia.
     * @throws {NotFoundError} Quando a conta não existe.
     * @throws {InvalidValueError} Quando o nome ou o rótulo de moeda é inválido.
     */
    public update(command: UpdateAccountCommand): Account {
        return this.unitOfWork.run(() => {
            const current = this.require(command.id);
            const content = this.toContent(this.profiles.require(current.profileId), command);
            this.accounts.save(current.revise(content));
            if (current.openingBalanceDiffersFrom(content)) {
                this.recalculation.apply(BalanceImpact.none().withAccount(current.id, BEGINNING_OF_TIME));
            }
            return this.require(current.id);
        });
    }

    /**
     * Regra de negócio (Contas): desativar é a ação padrão no lugar de excluir — não apaga
     * nada nem muda saldo nenhum, e por isso não recalcula (desktop-mvp-plan §5.1).
     *
     * @param id Conta a desativar; já desativada continua desativada.
     * @return A conta desativada.
     * @throws {NotFoundError} Quando a conta não existe.
     */
    public disable(id: AccountId): Account {
        return this.unitOfWork.run(() => {
            this.accounts.save(this.require(id).disable());
            return this.require(id);
        });
    }

    /**
     * @param id Conta a reativar; já ativa continua ativa.
     * @return A conta ativa.
     * @throws {NotFoundError} Quando a conta não existe.
     */
    public enable(id: AccountId): Account {
        return this.unitOfWork.run(() => {
            this.accounts.save(this.require(id).enable());
            return this.require(id);
        });
    }

    /**
     * @param id Conta procurada.
     * @return A conta viva.
     * @throws {NotFoundError} Quando não existe.
     */
    public require(id: AccountId): Account {
        const account = this.accounts.findById(id);
        if (account === null) {
            throw new NotFoundError('Account', id);
        }
        return account;
    }

    /**
     * @param profile Perfil dono; dá a moeda do saldo inicial e o rótulo padrão.
     * @param input Dados validados pela camada Request.
     * @return O conteúdo de domínio do cadastro.
     */
    private toContent(profile: Profile, input: AccountInput): AccountContent {
        return {
            name: input.name,
            type: input.type,
            currencyLabel: input.currencyLabel ?? profile.currency.code,
            considerBalance: input.considerBalance,
            openingBalance: Money.of(input.openingBalance, profile.currency),
        };
    }
}
