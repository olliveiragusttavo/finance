import { Goal, type GoalFunding } from '../../domain/goal/Goal.ts';
import { measureGoalProgress, type GoalLink, type GoalProgress } from '../../domain/goal/GoalProgress.ts';
import type { Profile } from '../../domain/profile/Profile.ts';
import { BusinessRuleViolation, NotFoundError } from '../../domain/shared/errors.ts';
import { GoalId, type AccountId, type ProfileId } from '../../domain/shared/ids.ts';
import { LocalDate } from '../../domain/shared/LocalDate.ts';
import { Money } from '../../domain/shared/Money.ts';
import { YearMonth } from '../../domain/shared/YearMonth.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { IdGenerator } from '../../ports/IdGenerator.ts';
import type { AccountRepository } from '../../repositories/AccountRepository.ts';
import type { BankStatementRepository } from '../../repositories/BankStatementRepository.ts';
import type { GoalRepository } from '../../repositories/GoalRepository.ts';
import type { TransactionRepository } from '../../repositories/TransactionRepository.ts';
import type { ProfileService } from '../profile/ProfileService.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import type { CreateGoalCommand, UpdateGoalCommand } from './GoalCommands.ts';
import type { GoalContributionView, GoalOptionView, GoalWithProgress } from './GoalViews.ts';

/**
 * Primeiro mês procurado no extrato de uma conta vinculada: anterior a qualquer extrato que o app
 * grava, para que `listFrom` traga a cadeia inteira.
 */
const FIRST_STATEMENT_PERIOD = YearMonth.of(1900, 1);

/**
 * Cadastro de metas e o progresso delas (database-design §4.11; mockup `DesktopMetas`). O
 * progresso nunca é gravado: cada leitura soma as transações vinculadas — ou, na meta vinculada a
 * conta, lê os extratos da conta —, que são a única fonte da verdade (§4.11). Meta não afeta
 * saldo, então nada aqui recalcula.
 */
export class GoalService {
    /**
     * @param unitOfWork Leitura, conferência e escrita numa transação só.
     * @param ids Gera o UUID v4 das metas novas.
     * @param clock Dá o "hoje" que decide o que já conta no progresso.
     * @param profiles Confere o perfil e dá a moeda do valor-alvo.
     * @param goals Metas e os vínculos com transações.
     * @param transactions Carrega de uma vez as transações da meta, para a tabela do detalhe.
     * @param accounts Conta vinculada: posse, tipo e saldo inicial.
     * @param statements Extratos da conta vinculada, de onde sai o progresso dela.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly ids: IdGenerator,
        private readonly clock: Clock,
        private readonly profiles: ProfileService,
        private readonly goals: GoalRepository,
        private readonly transactions: TransactionRepository,
        private readonly accounts: AccountRepository,
        private readonly statements: BankStatementRepository,
    ) {}

    /**
     * @param profileId Perfil consultado.
     * @param period Mês de referência, de cujo fim o ritmo conta (`measureGoalProgress`).
     * @return As metas do perfil por nome, cada uma com o progresso; vazio sem metas.
     * @throws {NotFoundError} Quando o perfil não existe.
     */
    public list(profileId: ProfileId, period: YearMonth): readonly GoalWithProgress[] {
        return this.unitOfWork.run(() => {
            this.profiles.require(profileId);
            const links = this.goals.linksByGoal(profileId);
            const today = this.clock.today();
            return this.goals.listByProfile(profileId).map((goal) => {
                if (goal.funding.kind === 'account') {
                    return { goal, progress: this.measureAccountGoal(goal, goal.funding.accountId, period, today), linkedCount: 0 };
                }
                const linked = links.get(goal.id) ?? [];
                return { goal, progress: measureGoalProgress({ goal, links: linked, period, today }), linkedCount: linked.length };
            });
        });
    }

