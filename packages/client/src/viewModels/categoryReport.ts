import type {
    AccountResponse,
    CategoryBranchResponse,
    CategoryReportLineResponse,
    CategoryReportResponse,
    CategoryReportRowResponse,
    CategoryTransactionsResponse,
    CreditCardResponse,
    SubCategoryReportRowResponse,
    TagResponse,
    TransactionResponse,
} from '@finance/core';
import { YearMonth } from '@finance/core';
import { formatMonthShort } from '../format/dates.ts';
import { formatMoney } from '../format/money.ts';
import { formatVariation, type VariationView } from '../format/variation.ts';
import { buildTransactionTable, NO_TRANSACTION_FILTERS, type TransactionDirection } from './transactionTable.ts';

/** Modo de comparação, como o núcleo o recebe. */
export type ComparisonMode = CategoryReportResponse['comparison']['mode'];

/**
 * Nível aberto no drill-down "Todas as categorias › Alimentação › Restaurantes". É o que a tela
 * guarda (na URL, no desktop); os nomes e os números saem do relatório em
 * `resolveCategorySelection`.
 */
export type CategorySelection =
    | { readonly kind: 'all' }
    | { readonly kind: 'category'; readonly categoryId: string }
    | { readonly kind: 'subCategory'; readonly subCategoryId: string };

/** A raiz do drill-down: nenhuma categoria aberta. */
export const ALL_CATEGORIES: CategorySelection = { kind: 'all' };

/** O nível aberto, com as linhas do relatório que ele aponta. */
export type ResolvedCategorySelection =
    | { readonly kind: 'all' }
    | { readonly kind: 'category'; readonly category: CategoryReportRowResponse }
    | { readonly kind: 'subCategory'; readonly category: CategoryReportRowResponse; readonly subCategory: SubCategoryReportRowResponse };

/** Os números de uma linha, formatados. */
export interface CategoryReportCells {
    /** Gasto do período: em módulo nos positivos, com `−` quando os estornos superam as compras. */
    readonly amount: string;
    readonly comparison: string;
    readonly variation: VariationView;
}

/** Uma linha visível da árvore. */
export type CategoryReportRow = CategoryReportCells & {
    /** Nível que a linha abre no drill-down. */
    readonly target: CategorySelection;
    /** É o nível aberto: a tela destaca a linha. */
    readonly selected: boolean;
} & (
    | { readonly kind: 'category'; readonly id: string; readonly name: string; readonly expanded: boolean; readonly hasChildren: boolean }
    | { readonly kind: 'subCategory'; readonly id: string; readonly categoryId: string; readonly name: string }
);

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
    /**
     * Nenhuma categoria com gasto no período, mas alguma com gasto na comparação: as linhas
     * existem só pela comparação (ou por estornos, que não são despesa), e a tela avisa para que
     * os zeros e os negativos não pareçam erro.
     */
    readonly periodWithoutExpenses: boolean;
}

/**
 * Achata a árvore do relatório nas linhas da tabela expansível (mockup DesktopRelCategoria):
 * categoria, e logo abaixo as subcategorias das categorias abertas. A abertura e o nível do
 * drill-down são estado da tela, recebidos aqui, para que o view-model continue uma função pura.
 *
 * @param report Relatório do núcleo.
 * @param expanded Categorias abertas na tabela.
 * @param selection Nível aberto no drill-down; a linha dele vem marcada como selecionada.
 * @return Rótulos das colunas, linhas visíveis e total.
 */
export function buildCategoryReport(report: CategoryReportResponse, expanded: ReadonlySet<string>, selection: CategorySelection = ALL_CATEGORIES): CategoryReportView {
    return {
        periodLabel: formatMonthShort(report.period),
        comparisonLabel: comparisonColumnLabel(report.comparison.mode, report.comparison.periods),
        rows: report.categories.flatMap((category): CategoryReportRow[] => {
            const isOpen = expanded.has(category.categoryId);
            return [
                {
                    kind: 'category',
                    id: category.categoryId,
                    name: category.name,
                    expanded: isOpen,
                    hasChildren: category.subCategories.length > 0,
                    target: { kind: 'category', categoryId: category.categoryId },
                    selected: selection.kind === 'category' && selection.categoryId === category.categoryId,
                    ...cellsOf(category),
                },
                ...(isOpen
                    ? category.subCategories.map((sub): CategoryReportRow => ({
                          kind: 'subCategory',
                          id: sub.subCategoryId,
                          categoryId: category.categoryId,
                          name: sub.name,
                          target: { kind: 'subCategory', subCategoryId: sub.subCategoryId },
                          selected: selection.kind === 'subCategory' && selection.subCategoryId === sub.subCategoryId,
                          ...cellsOf(sub),
                      }))
                    : []),
            ];
        }),
        total: cellsOf(report.total),
        empty: report.categories.length === 0,
        // O estorno deixa a categoria negativa sem que tenha havido despesa: conta como "sem gasto".
        periodWithoutExpenses: report.categories.length > 0 && report.categories.every((category) => category.amount.amount <= 0),
    };
}

