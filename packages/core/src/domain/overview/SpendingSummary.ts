import type { MonthAmount } from '../report/ReportTotals.ts';
import type { Currency } from '../shared/Currency.ts';
import type { CategoryId } from '../shared/ids.ts';
import { Money } from '../shared/Money.ts';
import type { YearMonth } from '../shared/YearMonth.ts';

/**
 * Quantos meses o gráfico "Gastos por mês" da Visão geral mostra, terminando no mês de referência
 * (mockup `DesktopVisaoGeral2`). Também é a janela da média com que o indicador de gastos compara o mês.
 */
export const SPENDING_MONTHS = 6;

/**
 * Quantas categorias "Para onde foi no mês" mostra pelo nome; as demais viram "outras", para que
 * o bloco tenha a altura do gráfico ao lado em qualquer perfil.
 */
export const TOP_CATEGORIES = 5;

/** Quanto uma categoria somou de despesas no mês. */
export interface CategorySpending {
    readonly categoryId: CategoryId;
    /** Nome da categoria; o da linha excluída, quando a categoria foi excluída e o gasto ficou. */
    readonly name: string;
    readonly amount: Money;
}

/** As categorias que não entraram entre as maiores, juntas. */
export interface OtherCategories {
    readonly count: number;
    readonly amount: Money;
}

/** O resumo de gastos da Visão geral. */
export interface SpendingSummary {
    readonly period: YearMonth;
    /** Despesas de cada um dos `SPENDING_MONTHS` meses, do mais antigo ao de referência; mês sem gasto vem com zero. */
    readonly months: readonly MonthAmount[];
    /** Média dos meses da janela desde o primeiro com gasto; `null` quando nenhum mês da janela teve gasto. */
    readonly average: Money | null;
    /** Despesas do mês de referência. */
    readonly expenses: Money;
    /** Entradas do mês de referência: receitas e transferências vindas de outro perfil. */
    readonly income: Money;
    /** As maiores categorias do mês, da maior para a menor. */
    readonly categories: readonly CategorySpending[];
    readonly others: OtherCategories;
}

/** O que o resumo recebe do banco. */
export interface SpendingSummaryInput {
    readonly period: YearMonth;
    /** Despesas por mês; o mês sem gasto pode faltar. */
    readonly expensesByMonth: readonly MonthAmount[];
    readonly income: Money;
    /** Despesas do mês de referência por categoria, em qualquer ordem. */
    readonly categories: readonly CategorySpending[];
    readonly currency: Currency;
}

/**
 * Os meses da janela do gráfico, do mais antigo ao de referência. Num lugar só porque o
 * Repository consulta exatamente a janela que o resumo completa com zeros.
 *
 * @param period Mês de referência, o último da janela.
 * @return Os `SPENDING_MONTHS` meses, em ordem cronológica.
 */
export function spendingWindow(period: YearMonth): readonly YearMonth[] {
    return Array.from({ length: SPENDING_MONTHS }, (_, index) => period.plusMonths(index - SPENDING_MONTHS + 1));
}

/**
 * Monta o resumo de gastos da Visão geral: a série de seis meses, a média e as maiores categorias.
 * Regra de negócio (Visão geral): a média é a dos meses do gráfico, como a linha tracejada do
 * mockup, mas começa no primeiro mês com gasto da janela — num perfil que começou a usar o app há
 * dois meses, os meses vazios de antes puxariam a média para baixo e todo mês pareceria "acima da
 * média". A categoria zerada ou negativa (estornos maiores que as compras) fica fora: não tem
 * tamanho de barra nem participação nos gastos.
 *
 * @param input Somas lidas do banco.
 * @return O resumo pronto.
 */
export function buildSpendingSummary(input: SpendingSummaryInput): SpendingSummary {
    const zero = Money.zero(input.currency);
    const months = spendingWindow(input.period).map((period) => ({
        period,
        amount: input.expensesByMonth.find((month) => month.period.equals(period))?.amount ?? zero,
    }));
    const firstWithSpending = months.findIndex((month) => !month.amount.isZero());
    const averaged = firstWithSpending < 0 ? [] : months.slice(firstWithSpending);
    const ranked = input.categories
        .filter((category) => !category.amount.isZero() && !category.amount.isNegative())
        .sort((a, b) => b.amount.amount - a.amount.amount || a.name.localeCompare(b.name, 'pt-BR'));
    const rest = ranked.slice(TOP_CATEGORIES);
    return {
        period: input.period,
        months,
        average: averaged.length === 0 ? null : averaged.reduce((total, month) => total.add(month.amount), zero).times(1 / averaged.length),
        expenses: months[months.length - 1]?.amount ?? zero,
        income: input.income,
        categories: ranked.slice(0, TOP_CATEGORIES),
        others: { count: rest.length, amount: rest.reduce((total, category) => total.add(category.amount), zero) },
    };
}
