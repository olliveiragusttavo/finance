import type { Variation } from '../../domain/report/Variation.ts';
import { toMoneyResponse, type MoneyResponse } from '../shared/MoneyResponse.ts';

/**
 * Variação serializável. `change` mantém a união do domínio — proporção ou "novo" — para que
 * a tela trate a base zero de forma exaustiva, sem adivinhar o que um `null` quis dizer.
 */
export interface VariationResponse {
    readonly absolute: MoneyResponse;
    /** `ratio` é a proporção (0,166 para +16,6%); a tela formata. */
    readonly change: { readonly kind: 'ratio'; readonly ratio: number } | { readonly kind: 'new' };
}

/**
 * @param variation Variação calculada pelo domínio.
 * @return A variação serializável.
 */
export function toVariationResponse(variation: Variation): VariationResponse {
    return { absolute: toMoneyResponse(variation.absolute), change: variation.change };
}
