import type { CategoryId, TagId } from '../shared/ids.ts';
import type { Money } from '../shared/Money.ts';
import { YearMonth } from '../shared/YearMonth.ts';
import { sumMoney } from './Comparison.ts';
import { expenseOutflow, incomeInflow, type TagCategoryTotals } from './ReportTotals.ts';
import { shareOf } from './Variation.ts';

/**
 * Período do relatório por tag: só o mês de referência ou todo o histórico da tag.
 * Regra de negócio (Relatórios, T1): "Todo o período" inclui o futuro — parcelas e lançamentos
 * em aberto, cada um no mês em que vai pesar (desktop-mvp-plan §3.5).
 */
export const TAG_REPORT_RANGES = ['all', 'month'] as const;

/** Um dos períodos de `TAG_REPORT_RANGES`. */
export type TagReportRange = (typeof TAG_REPORT_RANGES)[number];

/**
 * Despesas e receitas de um recorte (a tag inteira ou uma categoria dela), já pelo efeito no
 * saldo, e o líquido. Guarda as duas partes, e não só o líquido, porque a tela explica o total
 * ("despesas − receitas") e um líquido sozinho esconde um reembolso que zerou o gasto.
 */
export interface TagAmounts {
    /** Despesas líquidas de estornos, com encargos: positivo quando saiu dinheiro. */
    readonly expense: Money;
    /** Receitas líquidas das próprias tarifas: positivo quando entrou dinheiro. */
    readonly income: Money;
    /** Despesas − receitas: positivo é gasto líquido; negativo, entrada líquida. */
    readonly net: Money;
    readonly count: number;
}

/** Uma categoria dentro da tag. */
export interface TagCategoryLine extends TagAmounts {
    readonly categoryId: CategoryId;
    readonly name: string;
    /** Parte do gasto líquido da tag; `null` quando a categoria não tem gasto líquido (T4). */
    readonly share: number | null;
}

/** Uma tag com o total líquido do período e a divisão por categoria. */
export interface TagSummary extends TagAmounts {
    readonly tagId: TagId;
    readonly name: string;
    /** Primeiro e último mês de pagamento com lançamento da tag no período. */
    readonly firstPeriod: YearMonth;
    readonly lastPeriod: YearMonth;
    /** Pelo líquido, maior primeiro. */
    readonly categories: readonly TagCategoryLine[];
}

/** O relatório por tag de um mês de referência. */
export interface TagReport {
    readonly reference: YearMonth;
    readonly range: TagReportRange;
    /** Só as tags com lançamento no período, pelo líquido, maior primeiro (T3). */
    readonly tags: readonly TagSummary[];
}

/**
 * Monta o relatório por tag a partir das somas por tag, categoria e tipo que o SQL agregou.
 * Regra de negócio (Relatórios, T2): o total de uma tag é **despesas menos receitas** — o
 * reembolso marcado com a tag abate o gasto —, cada lado pelo efeito no saldo (R3: valor +
 * encargos na despesa, valor − tarifa na receita), com estorno abatendo o próprio lado.
 * Transferências e investimentos nem chegam aqui (desktop-mvp-plan §3.5).
 *
 * @param reference Mês de referência.
 * @param range Período pedido.
 * @param rows Somas por tag, categoria e tipo no período.
 * @param zero Zero na moeda do perfil.
 * @return As tags com lançamento no período, cada uma com a divisão por categoria.
 */
export function buildTagReport(reference: YearMonth, range: TagReportRange, rows: readonly TagCategoryTotals[], zero: Money): TagReport {
    const byTag = new Map<TagId, TagCategoryTotals[]>();
    for (const row of rows) {
        byTag.set(row.tagId, [...(byTag.get(row.tagId) ?? []), row]);
    }
    const tags = [...byTag.values()].flatMap((tagRows) => {
        const first = tagRows[0];
        return first === undefined ? [] : [tagSummaryOf(first, tagRows, zero)];
    });
    return { reference, range, tags: tags.sort(byLargestNet) };
}

/**
 * @param first Uma linha da tag, de onde saem o id e o nome.
 * @param rows Todas as linhas da tag.
 * @param zero Zero na moeda do perfil.
 * @return A tag com os totais, o intervalo de meses e as categorias.
 */
function tagSummaryOf(first: TagCategoryTotals, rows: readonly TagCategoryTotals[], zero: Money): TagSummary {
    const byCategory = new Map<CategoryId, TagCategoryTotals[]>();
    for (const row of rows) {
        byCategory.set(row.categoryId, [...(byCategory.get(row.categoryId) ?? []), row]);
    }
    const categories = [...byCategory.values()].flatMap((categoryRows) => {
        const head = categoryRows[0];
        return head === undefined ? [] : [{ categoryId: head.categoryId, name: head.categoryName, ...amountsOf(categoryRows, zero) }];
    });
    // Regra de negócio (Relatórios, T4): a participação é sobre a soma das categorias com gasto
    // líquido; a categoria em que as receitas superam as despesas fica sem participação, porque
    // uma fatia negativa de um todo não significa nada para quem lê.
    const spent = sumMoney(categories.filter(hasNetSpending).map((category) => category.net), zero);
    return {
        tagId: first.tagId,
        name: first.tagName,
        ...amountsOf(rows, zero),
        firstPeriod: rows.map((row) => row.firstPeriod).reduce((a, b) => YearMonth.min(a, b)),
        lastPeriod: rows.map((row) => row.lastPeriod).reduce((a, b) => (a.isBefore(b) ? b : a)),
        categories: categories
            .map((category) => ({ ...category, share: hasNetSpending(category) ? shareOf(category.net, spent) : null }))
            .sort(byLargestNet),
    };
}

/**
 * @param rows Somas por tipo de um recorte.
 * @param zero Zero na moeda do perfil.
 * @return Despesas, receitas, líquido e o número de lançamentos do recorte.
 */
function amountsOf(rows: readonly TagCategoryTotals[], zero: Money): TagAmounts {
    const expense = sumMoney(rows.filter((row) => row.type === 'expense').map((row) => expenseOutflow(row.value, row.charges)), zero);
    const income = sumMoney(rows.filter((row) => row.type === 'income').map((row) => incomeInflow(row.value, row.charges)), zero);
    return { expense, income, net: expense.subtract(income), count: rows.reduce((total, row) => total + row.count, 0) };
}

/**
 * Compara arredondado para que um resíduo de ponto flutuante não conte como gasto.
 *
 * @param amounts Recorte.
 * @return `true` quando o líquido é gasto (positivo).
 */
function hasNetSpending(amounts: TagAmounts): boolean {
    return amounts.net.rounded().amount > 0;
}

/**
 * Ordem da tela: maior líquido primeiro, desempate pelo nome, para que a ordem seja estável
 * entre aberturas. Compara os valores arredondados, como o relatório por categoria, para que um
 * ruído de ponto flutuante não decida a ordem de dois valores que a tela mostra iguais.
 *
 * @param a Primeira linha.
 * @param b Segunda linha.
 * @return Negativo quando `a` vem antes.
 */
function byLargestNet(a: TagAmounts & { readonly name: string }, b: TagAmounts & { readonly name: string }): number {
    const net = b.net.rounded().amount - a.net.rounded().amount;
    if (net !== 0) {
        return net;
    }
    const nameA = a.name.toLowerCase();
    const nameB = b.name.toLowerCase();
    return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
}
