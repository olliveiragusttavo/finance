import { Currency, Money, type MoneyResponse, type TagCategoryResponse, type TagReportRange, type TagReportResponse, type TagSummaryResponse, type TagTransactionsResponse } from '@finance/core';
import { formatDate, formatMonthShort } from '../format/dates.ts';
import { formatMoney } from '../format/money.ts';
import { formatPercent } from '../format/percent.ts';
import { buildCategoryTransactionList, type CategoryTransactionList, type CategoryTransactionsSource } from './categoryReport.ts';

/** Um item da lista de tags. */
export interface TagListItem {
    readonly tagId: string;
    readonly name: string;
    /** `8 lançamentos · 3 categorias`. */
    readonly detail: string;
    /** `R$ 1.400,00` no gasto líquido; `+R$ 342,60` quando as receitas superam as despesas. */
    readonly amount: string;
}

/** Um indicador do topo da tag. */
export interface TagKpi {
    readonly label: string;
    readonly value: string;
    readonly sub: string;
}

/** Uma linha da tabela por categoria. */
export interface TagCategoryRow {
    readonly categoryId: string;
    readonly name: string;
    /** Como o valor da lista de tags: sem sinal no gasto, `+` na entrada líquida. */
    readonly amount: string;
    /** `44%`, ou `—` na categoria sem gasto líquido (T4). */
    readonly percent: string;
    /** Participação para a barra, 0–1; `null` sem gasto líquido. */
    readonly share: number | null;
    /** Valor do gráfico: o gasto líquido em positivo, a entrada líquida em negativo. */
    readonly chartAmount: number;
}

/** O detalhe de uma tag pronto para a tela. */
export interface TagDetailView {
    readonly tagId: string;
    readonly name: string;
    readonly kpis: { readonly total: TagKpi; readonly count: TagKpi; readonly categories: TagKpi };
    readonly categories: readonly TagCategoryRow[];
    /** Linha de total da tabela por categoria. */
    readonly total: { readonly amount: string; readonly percent: string };
    /** Alguma categoria em que as receitas superam as despesas: o gráfico precisa do eixo no zero. */
    readonly hasNegative: boolean;
}

/** Sem participação: a categoria não tem gasto líquido (T4). */
const NO_SHARE = '—';

/** Quantas categorias o indicador nomeia antes de resumir o resto. */
const NAMED_CATEGORIES = 3;

/**
 * Itens da lista de tags (mockup DesktopRelTag). A ordem e os totais vêm prontos do núcleo
 * (T3); aqui só os textos.
 *
 * @param report Relatório do núcleo.
 * @return Os itens, na ordem do núcleo.
 */
export function buildTagList(report: TagReportResponse): readonly TagListItem[] {
    return report.tags.map((tag) => ({
        tagId: tag.tagId,
        name: tag.name,
        detail: `${countLabel(tag.count, 'lançamento', 'lançamentos')} · ${countLabel(tag.categories.length, 'categoria', 'categorias')}`,
        amount: netText(tag.net),
    }));
}

/**
 * Tag cujo detalhe a tela mostra. A da URL pode não ter lançamento no período escolhido — o
 * período mudou, ou a tag foi excluída —, e então vale a primeira, como em Metas.
 *
 * @param report Relatório do núcleo.
 * @param tagId Tag pedida pela URL.
 * @return A tag pedida, a primeira da lista, ou `null` quando nenhuma tem lançamento.
 */
export function openTag(report: TagReportResponse, tagId: string | undefined): TagSummaryResponse | null {
    return report.tags.find((tag) => tag.tagId === tagId) ?? report.tags[0] ?? null;
}

/**
 * Monta o detalhe de uma tag: indicadores e tabela por categoria.
 * Regra de negócio (Relatórios, T2): o total é **despesas menos receitas**. Sem receita ele é o
 * "Total gasto" do mockup; com receita vira "Total líquido" e diz de onde vem, para que um
 * reembolso não esconda o gasto (desktop-mvp-plan §3.5).
 *
 * @param tag Tag aberta, do relatório do núcleo.
 * @param range Período do relatório, que decide o texto do intervalo.
 * @param containers Contas e cartões dos lançamentos da tag, quando a lista já chegou; `null`
 * enquanto carrega, e o indicador fica sem a explicação.
 * @return Indicadores, linhas por categoria e total.
 */
