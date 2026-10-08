import { Goal } from '../../domain/goal/Goal.ts';
import { measureGoalProgress } from '../../domain/goal/GoalProgress.ts';
import { NotFoundError } from '../../domain/shared/errors.ts';
import { GoalId, type ProfileId } from '../../domain/shared/ids.ts';
import { Money } from '../../domain/shared/Money.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { IdGenerator } from '../../ports/IdGenerator.ts';
import type { GoalRepository } from '../../repositories/GoalRepository.ts';
import type { TransactionRepository } from '../../repositories/TransactionRepository.ts';
import type { ProfileService } from '../profile/ProfileService.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import type { CreateGoalCommand, UpdateGoalCommand } from './GoalCommands.ts';
import type { GoalContributionView, GoalWithProgress } from './GoalViews.ts';

/**
 * Cadastro de metas e o progresso delas (database-design §4.11; mockup `DesktopMetas`). O
 * progresso nunca é gravado: cada leitura soma as transações vinculadas, que são a única
 * fonte da verdade (§4.11). Meta não afeta saldo, então nada aqui recalcula.
 */
export class GoalService {
    /**
     * @param unitOfWork Leitura, conferência e escrita numa transação só.
     * @param ids Gera o UUID v4 das metas novas.
     * @param clock Dá o "hoje" que decide o que já conta no progresso.
     * @param profiles Confere o perfil e dá a moeda do valor-alvo.
     * @param goals Metas e os vínculos com transações.
     * @param transactions Carrega de uma vez as transações da meta, para a tabela do detalhe.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly ids: IdGenerator,
        private readonly clock: Clock,
        private readonly profiles: ProfileService,
        private readonly goals: GoalRepository,
        private readonly transactions: TransactionRepository,
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
                const linked = links.get(goal.id) ?? [];
                return { goal, progress: measureGoalProgress({ goal, links: linked, period, today }), linkedCount: linked.length };
            });
        });
    }

    /**
     * Metas do perfil sem o progresso, para o campo "Meta" do lançamento. Não lê vínculos nem
     * o relógio: o formulário só precisa do id e do nome, e medir o progresso de cada meta a
     * cada abertura dele era trabalho jogado fora (revisão de 2026-10-08, item 5).
     *
     * @param profileId Perfil consultado.
     * @return As metas vivas do perfil, por nome; vazio sem metas.
     * @throws {NotFoundError} Quando o perfil não existe.
     */
    public options(profileId: ProfileId): readonly Goal[] {
        return this.unitOfWork.run(() => {
            this.profiles.require(profileId);
            return this.goals.listByProfile(profileId);
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
     * @return As transações que contam, da mais antiga para a mais recente pelo dia do pagamento.
     * @throws {NotFoundError} Quando a meta não existe.
     */
    public contributions(id: GoalId): readonly GoalContributionView[] {
        return this.unitOfWork.run(() => {
            const goal = this.require(id);
            const links = this.goals.linksOf(goal.id);
            // O mês de referência só mexe no ritmo; as contribuições dependem apenas de hoje.
            const today = this.clock.today();
            const { contributions } = measureGoalProgress({ goal, links, period: today.period, today });
            const transactions = new Map(this.transactions.listByGoal(goal.id).map((transaction) => [transaction.id, transaction]));
            return contributions.flatMap((contribution): GoalContributionView[] => {
                const transaction = transactions.get(contribution.transactionId);
                return transaction === undefined ? [] : [{ transaction, paidOn: contribution.paidOn }];
            });
        });
    }

    /**
     * @param command Perfil e conteúdo da meta.
     * @return A meta gravada.
     * @throws {NotFoundError} Quando o perfil não existe.
     * @throws {InvalidValueError} Quando o nome ou o valor-alvo é inválido.
     */
    public create(command: CreateGoalCommand): Goal {
        return this.unitOfWork.run(() => {
            const profile = this.profiles.require(command.profileId);
            const goal = Goal.create({
                id: GoalId(this.ids.random()),
                profileId: profile.id,
                name: command.name,
                target: Money.of(command.value, profile.currency),
                targetDate: command.targetDate,
            });
            this.goals.save(goal);
            return this.require(goal.id);
        });
    }

    /**
     * @param command Meta e novo conteúdo.
     * @return A meta editada; as transações vinculadas continuam vinculadas.
     * @throws {NotFoundError} Quando a meta não existe.
     * @throws {InvalidValueError} Quando o nome ou o valor-alvo é inválido.
     */
    public update(command: UpdateGoalCommand): Goal {
        return this.unitOfWork.run(() => {
            const current = this.require(command.id);
            const revised = current.revise({ name: command.name, target: Money.of(command.value, current.target.currency), targetDate: command.targetDate });
            this.goals.save(revised);
            return this.require(revised.id);
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
