import type { NextInvoicesSummary, PendingDirection, PendingItem, PendingSummary, PendingTotals } from '../../domain/overview/PendingItems.ts';
import type { SpendingSummary } from '../../domain/overview/SpendingSummary.ts';
import { toMoneyResponse, type MoneyResponse } from '../shared/MoneyResponse.ts';

/** Despesas de um mês do gráfico "Gastos por mês". */
export interface SpendingMonthResponse {
    readonly period: string;
    readonly expenses: MoneyResponse;
}

/** Uma categoria de "Para onde foi no mês". */
export interface CategorySpendingResponse {
    readonly categoryId: string;
    readonly name: string;
    readonly amount: MoneyResponse;
}

/** Resumo de gastos da Visão geral (rota `overview.spending`). */
export interface OverviewSpendingResponse {
    readonly period: string;
    /** Os seis meses até o de referência, do mais antigo ao mais recente. */
    readonly months: readonly SpendingMonthResponse[];
    /** Média dos meses desde o primeiro com gasto; `null` sem gasto na janela. */
    readonly average: MoneyResponse | null;
    readonly expenses: MoneyResponse;
    readonly income: MoneyResponse;
    /** As maiores categorias, da maior para a menor. */
    readonly categories: readonly CategorySpendingResponse[];
    readonly others: { readonly count: number; readonly amount: MoneyResponse };
}

/** Um item em aberto: lançamento de conta ou fatura. */
export type PendingItemResponse =
    | {
        readonly kind: 'transaction';
        readonly id: string;
        readonly name: string;
        readonly dueDate: string;
        readonly direction: PendingDirection;
        /** Sempre positivo; o sentido está em `direction`. */
        readonly amount: MoneyResponse;
        readonly where: string;
        readonly canMarkPaid: boolean;
    }
    | {
        readonly kind: 'invoice';
        readonly id: string;
        readonly creditCardId: string;
        readonly period: string;
        readonly name: string;
        readonly dueDate: string;
        readonly direction: 'out';
        readonly amount: MoneyResponse;
        readonly where: string;
    };

/** Quanto um grupo soma a pagar e a receber. */
export interface PendingTotalsResponse {
    readonly toPay: MoneyResponse;
    readonly toReceive: MoneyResponse;
}

/** Atrasados e em aberto até o fim do mês (rota `overview.pending`). */
export interface OverviewPendingResponse {
    readonly today: string;
    readonly until: string;
    readonly overdue: readonly PendingItemResponse[];
    readonly overdueTotals: PendingTotalsResponse;
    readonly upcoming: readonly PendingItemResponse[];
    readonly upcomingTotals: PendingTotalsResponse;
}

/** A próxima fatura de cada cartão (rota `overview.nextInvoices`). */
export interface OverviewNextInvoicesResponse {
    readonly today: string;
    readonly invoices: readonly Extract<PendingItemResponse, { readonly kind: 'invoice' }>[];
}

/**
 * @param summary Resumo do domínio.
 * @return O resumo serializável.
 */
export function toOverviewSpendingResponse(summary: SpendingSummary): OverviewSpendingResponse {
    return {
        period: summary.period.toString(),
        months: summary.months.map((month) => ({ period: month.period.toString(), expenses: toMoneyResponse(month.amount) })),
        average: summary.average === null ? null : toMoneyResponse(summary.average),
        expenses: toMoneyResponse(summary.expenses),
        income: toMoneyResponse(summary.income),
        categories: summary.categories.map((category) => ({ categoryId: category.categoryId, name: category.name, amount: toMoneyResponse(category.amount) })),
        others: { count: summary.others.count, amount: toMoneyResponse(summary.others.amount) },
    };
}

/**
 * @param item Item do domínio.
 * @return O item serializável, com as datas em texto ISO.
 */
function toPendingItemResponse(item: PendingItem): PendingItemResponse {
    switch (item.kind) {
        case 'transaction':
            return { ...item, dueDate: item.dueDate.toString(), amount: toMoneyResponse(item.amount) };
        case 'invoice':
            return { ...item, dueDate: item.dueDate.toString(), amount: toMoneyResponse(item.amount) };
    }
}

/**
 * @param totals Totais do domínio.
 * @return Os totais serializáveis.
 */
function toPendingTotalsResponse(totals: PendingTotals): PendingTotalsResponse {
    return { toPay: toMoneyResponse(totals.toPay), toReceive: toMoneyResponse(totals.toReceive) };
}

/**
 * @param summary Atrasados e em aberto do domínio.
 * @return O resumo serializável.
 */
export function toOverviewPendingResponse(summary: PendingSummary): OverviewPendingResponse {
    return {
        today: summary.today.toString(),
        until: summary.until.toString(),
        overdue: summary.overdue.map(toPendingItemResponse),
        overdueTotals: toPendingTotalsResponse(summary.overdueTotals),
        upcoming: summary.upcoming.map(toPendingItemResponse),
        upcomingTotals: toPendingTotalsResponse(summary.upcomingTotals),
    };
}

/**
 * @param view Próximas faturas do domínio.
 * @return As faturas serializáveis.
 */
export function toOverviewNextInvoicesResponse(view: NextInvoicesSummary): OverviewNextInvoicesResponse {
    return {
        today: view.today.toString(),
        invoices: view.invoices.map((invoice) => ({ ...invoice, dueDate: invoice.dueDate.toString(), amount: toMoneyResponse(invoice.amount) })),
    };
}
