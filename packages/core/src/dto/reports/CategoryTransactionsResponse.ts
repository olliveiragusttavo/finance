import type { CategoryTransactionsView } from '../../services/report/ReportViews.ts';
import { toMoneyResponse, type MoneyResponse } from '../shared/MoneyResponse.ts';
import { toTransactionResponse, type TransactionResponse } from '../transactions/TransactionResponse.ts';

/** Lançamentos do drill-down (rota `reports.categoryTransactions`). */
export interface CategoryTransactionsResponse {
    readonly period: string;
    readonly scope: { readonly kind: 'category'; readonly categoryId: string } | { readonly kind: 'subCategory'; readonly subCategoryId: string };
    readonly transactions: readonly TransactionResponse[];
    /** Gasto em positivo, pela mesma regra da linha do relatório. */
    readonly total: MoneyResponse;
}

/**
 * @param view Lista montada pelo Service.
 * @return A lista serializável.
 */
export function toCategoryTransactionsResponse(view: CategoryTransactionsView): CategoryTransactionsResponse {
    return {
        period: view.period.toString(),
        scope: view.scope,
        transactions: view.transactions.map(toTransactionResponse),
        total: toMoneyResponse(view.total),
    };
}
