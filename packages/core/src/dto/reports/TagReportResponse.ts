import type { TagAmounts, TagCategoryLine, TagReport, TagReportRange, TagSummary } from '../../domain/report/TagReport.ts';
import type { TagTransactionsView } from '../../services/report/ReportViews.ts';
import { toMoneyResponse, type MoneyResponse } from '../shared/MoneyResponse.ts';
import { toTransactionResponse, type TransactionResponse } from '../transactions/TransactionResponse.ts';

/** Despesas, receitas e o líquido de um recorte, todos em positivo no seu sentido. */
export interface TagAmountsResponse {
    /** Despesas líquidas de estornos, com encargos. */
    readonly expense: MoneyResponse;
    /** Receitas líquidas das tarifas. */
    readonly income: MoneyResponse;
    /** Despesas − receitas: positivo é gasto; negativo, entrada líquida. */
    readonly net: MoneyResponse;
    readonly count: number;
}

/** Uma categoria da tag. */
export interface TagCategoryResponse extends TagAmountsResponse {
    readonly categoryId: string;
    readonly name: string;
    /** Proporção do gasto líquido da tag (0,44 para 44%); `null` sem gasto líquido (T4). */
    readonly share: number | null;
}

/** Uma tag com lançamento no período. */
export interface TagSummaryResponse extends TagAmountsResponse {
    readonly tagId: string;
    readonly name: string;
    readonly firstPeriod: string;
    readonly lastPeriod: string;
    readonly categories: readonly TagCategoryResponse[];
}

/** Relatório por tag (rota `reports.byTag`). */
export interface TagReportResponse {
    readonly period: string;
    readonly range: TagReportRange;
    /** Pelo total líquido, maior primeiro; só as tags com lançamento no período. */
    readonly tags: readonly TagSummaryResponse[];
}

/** Lançamentos de uma tag (rota `reports.tagTransactions`). */
export interface TagTransactionsResponse {
    readonly period: string;
    readonly range: TagReportRange;
    readonly tagId: string;
    readonly transactions: readonly TransactionResponse[];
    /** Despesas − receitas, pela mesma regra do total da tag. */
    readonly total: MoneyResponse;
}

/**
 * @param amounts Recorte do domínio.
 * @return Os valores arredondados.
 */
function toAmountsResponse(amounts: TagAmounts): TagAmountsResponse {
    return { expense: toMoneyResponse(amounts.expense), income: toMoneyResponse(amounts.income), net: toMoneyResponse(amounts.net), count: amounts.count };
}

/**
 * @param category Categoria do domínio.
 * @return A categoria serializável.
 */
function toCategoryResponse(category: TagCategoryLine): TagCategoryResponse {
    return { categoryId: category.categoryId, name: category.name, ...toAmountsResponse(category), share: category.share };
}

/**
 * @param tag Tag do domínio.
 * @return A tag serializável, com os meses como `YYYY-MM`.
 */
function toSummaryResponse(tag: TagSummary): TagSummaryResponse {
    return {
        tagId: tag.tagId,
        name: tag.name,
        ...toAmountsResponse(tag),
        firstPeriod: tag.firstPeriod.toString(),
        lastPeriod: tag.lastPeriod.toString(),
        categories: tag.categories.map(toCategoryResponse),
    };
}

/**
 * @param report Relatório montado pelo domínio.
 * @return O relatório serializável.
 */
export function toTagReportResponse(report: TagReport): TagReportResponse {
    return { period: report.reference.toString(), range: report.range, tags: report.tags.map(toSummaryResponse) };
}

/**
 * @param view Lista montada pelo Service.
 * @return A lista serializável.
 */
export function toTagTransactionsResponse(view: TagTransactionsView): TagTransactionsResponse {
    return {
        period: view.period.toString(),
        range: view.range,
        tagId: view.tagId,
        transactions: view.transactions.map(toTransactionResponse),
        total: toMoneyResponse(view.total),
    };
}
