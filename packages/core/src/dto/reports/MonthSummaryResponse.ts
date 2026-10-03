import type { MonthSummary } from '../../domain/report/MonthSummary.ts';
import { toMoneyResponse, type MoneyResponse } from '../shared/MoneyResponse.ts';
import { toVariationResponse, type VariationResponse } from './VariationResponse.ts';

/** Indicadores do mês da Visão geral (rota `reports.monthSummary`). */
export interface MonthSummaryResponse {
    readonly period: string;
    readonly income: MoneyResponse;
    readonly incomeCount: number;
    /** Gasto do mês em positivo; a tela põe o sinal de saída. */
    readonly expenses: MoneyResponse;
    readonly expenseCount: number;
    readonly previousExpenses: MoneyResponse;
    readonly expenseVariation: VariationResponse;
    readonly openInvoices: {
        readonly amountDue: MoneyResponse;
        readonly invoices: number;
        readonly creditCards: number;
        readonly nextDueDate: string | null;
    };
}

/**
 * @param summary Indicadores montados pelo domínio.
 * @return Os indicadores serializáveis.
 */
export function toMonthSummaryResponse(summary: MonthSummary): MonthSummaryResponse {
    return {
        period: summary.reference.toString(),
        income: toMoneyResponse(summary.income),
        incomeCount: summary.incomeCount,
        expenses: toMoneyResponse(summary.expenses),
        expenseCount: summary.expenseCount,
        previousExpenses: toMoneyResponse(summary.previousExpenses),
        expenseVariation: toVariationResponse(summary.expenseVariation),
        openInvoices: {
            amountDue: toMoneyResponse(summary.openInvoices.amountDue),
            invoices: summary.openInvoices.invoices,
            creditCards: summary.openInvoices.creditCards,
            nextDueDate: summary.openInvoices.nextDueDate?.toString() ?? null,
        },
    };
}