    /**
     * Progresso da meta vinculada a uma conta de investimento.
     * Regra de negócio (Metas, desktop-mvp-plan Fase 13.3): o guardado é o **saldo consolidado
     * de hoje** da conta. Cada mês do extrato entra como a variação do consolidado, no último dia
     * do mês (ou hoje, no mês corrente), e o saldo inicial da conta como o que já estava guardado
     * — assim o ritmo, a média e a projeção seguem a mesma regra da meta por lançamentos, e um
     * mês passado mostra o saldo com que fechou. Meses depois do atual ficam fora: o consolidado
     * deles só teria pagamentos com data futura, que ainda não aconteceram.
     *
     * @param goal Meta vinculada.
     * @param accountId Conta da meta.
     * @param period Mês de referência.
     * @param today Hoje.
     * @return O progresso; sem a conta (excluída fora da cadeia), o de uma meta sem nada guardado.
     */
    private measureAccountGoal(goal: Goal, accountId: AccountId, period: YearMonth, today: LocalDate): GoalProgress {
        const account = this.accounts.findById(accountId);
        if (account === null) {
            return measureGoalProgress({ goal, links: [], period, today });
        }
        const chain = this.statements.listFrom(accountId, FIRST_STATEMENT_PERIOD).filter((statement) => !today.period.isBefore(statement.period));
        const links = chain.map((statement): GoalLink => {
            const end = LocalDate.of(statement.period.year, statement.period.month, statement.period.lengthInDays());
            return {
                key: statement.period.toString(),
                transactionId: null,
                value: statement.closing.consolidated.subtract(statement.opening.consolidated),
                paidOn: today.isBefore(end) ? today : end,
            };
        });
        const startingBalance = chain[0]?.opening.consolidated ?? account.openingBalance;
        return measureGoalProgress({ goal, links, period, today, startingBalance });
    }

    /**
     * Metas do perfil para o campo "Meta" do lançamento, com o que o formulário precisa para
     * agrupá-las: se já foram atingidas e se estão arquivadas (desktop-mvp-plan Fase 13.4). Mede só
     * o guardado de hoje, com os vínculos do perfil numa consulta — sem o ritmo do mês de
     * referência nem a conta das vinculadas da lista de Metas (revisão de 2026-10-08, item 5).
     * Regra de negócio (Metas, database-design §4.11): a meta vinculada a uma conta não recebe
     * lançamentos, então não é opção. A arquivada vem marcada, e não filtrada, porque a edição de
     * um lançamento já vinculado a ela precisa mostrá-la.
     *
     * @param profileId Perfil consultado.
     * @return As metas por lançamentos do perfil, por nome; vazio sem elas.
     * @throws {NotFoundError} Quando o perfil não existe.
     */
    public options(profileId: ProfileId): readonly GoalOptionView[] {
        return this.unitOfWork.run(() => {
            this.profiles.require(profileId);
            const links = this.goals.linksByGoal(profileId);
            const today = this.clock.today();
            return this.goals
                .listByProfile(profileId)
                .filter((goal) => goal.acceptsTransactions())
                .map((goal) => ({ goal, reached: measureGoalProgress({ goal, links: links.get(goal.id) ?? [], period: today.period, today }).reached }));
        });
    }

    /**
     * Transações que contam no progresso, para a tabela "Transações vinculadas" do mockup, cuja
     * soma é o progresso. As vinculadas ainda em aberto ficam fora pela mesma regra
     * (`measureGoalProgress`); a tela as cita pelo `pending` da lista. Lê só os vínculos desta
     * meta e as transações dela numa consulta, em vez dos vínculos do perfil inteiro e de um
     * `findById` por contribuição (revisão de 2026-10-08, item 7).
     *
     * @param id Meta consultada.
     * @return As transações que contam, da mais antiga para a mais recente pelo dia do pagamento;
     * vazio na meta vinculada a conta, que não tem lançamentos vinculados — o extrato é o da conta.
     * @throws {NotFoundError} Quando a meta não existe.
     */
    public contributions(id: GoalId): readonly GoalContributionView[] {
        return this.unitOfWork.run(() => {
            const goal = this.require(id);
            if (!goal.acceptsTransactions()) {
                return [];
            }
            const links = this.goals.linksOf(goal.id);
            // O mês de referência só mexe no ritmo; as contribuições dependem apenas de hoje.
            const today = this.clock.today();
            const { contributions } = measureGoalProgress({ goal, links, period: today.period, today });
            const transactions = new Map(this.transactions.listByGoal(goal.id).map((transaction) => [transaction.id, transaction]));
            return contributions.flatMap((contribution): GoalContributionView[] => {
                const transaction = contribution.transactionId === null ? undefined : transactions.get(contribution.transactionId);
                return transaction === undefined ? [] : [{ transaction, paidOn: contribution.paidOn }];
            });
        });
    }

    /**
     * @param command Perfil e conteúdo da meta.
     * @return A meta gravada.
     * @throws {NotFoundError} Quando o perfil ou a conta vinculada não existe.
     * @throws {InvalidValueError} Quando o nome ou o valor-alvo é inválido.
     * @throws {BusinessRuleViolation} Quando a conta vinculada é de outro perfil ou não é de investimento.
     */
    public create(command: CreateGoalCommand): Goal {
        return this.unitOfWork.run(() => {
            const profile = this.profiles.require(command.profileId);
            const goal = Goal.create({
                id: GoalId(this.ids.random()),
                profileId: profile.id,
                name: command.name,
                funding: this.checkedFunding(profile, command.funding),
                target: Money.of(command.value, profile.currency),
                targetDate: command.targetDate,
            });
            this.goals.save(goal);
            return this.require(goal.id);
        });
    }

