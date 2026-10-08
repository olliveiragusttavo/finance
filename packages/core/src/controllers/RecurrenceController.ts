import { toOccurrencePreviewResponse, toRecurrenceResponse, type OccurrencePreviewResponse, type RecurrenceResponse } from '../dto/recurrences/RecurrenceResponse.ts';
import { toSeriesPlanResponse, type SeriesPlanResponse } from '../dto/recurrences/SeriesPlanResponse.ts';
import type { TopUpResponse } from '../dto/recurrences/TopUpResponse.ts';
import { toTransactionResponse, type TransactionResponse } from '../dto/transactions/TransactionResponse.ts';
import {
    listRecurrencesRequest,
    planCreateRequest,
    planDeleteRequest,
    planUpdateRequest,
    previewRecurrenceRequest,
    recurrenceIdRequest,
    topUpRecurrencesRequest,
} from '../requests/recurrenceRequests.ts';
import type { RecurrenceService } from '../services/recurrence/RecurrenceService.ts';
import type { SeriesPlanner } from '../services/recurrence/SeriesPlanner.ts';
import { handle, toCoreError, type CoreResult, type UnexpectedErrorListener } from './CoreResult.ts';

/** Rotas de recorrência: séries do perfil, ocorrências de uma série, prévia, plano do diálogo de revisão e complemento. */
export class RecurrenceController {
    /**
     * @param recurrences Casos de uso de recorrência.
     * @param planner Planos das escritas de série, para o diálogo de revisão.
     * @param onUnexpected Destino do log de falhas inesperadas.
     */
    public constructor(
        private readonly recurrences: RecurrenceService,
        private readonly planner: SeriesPlanner,
        private readonly onUnexpected: UnexpectedErrorListener,
    ) {}

    /**
     * @param raw Entrada com o perfil.
     * @return As séries vivas do perfil.
     */
    public list(raw: unknown): Promise<CoreResult<readonly RecurrenceResponse[]>> {
        return handle(listRecurrencesRequest, raw, ({ profileId }) => this.recurrences.list(profileId).map(toRecurrenceResponse), this.onUnexpected);
    }

    /**
     * @param raw Entrada com a série.
     * @return As ocorrências vivas da série, por data.
     */
    public occurrences(raw: unknown): Promise<CoreResult<readonly TransactionResponse[]>> {
        return handle(recurrenceIdRequest, raw, ({ recurrenceId }) => this.recurrences.occurrences(recurrenceId).map(toTransactionResponse), this.onUnexpected);
    }

    /**
     * @param raw Origem, data, valor e repetição do formulário.
     * @return As ocorrências que a criação gravaria, sem gravar nada.
     */
    public preview(raw: unknown): Promise<CoreResult<readonly OccurrencePreviewResponse[]>> {
        return handle(previewRecurrenceRequest, raw, (command) => this.recurrences.preview(command).map(toOccurrencePreviewResponse), this.onUnexpected);
    }

    /**
     * @param raw Entrada não confiável do formulário de lançamento, como a de `transactions.create`.
     * @return O que a criação gravaria, sem gravar nada.
     */
    public planCreate(raw: unknown): Promise<CoreResult<SeriesPlanResponse>> {
        return handle(planCreateRequest, raw, (command) => toSeriesPlanResponse(this.planner.planCreate(command)), this.onUnexpected);
    }

    /**
     * @param raw Entrada não confiável da edição, como a de `transactions.update`.
     * @return O que a edição faria, sem gravar nada.
     */
    public planUpdate(raw: unknown): Promise<CoreResult<SeriesPlanResponse>> {
        return handle(planUpdateRequest, raw, (command) => toSeriesPlanResponse(this.planner.planUpdate(command)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com o id da transação e o escopo, como a de `transactions.delete`.
     * @return O que a exclusão faria, sem gravar nada.
     */
    public planDelete(raw: unknown): Promise<CoreResult<SeriesPlanResponse>> {
        return handle(planDeleteRequest, raw, ({ id, scope }) => toSeriesPlanResponse(this.planner.planDelete(id, scope)), this.onUnexpected);
    }

    /**
     * A série que falha não falha a rota (backend-design §4.5): ela volta na lista, e o bug, se
     * for um, vai para o log de falhas inesperadas como em qualquer rota.
     *
     * @param raw Entrada vazia.
     * @return Quantas ocorrências o complemento emitiu e as séries que não conseguiu estender.
     */
    public topUp(raw: unknown): Promise<CoreResult<TopUpResponse>> {
        return handle(topUpRecurrencesRequest, raw, () => {
            const outcome = this.recurrences.topUp();
            return {
                emitted: outcome.emitted,
                failures: outcome.failures.map((failure) => ({ recurrenceId: failure.recurrenceId, error: toCoreError(failure.error, this.onUnexpected) })),
            };
        }, this.onUnexpected);
    }
}