/**
 * Procura no relatório o nível guardado pela tela. O id pode não estar lá — a categoria sem
 * gasto no mês novo nem na comparação some do relatório —, e então o drill-down volta à raiz em
 * vez de mostrar uma trilha e um gráfico sem nome.
 *
 * @param report Relatório do núcleo.
 * @param selection Nível guardado pela tela.
 * @return O nível com as linhas do relatório; a raiz quando o id não está no relatório.
 */
export function resolveCategorySelection(report: CategoryReportResponse, selection: CategorySelection): ResolvedCategorySelection {
    if (selection.kind === 'all') {
        return { kind: 'all' };
    }
    for (const category of report.categories) {
        if (selection.kind === 'category' && category.categoryId === selection.categoryId) {
            return { kind: 'category', category };
        }
        const subCategory = selection.kind === 'subCategory' ? category.subCategories.find((sub) => sub.subCategoryId === selection.subCategoryId) : undefined;
        if (subCategory !== undefined) {
            return { kind: 'subCategory', category, subCategory };
        }
    }
    return { kind: 'all' };
}

/**
 * @param resolved Nível aberto, já resolvido.
 * @return A categoria cujas subcategorias a tabela e o gráfico mostram abertas: a selecionada,
 * ou a dona da subcategoria selecionada; `null` na raiz.
 */
