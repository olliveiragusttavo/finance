import type { CategoryReport, CategoryReportLine } from '../../domain/report/CategoryReport.ts';
import type { ComparisonMode } from '../../domain/report/Comparison.ts';
import { toMoneyResponse, type MoneyResponse } from '../shared/MoneyResponse.ts';
import { toVariationResponse, type VariationResponse } from './VariationResponse.ts';

/** Os números de uma linha: período, base e variação. */
export interface CategoryReportLineResponse {
    readonly amount: MoneyResponse;
    readonly comparison: MoneyResponse;
    readonly variation: VariationResponse;
}

/** Uma subcategoria do relatório. */
export interface SubCategoryReportRowResponse extends CategoryReportLineResponse {
    readonly subCategoryId: string;
    readonly name: string;
}

/** Uma categoria do relatório, com as subcategorias. */
export interface CategoryReportRowResponse extends CategoryReportLineResponse {
    readonly categoryId: string;
    readonly name: string;
    readonly subCategories: readonly SubCategoryReportRowResponse[];
}

/** Relatório por categoria (rota `reports.byCategory`). */
export interface CategoryReportResponse {
    readonly period: string;
    /** O modo e os meses da base, para a tela rotular a coluna de comparação. */
    readonly comparison: { readonly mode: ComparisonMode; readonly periods: readonly string[] };
    readonly categories: readonly CategoryReportRowResponse[];
    readonly total: CategoryReportLineResponse;
}

/**
 * @param line Linha do domínio.
 * @return Os números serializáveis.
 */
function toLineResponse(line: CategoryReportLine): CategoryReportLineResponse {
    return { amount: toMoneyResponse(line.amount), comparison: toMoneyResponse(line.comparison), variation: toVariationResponse(line.variation) };
}

/**
 * @param report Relatório montado pelo domínio.
 * @return O relatório serializável.
 */
export function toCategoryReportResponse(report: CategoryReport): CategoryReportResponse {
    return {
        period: report.reference.toString(),
        comparison: { mode: report.basis.mode, periods: report.basis.periods.map((period) => period.toString()) },
        categories: report.categories.map((category) => ({
            categoryId: category.categoryId,
            name: category.name,
            ...toLineResponse(category),
            subCategories: category.subCategories.map((subCategory) => ({
                subCategoryId: subCategory.subCategoryId,
                name: subCategory.name,
                ...toLineResponse(subCategory),
            })),
        })),
        total: toLineResponse(report.total),
    };
}
