import type { InvoiceSuggestion } from '../../services/invoice/InvoiceViews.ts';
import { toInvoiceResponse, type InvoiceResponse } from './InvoiceResponse.ts';

/**
 * Fatura sugerida para uma compra no cartão. `invoice` vem `null` quando a fatura do
 * período ainda não existe — a UI mostra o período e a fatura nasce no lançamento.
 */
export interface InvoiceSuggestionResponse {
    readonly creditCardId: string;
    readonly period: string;
    readonly invoice: InvoiceResponse | null;
}

/**
 * @param suggestion Sugestão do Service; traz o cartão, o período calculado pelo ciclo de
 * faturamento e a fatura, se já existir.
 * @return A sugestão serializável; `invoice` é `null` quando a fatura ainda não existe.
 */
export function toInvoiceSuggestionResponse(suggestion: InvoiceSuggestion): InvoiceSuggestionResponse {
    return {
        creditCardId: suggestion.creditCard.id,
        period: suggestion.period.toString(),
        invoice: suggestion.invoice === null ? null : toInvoiceResponse(suggestion.invoice),
    };
}