export function openCategoryId(resolved: ResolvedCategorySelection): string | null {
    return resolved.kind === 'all' ? null : resolved.category.categoryId;
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

/** Uma barra do gráfico (período × comparação), uma por linha do nível mostrado. */
export interface CategoryChartBar {
    /** Nível que o clique na barra abre. */
    readonly target: CategorySelection;
    readonly name: string;
    /** Valores com sinal, para o eixo: o estorno maior que as compras desenha a barra negativa. */
    readonly amount: number;
    readonly comparison: number;
    readonly amountText: string;
    readonly comparisonText: string;
    /** É a subcategoria selecionada: a tela destaca o nome. */
    readonly selected: boolean;
}

/** O gráfico do nível aberto. */
export interface CategoryChartView {
    /** `Despesas por categoria` na raiz; `Alimentação por subcategoria` abaixo dela. */
    readonly title: string;
    readonly bars: readonly CategoryChartBar[];
    /** A instrução embaixo do gráfico: o que o clique numa barra faz neste nível. */
    readonly hint: string;
    /** Alguma barra é negativa: o eixo precisa de espaço à esquerda do zero. */
    readonly hasNegative: boolean;
}

/**
 * Gráfico de barras agrupadas do nível aberto. Na raiz, as categorias, e o clique abre a
 * categoria; numa categoria, as subcategorias, e o clique desce até a subcategoria; numa
 * subcategoria, as irmãs dela, com a selecionada em destaque — o último nível não tem para onde
 * descer, e as irmãs são a comparação que interessa.
 *
 * @param resolved Nível aberto, já resolvido contra o relatório.
 * @param report Relatório do núcleo; na raiz, fornece as categorias.
 * @return Título, barras e a instrução do clique.
 */
export function categoryChart(resolved: ResolvedCategorySelection, report: CategoryReportResponse): CategoryChartView {
    const hover = 'Passe o mouse sobre uma barra para ver o valor';
    if (resolved.kind === 'all') {
        const bars = report.categories.map((category) => barOf(category, category.name, { kind: 'category', categoryId: category.categoryId }, false));
        return { title: 'Despesas por categoria', bars, hint: `${hover}; clique para descer um nível.`, hasNegative: bars.some(isNegative) };
    }
    const selectedId = resolved.kind === 'subCategory' ? resolved.subCategory.subCategoryId : null;
    const bars = resolved.category.subCategories.map((sub) => barOf(sub, sub.name, { kind: 'subCategory', subCategoryId: sub.subCategoryId }, sub.subCategoryId === selectedId));
    return {
        title: `${resolved.category.name} por subcategoria`,
        bars,
        hint: resolved.kind === 'category' ? `${hover}; clique para descer um nível.` : `${hover}; clique para trocar de subcategoria.`,
        hasNegative: bars.some(isNegative),
    };
}

/**
 * @param line Números da linha.
 * @param name Nome mostrado no eixo.
 * @param target Nível que a barra abre.
 * @param selected Se é a subcategoria selecionada.
 * @return A barra.
 */
function barOf(line: CategoryReportLineResponse, name: string, target: CategorySelection, selected: boolean): CategoryChartBar {
    return {
        target,
        name,
        amount: line.amount.amount,
        comparison: line.comparison.amount,
        amountText: formatMoney(line.amount),
        comparisonText: formatMoney(line.comparison),
        selected,
    };
}

/**
 * @param bar Barra do gráfico.
 * @return `true` quando o período ou a comparação ficou negativo (só estorno).
 */
function isNegative(bar: CategoryChartBar): boolean {
    return bar.amount < 0 || bar.comparison < 0;
}

/** Um nível da trilha "Todas as categorias › Alimentação › Restaurantes". */
export interface BreadcrumbItem {
    readonly label: string;
    readonly target: CategorySelection;
}

/**
 * @param resolved Nível aberto, já resolvido contra o relatório — o id que sumiu do relatório
 * já virou a raiz, então a trilha nunca mostra nome vazio.
 * @return A trilha da raiz até o nível aberto; o último item é o atual.
 */
export function categoryBreadcrumb(resolved: ResolvedCategorySelection): readonly BreadcrumbItem[] {
    const root: BreadcrumbItem = { label: 'Todas as categorias', target: ALL_CATEGORIES };
    if (resolved.kind === 'all') {
        return [root];
    }
    const category: BreadcrumbItem = { label: resolved.category.name, target: { kind: 'category', categoryId: resolved.category.categoryId } };
    if (resolved.kind === 'category') {
        return [root, category];
    }
    return [root, category, { label: resolved.subCategory.name, target: { kind: 'subCategory', subCategoryId: resolved.subCategory.subCategoryId } }];
}

/** Os cadastros que dão nome às colunas da lista do drill-down. */
export interface CategoryTransactionsSource {
    readonly profileId: string;
    /** Todas as contas do perfil, desativadas incluídas: o relatório conta o gasto delas (R4). */
    readonly accounts: readonly Pick<AccountResponse, 'id' | 'name'>[];
    /** Cartões do perfil; a conta pagadora é exigida pela linha de Transações que a lista reaproveita. */
    readonly creditCards: readonly Pick<CreditCardResponse, 'id' | 'name' | 'accountId'>[];
    readonly categories: readonly CategoryBranchResponse[];
    readonly tags: readonly Pick<TagResponse, 'id' | 'name'>[];
}

/** Uma linha da lista de lançamentos do drill-down. */
export interface CategoryTransactionRow {
    readonly id: string;
    readonly transaction: TransactionResponse;
    /** `03/10`: o vencimento, a mesma data que a tela de Transações mostra. */
    readonly date: string;
    readonly name: string;
    /** `Alimentação › Mercado`: na lista de uma categoria inteira, diz de qual subcategoria é. */
    readonly category: string;
    /** `Nubank` ou `Roxinho · fat. nov`. */
    readonly container: string;
    /** Nomes das tags, na ordem do lançamento. */
    readonly tags: readonly string[];
    /** `−R$ 64,90`; o estorno sai com `+`. */
    readonly amountText: string;
    readonly direction: TransactionDirection;
}

/** A lista do drill-down pronta para a tela. */
export interface CategoryTransactionList {
    readonly rows: readonly CategoryTransactionRow[];
    /** `−R$ 512,18`: o gasto da linha do relatório, com o sinal de saída das linhas da lista. */
    readonly totalText: string;
}

/**
 * Lista de lançamentos do drill-down (mockup DesktopRelCategoria, "Lançamentos em
 * Restaurantes"). Reaproveita a linha da tabela de Transações para que a data, a coluna
 * "Conta / fatura" e o valor saiam iguais nas duas telas.
 * Regra de negócio (Relatórios, R1): a lista vem da rota `reports.categoryTransactions`, pelo
 * mês do pagamento, e não do `transactions.listByPeriod` — a compra de setembro numa fatura paga
 * em outubro está aqui em outubro (desktop-mvp-plan §3.1). O total é o do núcleo, o mesmo valor
 * da linha do relatório, e não uma soma refeita na tela.
 *
 * @param response Lançamentos e total do drill-down.
 * @param source Cadastros para os nomes de conta, cartão, subcategoria e tag.
 * @return As linhas ordenadas por data e nome, e o total.
 */
export function buildCategoryTransactionList(response: CategoryTransactionsResponse, source: CategoryTransactionsSource): CategoryTransactionList {
    // A situação não aparece nesta lista, então as faturas não são necessárias.
    const table = buildTransactionTable({ ...source, transactions: response.transactions, invoices: [] }, NO_TRANSACTION_FILTERS);
    const tagNames = new Map(source.tags.map((tag) => [tag.id, tag.name]));
    return {
        // Sem as faturas do mês, a tabela nunca agrupa: toda linha é um lançamento.
        rows: table.rows.flatMap((row) => (row.kind !== 'transaction' ? [] : [{
            id: row.id,
            transaction: row.transaction,
            date: row.date,
            name: row.name,
            category: row.category,
            container: row.container,
            tags: row.transaction.tagIds.flatMap((id) => {
                const name = tagNames.get(id);
                return name === undefined ? [] : [name];
            }),
            amountText: row.amountText,
            direction: row.direction,
        }])),
        // `0 - x`, e não `-x`: o total zerado continua `+0` e não sai como `−R$ 0,00`.
        totalText: formatMoney({ amount: 0 - response.total.amount, currency: response.total.currency }, 'always'),
    };
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
