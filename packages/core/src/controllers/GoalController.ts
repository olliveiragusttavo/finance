import {
    toGoalContributionResponses,
    toGoalOptionResponses,
    toGoalProgressResponses,
    toGoalResponse,
    type GoalContributionResponse,
    type GoalOptionResponse,
    type GoalProgressResponse,
    type GoalResponse,
} from '../dto/goals/GoalResponse.ts';
import { createGoalRequest, goalIdRequest, goalOptionsRequest, listGoalsRequest, updateGoalRequest } from '../requests/goalRequests.ts';
import type { GoalService } from '../services/goal/GoalService.ts';
import { handle, type CoreResult, type UnexpectedErrorListener } from './CoreResult.ts';

/**
 * Rotas do cadastro de metas e do progresso delas. Só traduz: valida a entrada pelo schema da
 * rota e converte o resultado em DTO, para que o Service nunca receba dado não validado nem a UI
 * receba entidade de domínio (backend-design, camadas Request → Controller → Service).
 */
export class GoalController {
    /**
     * @param goals Cadastro e progresso das metas.
     * @param onUnexpected Destino do log de falhas inesperadas.
     */
    public constructor(
        private readonly goals: GoalService,
        private readonly onUnexpected: UnexpectedErrorListener,
    ) {}

    /**
     * Lista da tela de Metas. O progresso vai pronto no DTO, e não calculado na UI, porque é
     * regra de negócio e desktop e celular precisam mostrar o mesmo número.
     *
     * @param raw Entrada com o perfil e o mês de referência, de cujo fim o ritmo conta.
     * @return As metas do perfil por nome, com o progresso de cada uma.
     */
    public list(raw: unknown): Promise<CoreResult<readonly GoalProgressResponse[]>> {
        return handle(listGoalsRequest, raw, ({ profileId, period }) => toGoalProgressResponses(this.goals.list(profileId, period)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com o perfil.
     * @return As metas do perfil só com id e nome, para o campo "Meta" do lançamento.
     */
    public options(raw: unknown): Promise<CoreResult<readonly GoalOptionResponse[]>> {
        return handle(goalOptionsRequest, raw, ({ profileId }) => toGoalOptionResponses(this.goals.options(profileId)), this.onUnexpected);
    }

    /**
     * Tabela do detalhe, separada da lista para que a lista não carregue transações inteiras de
     * todas as metas.
     *
     * @param raw Entrada com a meta.
     * @return As transações que contam no progresso, pelo dia do pagamento; vazio quando nada
     * foi pago ainda.
     */
    public contributions(raw: unknown): Promise<CoreResult<readonly GoalContributionResponse[]>> {
        return handle(goalIdRequest, raw, ({ id }) => toGoalContributionResponses(this.goals.contributions(id)), this.onUnexpected);
    }

    /**
     * Devolve a meta sem progresso: uma meta nova não tem vínculo, e a lista, invalidada pela
     * escrita, traz o progresso na próxima leitura.
     *
     * @param raw Entrada com o perfil e o conteúdo.
     * @return A meta criada, como ficou gravada (nome aparado, alvo na moeda do perfil).
     */
    public create(raw: unknown): Promise<CoreResult<GoalResponse>> {
        return handle(createGoalRequest, raw, (command) => toGoalResponse(this.goals.create(command)), this.onUnexpected);
    }

    /**
     * Devolve a meta sem progresso pelo mesmo motivo de `create`: editar nome, alvo ou prazo não
     * mexe nos vínculos, e a lista invalidada recalcula o ritmo.
     *
     * @param raw Entrada com a meta e o novo conteúdo.
     * @return A meta editada, como ficou gravada.
     */
    public update(raw: unknown): Promise<CoreResult<GoalResponse>> {
        return handle(updateGoalRequest, raw, (command) => toGoalResponse(this.goals.update(command)), this.onUnexpected);
    }

    /**
     * Devolve `null`, e não a meta, porque depois de excluída ela não é mais lida; o que muda
     * (os lançamentos e séries que perdem o vínculo) chega pela invalidação das leituras.
     *
     * @param raw Entrada com a meta.
     * @return `null` em caso de sucesso.
     */
    public delete(raw: unknown): Promise<CoreResult<null>> {
        return handle(goalIdRequest, raw, ({ id }) => {
            this.goals.delete(id);
            return null;
        }, this.onUnexpected);
    }
}
