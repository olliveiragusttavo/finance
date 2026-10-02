import type { BalancePair } from '../../domain/balance/BalancePair.ts';
import { toMoneyResponse, type MoneyResponse } from './MoneyResponse.ts';

/**
 * Consolidado e previsto, sempre lado a lado — as telas mostram os dois saldos juntos e um
 * nunca deve chegar sem o outro.
 */
export interface BalancePairResponse {
    readonly consolidated: MoneyResponse;
    readonly projected: MoneyResponse;
}

/**
 * Centraliza a conversão do par para que extrato, saldos do perfil e reparo de conta
 * entreguem o mesmo formato à UI.
 *
 * @param pair Par de saldos do domínio; fornece o consolidado e o previsto a serializar.
 * @return O par serializável, com os dois valores arredondados.
 */
export function toBalancePairResponse(pair: BalancePair): BalancePairResponse {
    return { consolidated: toMoneyResponse(pair.consolidated), projected: toMoneyResponse(pair.projected) };
}
