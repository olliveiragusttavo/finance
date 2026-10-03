import type { BalanceEvolutionView } from '../../services/report/ReportViews.ts';
import { toBalancePairResponse, type BalancePairResponse } from '../shared/BalancePairResponse.ts';

/** Série de saldos do perfil (rota `reports.balanceEvolution`). */
export interface BalanceEvolutionResponse {
    readonly period: string;
    /** Do mês mais antigo ao de referência. */
    readonly points: readonly { readonly period: string; readonly closing: BalancePairResponse }[];
}

/**
 * @param view Série montada pelo Service.
 * @return A série serializável.
 */
export function toBalanceEvolutionResponse(view: BalanceEvolutionView): BalanceEvolutionResponse {
    return {
        period: view.reference.toString(),
        points: view.points.map((point) => ({ period: point.period.toString(), closing: toBalancePairResponse(point.closing) })),
    };
}
