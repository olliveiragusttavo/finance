import type { InvoiceCycle } from '../../services/invoice/InvoiceCycle.ts';
import { toInvoiceResponse, type InvoiceResponse } from './InvoiceResponse.ts';

/**
 * Uma competência de fatura com as datas do ciclo; `invoice` é `null` quando nada caiu no
 * mês ainda, e a tela mostra o fechamento e o vencimento mesmo assim.
 */
export interface InvoiceCycleResponse {
    readonly period: string;
    readonly closingDate: string;
    readonly dueDate: string;
    readonly invoice: InvoiceResponse | null;
}

/**
 * @param cycle Competência montada pelo Service com as datas do ciclo do cartão.
 * @return A competência serializável.
 */
export function toInvoiceCycleResponse(cycle: InvoiceCycle): InvoiceCycleResponse {
    return {
        period: cycle.period.toString(),
        closingDate: cycle.closingDate.toString(),
        dueDate: cycle.dueDate.toString(),
        invoice: cycle.invoice === null ? null : toInvoiceResponse(cycle.invoice),
    };
}
