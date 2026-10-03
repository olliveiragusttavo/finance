import type { CategoryReportLineResponse, CategoryReportResponse, CategoryReportRowResponse } from '@finance/core';
import { YearMonth } from '@finance/core';
import { formatMonthShort } from '../format/dates.ts';
import { formatMoney } from '../format/money.ts';
import { formatVariation, type VariationView } from '../format/variation.ts';

/** Modo de comparação, como o núcleo o recebe. */
export type ComparisonMode = CategoryReportResponse['comparison']['mode'];

/** Os números de uma linha, formatados. */
export interface CategoryReportCells {
    /** Gasto do período: em módulo nos positivos, com `−` quando os estornos superam as compras. */
    readonly amount: string;
    readonly comparison: string;
    readonly variation: VariationView;
}

/** Uma linha visível da árvore. */
export type CategoryReportRow = CategoryReportCells & (
    | { readonly kind: 'category'; readonly id: string; readonly name: string; readonly expanded: boolean; readonly hasChildren: boolean }
    | { readonly kind: 'subCategory'; readonly id: string; readonly categoryId: string; readonly name: string }
);

/** Uma barra do gráfico da categoria aberta (período × comparação). */
export interface CategoryChartBar {
    readonly subCategoryId: string;
    readonly name: string;
    readonly amount: number;
    readonly comparison: number;
    readonly amountText: string;
    readonly comparisonText: string;
    /** Largura relativa à maior barra do gráfico, 0–1; negativo (só estorno) vira zero. */
    readonly amountShare: number;
    readonly comparisonShare: number;
}

/** O relatório pronto para a tela. */
export interface CategoryReportView {
    /** Cabeçalho da coluna do período: `out/2026`. */
    readonly periodLabel: string;
    /** Cabeçalho da coluna de comparação: `set/2026`, `out/2025` ou `média jul–set/2026`. */
    readonly comparisonLabel: string;
    /** Linhas na ordem da tabela: cada categoria seguida das subcategorias quando aberta. */
    readonly rows: readonly CategoryReportRow[];
    /** Linha "Total de despesas". */
    readonly total: CategoryReportCells;
    /** Sem nenhuma categoria no período nem na comparação: a tela mostra o estado vazio. */
    readonly empty: boolean;
}

/**
 * Achata a árvore do relatório nas linhas da tabela expansível (mockup DesktopRelCategoria):
 * categoria, e logo abaixo as subcategorias das categorias abertas. A abertura é estado da
 * tela, recebido aqui, para que o view-model continue uma função pura.
 *
 * @param report Relatório do núcleo.
 * @param expanded Categorias abertas na tabela.
 * @return Rótulos das colunas, linhas visíveis e total.
 */
export function buildCategoryReport(report: CategoryReportResponse, expanded: ReadonlySet<string>): CategoryReportView {
    return {
        periodLabel: formatMonthShort(report.period),
        comparisonLabel: comparisonColumnLabel(report.comparison.mode, report.comparison.periods),
        rows: report.categories.flatMap((category): CategoryReportRow[] => {
            const isOpen = expanded.has(category.categoryId);
            return [
                { kind: 'category', id: category.categoryId, name: category.name, expanded: isOpen, hasChildren: category.subCategories.length > 0, ...cellsOf(category) },
                ...(isOpen ? category.subCategories.map((sub): CategoryReportRow => ({ kind: 'subCategory', id: sub.subCategoryId, categoryId: category.categoryId, name: sub.name, ...cellsOf(sub) })) : []),
            ];
        }),
        total: cellsOf(report.total),
        empty: report.categories.length === 0,
    };
}

/**
 * Opções do seletor "Comparar com", com os textos do mockup.
 *
 * @param period Mês de referência `YYYY-MM`; entra no rótulo do mês anterior.
 * @return As três opções, na ordem do mockup (a primeira é a padrão).
 */
export function comparisonOptions(period: string): readonly { readonly mode: ComparisonMode; readonly label: string }[] {
    return [
        { mode: 'previousMonth', label: `Mês anterior (${formatMonthShort(YearMonth.parse(period).previous().toString())})` },
        { mode: 'sameMonthLastYear', label: 'Mesmo mês do ano anterior' },
        { mode: 'lastThreeMonthsAverage', label: 'Média dos últimos 3 meses' },
    ];
}

