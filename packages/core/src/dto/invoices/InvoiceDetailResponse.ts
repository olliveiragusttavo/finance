import type { InvoiceView } from '../../services/invoice/InvoiceViews.ts';
import { toTransactionResponse, type TransactionResponse } from '../transactions/TransactionResponse.ts';
import { toInvoiceResponse, type InvoiceResponse } from './InvoiceResponse.ts';

/** Fatura aberta na tela de detalhe: o resumo mais cartão, datas do ciclo e lançamentos. */
export interface InvoiceDetailResponse extends InvoiceResponse {
    readonly creditCardName: string;
    readonly closingDate: string;
    readonly dueDate: string;
    readonly transactions: readonly TransactionResponse[];
}

/**
 * Reaproveita o resumo da fatura para que o detalhe nunca divirja da lista quanto a saldo e
 * status.
 *
 * @param view Fatura com cartão, datas do ciclo e transações, montada pelo Service; traz o
 * que o resumo sozinho não tem.
 * @return O detalhe serializável da fatura.
 */
export function toInvoiceDetailResponse(view: InvoiceView): InvoiceDetailResponse {
    return {
        ...toInvoiceResponse(view.invoice),
        creditCardName: view.creditCard.name,
        closingDate: view.closingDate.toString(),
        dueDate: view.dueDate.toString(),
        transactions: view.transactions.map(toTransactionResponse),
    };
}
