import type { CategoryId, SubCategoryId } from '../shared/ids.ts';
import type { Money } from '../shared/Money.ts';
import type { YearMonth } from '../shared/YearMonth.ts';
import type { ComparisonBasis } from './Comparison.ts';
import { expenseOutflow, type SubCategoryExpenseTotals } from './ReportTotals.ts';
import { Variation } from './Variation.ts';

/** Os números de uma linha do relatório: período, base de comparação e variação. */
export interface CategoryReportLine {
    readonly amount: Money;
    readonly comparison: Money;
    readonly variation: Variation;
}

/** Uma subcategoria no relatório. */
export interface SubCategoryReportRow extends CategoryReportLine {
    readonly subCategoryId: SubCategoryId;
    readonly name: string;
}

/** Uma categoria no relatório, com as subcategorias que a formam. */
export interface CategoryReportRow extends CategoryReportLine {
    readonly categoryId: CategoryId;
    readonly name: string;
    readonly subCategories: readonly SubCategoryReportRow[];
}

/** O relatório por categoria de um mês contra uma base de comparação. */
export interface CategoryReport {
    readonly reference: YearMonth;
    readonly basis: ComparisonBasis;
    readonly categories: readonly CategoryReportRow[];
    readonly total: CategoryReportLine;
}

/** Acumulador de uma subcategoria enquanto as linhas do SQL são lidas. */
interface SubCategoryAccumulator {
    readonly categoryId: CategoryId;
    readonly categoryName: string;
    readonly subCategoryId: SubCategoryId;
    readonly name: string;
    readonly byPeriod: Map<string, Money>;
}

/**
 * Monta a árvore categoria → subcategoria a partir das somas por mês de pagamento.
 * Regra de negócio (Relatórios, R1–R6 — reports-design §3): só despesas, pelo mês do
 * pagamento; estornos abatem a própria subcategoria; encargos entram. Uma linha aparece
 * quando tem lançamento no período **ou** na base, para que "gastou zero este mês" fique
 * visível ao lado do que foi gasto antes. A categoria soma as subcategorias, e a base da
 * categoria é a soma das bases — a média é linear, então a média da soma é a soma das médias.
 *
 * @param reference Mês de referência.
 * @param basis Meses da comparação.
 * @param totals Somas por subcategoria e mês, já limitadas ao mês de referência e à base.
 * @param zero Zero na moeda do perfil, para somas vazias.
 * @return O relatório, com categorias e subcategorias do maior para o menor gasto.
 */
export function buildCategoryReport(reference: YearMonth, basis: ComparisonBasis, totals: readonly SubCategoryExpenseTotals[], zero: Money): CategoryReport {
    const subCategories = new Map<SubCategoryId, SubCategoryAccumulator>();
    for (const row of totals) {
        if (!row.period.equals(reference) && !basis.includes(row.period)) {
            continue;
        }
        const accumulator = subCategories.get(row.subCategoryId) ?? {
            categoryId: row.categoryId,
            categoryName: row.categoryName,
            subCategoryId: row.subCategoryId,
            name: row.subCategoryName,
            byPeriod: new Map<string, Money>(),
        };
        const key = row.period.toString();
        accumulator.byPeriod.set(key, (accumulator.byPeriod.get(key) ?? zero).add(expenseOutflow(row.value, row.charges)));
        subCategories.set(row.subCategoryId, accumulator);
    }

    const categories = new Map<CategoryId, { readonly name: string; readonly rows: SubCategoryReportRow[] }>();
    for (const accumulator of subCategories.values()) {
        const amountIn = (period: YearMonth): Money => accumulator.byPeriod.get(period.toString()) ?? zero;
        const row: SubCategoryReportRow = {
            subCategoryId: accumulator.subCategoryId,
            name: accumulator.name,
            ...line(amountIn(reference), basis.valueOf(amountIn, zero)),
        };
        const category = categories.get(accumulator.categoryId) ?? { name: accumulator.categoryName, rows: [] };
        category.rows.push(row);
        categories.set(accumulator.categoryId, category);
    }

    const categoryRows = [...categories.entries()].map(([categoryId, { name, rows }]): CategoryReportRow => ({
        categoryId,
        name,
        subCategories: [...rows].sort(byLargestAmount),
        ...line(sumOf(rows, 'amount', zero), sumOf(rows, 'comparison', zero)),
    }));
    return {
        reference,
        basis,
        categories: categoryRows.sort(byLargestAmount),
        total: line(sumOf(categoryRows, 'amount', zero), sumOf(categoryRows, 'comparison', zero)),
    };
}

/**
 * @param amount Valor do período.
 * @param comparison Valor da base.
 * @return A linha com a variação calculada pela regra única de `Variation`.
 */
function line(amount: Money, comparison: Money): CategoryReportLine {
    return { amount, comparison, variation: Variation.between(amount, comparison) };
}

/**
 * @param rows Linhas a somar.
 * @param field Coluna somada.
 * @param zero Zero na moeda do perfil.
 * @return A soma da coluna.
 */
function sumOf(rows: readonly CategoryReportLine[], field: 'amount' | 'comparison', zero: Money): Money {
    return rows.reduce((total, row) => total.add(row[field]), zero);
}

/**
 * Ordem da tela: maior gasto primeiro; empate pela base e depois pelo nome, para que a
 * ordem seja estável entre aberturas. Compara os valores arredondados para que um ruído de
 * ponto flutuante não decida a ordem de dois valores que a tela mostra iguais.
 *
 * @param a Primeira linha.
 * @param b Segunda linha.
 * @return Negativo quando `a` vem antes.
 */
function byLargestAmount(a: CategoryReportLine & { readonly name: string }, b: CategoryReportLine & { readonly name: string }): number {
    const amount = b.amount.rounded().amount - a.amount.rounded().amount;
    if (amount !== 0) {
        return amount;
    }
    const comparison = b.comparison.rounded().amount - a.comparison.rounded().amount;
    if (comparison !== 0) {
        return comparison;
    }
    const nameA = a.name.toLowerCase();
    const nameB = b.name.toLowerCase();
    return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
}