/**
 * Barras do gráfico de uma categoria. As larguras são relativas ao maior valor entre período
 * e comparação, para que as duas séries fiquem na mesma escala e a diferença seja visível.
 *
 * @param category Categoria aberta no gráfico.
 * @return Uma barra por subcategoria, na ordem do relatório.
 */
export function categoryChartBars(category: CategoryReportRowResponse): readonly CategoryChartBar[] {
    const largest = Math.max(0, ...category.subCategories.flatMap((sub) => [sub.amount.amount, sub.comparison.amount]));
    return category.subCategories.map((sub) => ({
        subCategoryId: sub.subCategoryId,
        name: sub.name,
        amount: sub.amount.amount,
        comparison: sub.comparison.amount,
        amountText: formatMoney(sub.amount),
        comparisonText: formatMoney(sub.comparison),
        amountShare: share(sub.amount.amount, largest),
        comparisonShare: share(sub.comparison.amount, largest),
    }));
}

/** Um nível da trilha "Todas as categorias › Alimentação › Restaurantes". */
export interface BreadcrumbItem {
    readonly label: string;
    readonly target: { readonly kind: 'all' } | { readonly kind: 'category'; readonly categoryId: string } | { readonly kind: 'subCategory'; readonly subCategoryId: string };
}

/**
 * @param report Relatório do núcleo, para os nomes.
 * @param selection Nível aberto no drill-down.
 * @return A trilha da raiz até o nível aberto; o último item é o atual. Id que sumiu do
 * relatório (categoria sem gasto no novo mês) encurta a trilha em vez de mostrar nome vazio.
 */
export function categoryBreadcrumb(report: CategoryReportResponse, selection: BreadcrumbItem['target']): readonly BreadcrumbItem[] {
    const root: BreadcrumbItem = { label: 'Todas as categorias', target: { kind: 'all' } };
    if (selection.kind === 'all') {
        return [root];
    }
    for (const category of report.categories) {
        const categoryItem: BreadcrumbItem = { label: category.name, target: { kind: 'category', categoryId: category.categoryId } };
        if (selection.kind === 'category' && category.categoryId === selection.categoryId) {
            return [root, categoryItem];
        }
        const sub = selection.kind === 'subCategory' ? category.subCategories.find((item) => item.subCategoryId === selection.subCategoryId) : undefined;
        if (sub !== undefined) {
            return [root, categoryItem, { label: sub.name, target: { kind: 'subCategory', subCategoryId: sub.subCategoryId } }];
        }
    }
    return [root];
}

/**
 * @param line Números de uma linha do núcleo.
 * @return Os números formatados.
 */
function cellsOf(line: CategoryReportLineResponse): CategoryReportCells {
    return { amount: formatMoney(line.amount), comparison: formatMoney(line.comparison), variation: formatVariation(line.variation) };
}

/**
 * @param mode Modo de comparação do relatório.
 * @param periods Meses da base, em qualquer ordem — o núcleo devolve a média do mais novo
 * para o mais antigo, e o rótulo não deve depender disso.
 * @return O cabeçalho da coluna; na média, o intervalo dos meses que entraram nela, com o ano
 * de cada ponta quando o intervalo atravessa a virada do ano.
 */
function comparisonColumnLabel(mode: ComparisonMode, periods: readonly string[]): string {
    // Competência `YYYY-MM` ordena corretamente como texto.
    const sorted = [...periods].sort();
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (first === undefined || last === undefined) {
        return '';
    }
    if (mode !== 'lastThreeMonthsAverage') {
        return formatMonthShort(first);
    }
    // Ano só no fim quando é o mesmo; na virada, cada ponta leva o seu — "nov–jan/2026"
    // pareceria um intervalo invertido e esconderia que a base começa em 2025.
    const sameYear = first.slice(0, 4) === last.slice(0, 4);
    const start = sameYear ? formatMonthShort(first).slice(0, 3) : formatMonthShort(first);
    return `média ${start}–${formatMonthShort(last)}`;
}

/**
 * @param value Valor da barra.
 * @param largest Maior valor do gráfico.
 * @return A largura relativa, entre 0 e 1.
 */
function share(value: number, largest: number): number {
    return largest <= 0 ? 0 : Math.max(0, value) / largest;
}