    /**
     * Regra de negócio (Metas, desktop-mvp-plan Fase 13.3): trocar para a meta vinculada a uma
     * conta desfaz os vínculos dos lançamentos e das séries, que continuam existindo — a meta
     * deixa de receber lançamentos, e um vínculo guardado sem efeito confundiria quem o visse no
     * lançamento. O formulário avisa quantos perdem o vínculo antes de salvar.
     *
     * @param command Meta e novo conteúdo.
     * @return A meta editada; na meta por lançamentos, as transações vinculadas continuam vinculadas.
     * @throws {NotFoundError} Quando a meta ou a conta vinculada não existe.
     * @throws {InvalidValueError} Quando o nome ou o valor-alvo é inválido.
     * @throws {BusinessRuleViolation} Quando a conta vinculada é de outro perfil ou não é de investimento.
     */
    public update(command: UpdateGoalCommand): Goal {
        return this.unitOfWork.run(() => {
            const current = this.require(command.id);
            const profile = this.profiles.require(current.profileId);
            const funding = this.checkedFunding(profile, command.funding);
            const revised = current.revise({ name: command.name, funding, target: Money.of(command.value, current.target.currency), targetDate: command.targetDate });
            if (current.acceptsTransactions() && !revised.acceptsTransactions()) {
                this.goals.unlinkTransactions(current.id);
            }
            this.goals.save(revised);
            return this.require(revised.id);
        });
    }

    /**
     * Regra de negócio (Metas, desktop-mvp-plan Fase 13.3): a conta vinculada é do perfil da meta
     * e é de **investimento** — é onde o dinheiro fica guardado; a conta corrente movimenta o dia
     * a dia, e o saldo dela não diz quanto foi juntado. Uma conta pode servir a várias metas.
     *
     * @param profile Perfil da meta.
     * @param funding Tipo pedido.
     * @return O mesmo tipo, conferido.
     * @throws {NotFoundError} Quando a conta não existe.
     * @throws {BusinessRuleViolation} Quando a conta é de outro perfil ou não é de investimento.
     */
    private checkedFunding(profile: Profile, funding: GoalFunding): GoalFunding {
        if (funding.kind === 'transactions') {
            return funding;
        }
        const account = this.accounts.findById(funding.accountId);
        if (account === null) {
            throw new NotFoundError('accountId', funding.accountId);
        }
        if (account.profileId !== profile.id) {
            throw new BusinessRuleViolation('reference-outside-profile', 'accountId pertence a outro perfil', { field: 'accountId' });
        }
        if (account.type !== 'investment') {
            throw new BusinessRuleViolation('goal-account-not-investment', 'a meta só se vincula a uma conta de investimento', { field: 'accountId' });
        }
        return funding;
    }

    /**
     * Regra de negócio (Metas, desktop-mvp-plan Fase 13.4): arquivar não mexe nos vínculos nem no
     * progresso — só tira a meta da lista padrão e das escolhas de lançamentos novos.
     *
     * @param id Meta a arquivar; já arquivada continua arquivada.
     * @return A meta arquivada.
     * @throws {NotFoundError} Quando a meta não existe.
     */
    public archive(id: GoalId): Goal {
        return this.unitOfWork.run(() => {
            this.goals.save(this.require(id).archive());
            return this.require(id);
        });
    }

    /**
     * @param id Meta a reativar; já ativa continua ativa.
     * @return A meta ativa.
     * @throws {NotFoundError} Quando a meta não existe.
     */
    public unarchive(id: GoalId): Goal {
        return this.unitOfWork.run(() => {
            this.goals.save(this.require(id).unarchive());
            return this.require(id);
        });
    }

    /**
     * Regra de negócio (Metas): excluir a meta tira o vínculo das transações e das séries, que
     * continuam existindo — a meta é opcional no lançamento, como a tag, e o dinheiro guardado
     * não deixa de ter sido guardado (database-design §4.13, `goal_id` com `SET NULL`).
     *
     * @param id Meta a excluir.
     * @return void
     * @throws {NotFoundError} Quando a meta não existe.
     */
    public delete(id: GoalId): void {
        this.unitOfWork.run(() => {
            this.goals.softDelete(this.require(id).id);
        });
    }

    /**
     * @param id Meta procurada.
     * @return A meta viva.
     * @throws {NotFoundError} Quando não existe.
     */
    public require(id: GoalId): Goal {
        const goal = this.goals.findById(id);
        if (goal === null) {
            throw new NotFoundError('Goal', id);
        }
        return goal;
    }
}
