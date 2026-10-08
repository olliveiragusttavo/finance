import type { PlannedOccurrence, SeriesPlan } from '../../services/recurrence/SeriesPlanner.ts';
import { toTransactionResponse, type TransactionResponse } from '../transactions/TransactionResponse.ts';
import { toRecurrenceResponse, type RecurrenceResponse } from './RecurrenceResponse.ts';

/** Uma ocorrência que a operação exclui, cria ou altera. */
export interface PlannedOccurrenceResponse {
    /** A ocorrência inteira: a lista mostra a data e se está paga, e o aviso usa o mês e as contas. */
    readonly transaction: TransactionResponse;
    /** Se foi editada à mão depois de criada; a lista marca, para o usuário saber o que perde. */
    readonly editedByHand: boolean;
}

/**
 * O que uma criação, edição ou exclusão faz com uma série, sem gravar nada — o diálogo de
 * revisão (database-design §4.12). As regras vão inteiras para que a tela descreva o
 * que muda ("a série fixa será encerrada", "passa de 12 para 8 parcelas") sem outra consulta.
 */
export interface SeriesPlanResponse {
    /** A regra antes da operação; `null` numa criação. */
    readonly seriesBefore: RecurrenceResponse | null;
    /** A mesma regra depois; `null` quando ela é excluída ou numa criação. */
    readonly seriesAfter: RecurrenceResponse | null;
    /** A regra criada (criação ou série recomeçada); `null` quando nenhuma é criada. */
    readonly newSeries: RecurrenceResponse | null;
    readonly deleted: readonly PlannedOccurrenceResponse[];
    readonly created: readonly PlannedOccurrenceResponse[];
    readonly updated: readonly PlannedOccurrenceResponse[];
}

/**
 * @param plan Plano montado pelo Service.
 * @return O plano serializável.
 */
export function toSeriesPlanResponse(plan: SeriesPlan): SeriesPlanResponse {
    return {
        seriesBefore: plan.seriesBefore === null ? null : toRecurrenceResponse(plan.seriesBefore),
        seriesAfter: plan.seriesAfter === null ? null : toRecurrenceResponse(plan.seriesAfter),
        newSeries: plan.newSeries === null ? null : toRecurrenceResponse(plan.newSeries),
        deleted: plan.deleted.map(toPlannedOccurrenceResponse),
        created: plan.created.map(toPlannedOccurrenceResponse),
        updated: plan.updated.map(toPlannedOccurrenceResponse),
    };
}

/**
 * @param planned Ocorrência do plano.
 * @return A ocorrência serializável.
 */
function toPlannedOccurrenceResponse(planned: PlannedOccurrence): PlannedOccurrenceResponse {
    return { transaction: toTransactionResponse(planned.transaction), editedByHand: planned.editedByHand };
}
