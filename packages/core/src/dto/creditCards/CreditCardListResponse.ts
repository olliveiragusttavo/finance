import type { CreditCardListView } from '../../services/creditCard/CreditCardViews.ts';
import { toInvoiceCycleResponse, type InvoiceCycleResponse } from '../invoices/InvoiceCycleResponse.ts';
import { toMoneyResponse, type MoneyResponse } from '../shared/MoneyResponse.ts';
import { toCreditCardResponse, type CreditCardResponse } from './CreditCardResponse.ts';

/** Um cartão na lista do mês: o cadastro, a fatura do mês e o limite usado. */
export interface CreditCardInPeriodResponse extends CreditCardResponse {
    readonly invoiceOfMonth: InvoiceCycleResponse;
    readonly limitUsed: MoneyResponse;
}

/** A lista de cartões de um mês, com os totais (tela de Cartões). */
export interface CreditCardListResponse {
    readonly profileId: string;
    readonly period: string;
    readonly creditCards: readonly CreditCardInPeriodResponse[];
    readonly openTotal: MoneyResponse;
    readonly total: MoneyResponse;
}

/**
 * Os totais vêm prontos do Service, em módulo, para que a UI não decida sozinha o que fazer
 * com uma fatura credora.
 *
 * @param view Lista montada pelo Service.
 * @return A lista serializável.
 */
export function toCreditCardListResponse(view: CreditCardListView): CreditCardListResponse {
    return {
        profileId: view.profile.id,
        period: view.period.toString(),
        creditCards: view.creditCards.map(({ creditCard, invoiceOfMonth, limitUsed }) => ({
            ...toCreditCardResponse(creditCard),
            invoiceOfMonth: toInvoiceCycleResponse(invoiceOfMonth),
            limitUsed: toMoneyResponse(limitUsed),
        })),
        openTotal: toMoneyResponse(view.openTotal),
        total: toMoneyResponse(view.total),
    };
}