export function buildTagDetail(tag: TagSummaryResponse, range: TagReportRange, containers: TagContainers | null): TagDetailView {
    const hasIncome = !isZero(tag.income);
    const spends = tag.categories.some((category) => category.share !== null);
    return {
        tagId: tag.tagId,
        name: tag.name,
        kpis: {
            total: {
                label: hasIncome ? 'Total líquido' : 'Total gasto',
                value: netText(tag.net),
                sub: hasIncome ? `${formatMoney(tag.expense, 'absolute')} em despesas − ${formatMoney(tag.income, 'absolute')} em receitas` : intervalText(tag, range),
            },
            count: { label: 'Lançamentos', value: String(tag.count), sub: containers === null ? '' : containersText(containers) },
            categories: { label: 'Categorias envolvidas', value: String(tag.categories.length), sub: categoryNames(tag.categories) },
        },
        categories: tag.categories.map((category) => ({
            categoryId: category.categoryId,
            name: category.name,
            amount: netText(category.net),
            percent: category.share === null ? NO_SHARE : formatPercent(category.share, { sign: 'negative', decimals: 0 }),
            share: category.share,
            chartAmount: category.net.amount,
        })),
        total: { amount: netText(tag.net), percent: spends ? '100%' : NO_SHARE },
        hasNegative: tag.categories.some((category) => category.net.amount < 0),
    };
}

/** Quantas contas e quantos cartões distintos os lançamentos da tag usam. */
export interface TagContainers {
    readonly accounts: number;
    readonly creditCards: number;
}

/**
 * @param response Lançamentos da tag.
 * @return As contas e os cartões distintos em que estão — a explicação do indicador de lançamentos.
 */
export function tagContainers(response: TagTransactionsResponse): TagContainers {
    const accounts = new Set<string>();
    const creditCards = new Set<string>();
    for (const { container } of response.transactions) {
        if (container.kind === 'statement') {
            accounts.add(container.accountId);
        } else {
            creditCards.add(container.creditCardId);
        }
    }
    return { accounts: accounts.size, creditCards: creditCards.size };
}

/**
 * Lista de lançamentos da tag, com a linha de Transações, como a do relatório por categoria.
 * Regra de negócio (Relatórios, T5): o total é o do núcleo, o mesmo total líquido da tag. Em
 * "Todo o período" a lista atravessa meses e anos, e a data leva o ano; no mês, fica `dd/mm`, como
 * nas outras tabelas.
 *
 * @param response Lançamentos e total da tag.
 * @param range Período do relatório.
 * @param source Cadastros para os nomes de conta, cartão, categoria e tag.
 * @return As linhas e o total.
 */
export function buildTagTransactionList(response: TagTransactionsResponse, range: TagReportRange, source: CategoryTransactionsSource): CategoryTransactionList {
    const list = buildCategoryTransactionList(response, source);
    return range === 'all' ? { ...list, rows: list.rows.map((row) => ({ ...row, date: formatDate(row.transaction.dueDate) })) } : list;
}

/**
 * O líquido como a tela o lê: o gasto sem sinal (é o "Total gasto" do mockup) e a entrada
 * líquida com `+`, para que as duas não se confundam sem depender da cor (decisão de interface 7).
 *
 * @param net Despesas − receitas.
 * @return O texto do valor.
 */
function netText(net: MoneyResponse): string {
    return net.amount < 0 && !isZero(net) ? formatMoney({ amount: 0 - net.amount, currency: net.currency }, 'always') : formatMoney(net, 'absolute');
}

/**
 * @param money Valor do núcleo.
 * @return `true` quando a tela o mostraria como zero.
 */
function isZero(money: MoneyResponse): boolean {
    return Money.of(money.amount, Currency.of(money.currency)).rounded().isZero();
}

/**
 * @param tag Tag aberta.
 * @param range Período do relatório.
 * @return `out/2026` no mês ou num período de um mês só; `set/2026 a dez/2026` quando atravessa meses.
 */
function intervalText(tag: TagSummaryResponse, range: TagReportRange): string {
    if (range === 'month' || tag.firstPeriod === tag.lastPeriod) {
        return formatMonthShort(tag.firstPeriod);
    }
    return `${formatMonthShort(tag.firstPeriod)} a ${formatMonthShort(tag.lastPeriod)}`;
}

/**
 * @param containers Contas e cartões distintos.
 * @return `em 2 contas e 1 cartão`, `em 1 conta` ou `em 3 cartões`.
 */
function containersText(containers: TagContainers): string {
    const parts = [
        containers.accounts > 0 ? countLabel(containers.accounts, 'conta', 'contas') : null,
        containers.creditCards > 0 ? countLabel(containers.creditCards, 'cartão', 'cartões') : null,
    ].filter((part) => part !== null);
    return parts.length === 0 ? '' : `em ${parts.join(' e ')}`;
}

/**
 * @param categories Categorias da tag, na ordem do núcleo.
 * @return `Transporte, Compras, Alimentação`, e `e mais 2` quando passa de três.
 */
function categoryNames(categories: readonly TagCategoryResponse[]): string {
    const named = categories.slice(0, NAMED_CATEGORIES).map((category) => category.name).join(', ');
    const rest = categories.length - NAMED_CATEGORIES;
    return rest > 0 ? `${named} e mais ${String(rest)}` : named;
}

/**
 * @param count Quantidade.
 * @param singular Palavra no singular.
 * @param plural Palavra no plural.
 * @return `1 lançamento` ou `8 lançamentos`.
 */
function countLabel(count: number, singular: string, plural: string): string {
    return `${String(count)} ${count === 1 ? singular : plural}`;
}
