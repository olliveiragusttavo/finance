import type { CardImpactMonth, CardImpactReport, CardImpactSituation } from '../../domain/report/CardImpactReport.ts';
import { toCreditCardResponse, type CreditCardResponse } from '../creditCards/CreditCardResponse.ts';
import { toMoneyResponse, type MoneyResponse } from '../shared/MoneyResponse.ts';

/** Situação de uma fatura na grade (C4), com datas e meses como texto ISO. */
export type CardImpactSituationResponse =
    | { readonly kind: 'paid'; readonly paidIn: string }
    | { readonly kind: 'open'; readonly dueDate: string }
    | { readonly kind: 'future'; readonly dueDate: string };

/** Uma fatura numa célula. */
export interface CardImpactInvoiceResponse {
    readonly invoiceId: string;
    readonly invoicePeriod: string;
    readonly total: MoneyResponse;
    readonly situation: CardImpactSituationResponse;
}

/** Um mês da grade. */
export interface CardImpactMonthResponse {
    readonly period: string;
    /** Na mesma ordem de `creditCards`. */
    readonly cells: readonly { readonly creditCardId: string; readonly invoices: readonly CardImpactInvoiceResponse[]; readonly total: MoneyResponse }[];
    readonly total: MoneyResponse;
    readonly income: MoneyResponse;
    /** Proporção (0,322 para 32,2%); `null` sem receita no mês. */
    readonly weight: number | null;
}

/** Impacto do cartão (rota `reports.cardImpact`). */
export interface CardImpactResponse {
    readonly period: string;
    /** Colunas da grade: cartões vivos, ativos e desativados (desativado continua no relatório). */
    readonly creditCards: readonly CreditCardResponse[];
    readonly months: readonly CardImpactMonthResponse[];
    readonly reference: {
        readonly total: MoneyResponse;
        readonly creditCards: number;
        readonly unpaid: number;
        readonly weight: number | null;
        readonly income: MoneyResponse;
    };
    readonly previousAverage: { readonly total: MoneyResponse; readonly weight: number | null };
}

/**
 * @param situation Situação do domínio.
 * @return A situação com datas como texto.
 */
function toSituationResponse(situation: CardImpactSituation): CardImpactSituationResponse {
    switch (situation.kind) {
        case 'paid':
            return { kind: 'paid', paidIn: situation.paidIn.toString() };
        case 'open':
            return { kind: 'open', dueDate: situation.dueDate.toString() };
        case 'future':
            return { kind: 'future', dueDate: situation.dueDate.toString() };
    }
}

/**
 * @param month Mês do domínio.
 * @return O mês serializável.
 */
function toMonthResponse(month: CardImpactMonth): CardImpactMonthResponse {
    return {
        period: month.period.toString(),
        cells: month.cells.map((cell) => ({
            creditCardId: cell.creditCardId,
            invoices: cell.invoices.map((invoice) => ({
                invoiceId: invoice.invoiceId,
                invoicePeriod: invoice.invoicePeriod.toString(),
                total: toMoneyResponse(invoice.total),
                situation: toSituationResponse(invoice.situation),
            })),
            total: toMoneyResponse(cell.total),
        })),
        total: toMoneyResponse(month.total),
        income: toMoneyResponse(month.income),
        weight: month.weight,
    };
}

/**
 * @param report Relatório montado pelo domínio.
 * @return O relatório serializável.
 */
export function toCardImpactResponse(report: CardImpactReport): CardImpactResponse {
    return {
        period: report.reference.toString(),
        creditCards: report.creditCards.map(toCreditCardResponse),
        months: report.months.map(toMonthResponse),
        reference: {
            total: toMoneyResponse(report.referenceMonth.total),
            creditCards: report.creditCardsInReference,
            unpaid: report.unpaidInReference,
            weight: report.referenceMonth.weight,
            income: toMoneyResponse(report.referenceMonth.income),
        },
        previousAverage: { total: toMoneyResponse(report.previousAverage), weight: report.previousAverageWeight },
    };
}
