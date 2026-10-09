import type {
    AccountInPeriodResponse,
    AccountListResponse,
    BalanceEvolutionResponse,
    CategoryReportResponse,
    CreditCardInPeriodResponse,
    CreditCardListResponse,
    MoneyResponse,
    MonthSummaryResponse,
} from '@finance/core';
import { formatAccountType } from '../format/account.ts';
import { formatDayMonth, formatMonthAbbreviation, formatMonthShort } from '../format/dates.ts';
import { formatMoney } from '../format/money.ts';
import { formatPercent } from '../format/percent.ts';
import { formatInvoiceAmount } from './invoiceView.ts';

/*
 * Visão geral pronta para a tela (mockup `Main`, D2; e o `MobileInicio` do celular;
 * desktop-mvp-plan Fase 10): os cinco indicadores, a evolução do saldo, as maiores categorias
 * e os resumos de contas e cartões. Fica no `client`, e não na tela, porque o celular mostra
 * os mesmos números com as mesmas frases (desktop-shell-design §4.2).
 */

/**
 * Tom do valor de um indicador, que a tela converte em token:
 * - `strong`: o número principal (consolidado, faturas);
 * - `projected`: o previsto, com peso menor (decisão de interface 6 dos mockups);
 * - `in` e `out`: entrada e saída, que também levam sinal (decisão de interface 7).
 */
export type OverviewKpiTone = 'strong' | 'projected' | 'in' | 'out';

/** Um indicador do topo da Visão geral. */
export interface OverviewKpi {
    readonly label: string;
    readonly value: string;
    readonly sub: string;
    readonly tone: OverviewKpiTone;
}

/** Os cinco indicadores, na ordem do mockup. */
export interface OverviewKpis {
    readonly consolidated: OverviewKpi;
    readonly projected: OverviewKpi;
    readonly income: OverviewKpi;
    readonly expenses: OverviewKpi;
    readonly openInvoices: OverviewKpi;
}

/**
 * @param count Quantidade.
 * @param singular Palavra no singular.
 * @param pluralForm Palavra no plural.
 * @return `1 conta`, `3 contas`.
 */
function plural(count: number, singular: string, pluralForm: string): string {
    return `${String(count)} ${count === 1 ? singular : pluralForm}`;
}

/**
 * @param money Valor como veio do núcleo.
 * @return O valor com o sinal trocado; `0 - x` em vez de `-x` para o zero nunca virar `-0`.
 */
function negate(money: MoneyResponse): MoneyResponse {
    return { amount: 0 - money.amount, currency: money.currency };
}

/**
 * Monta os cinco indicadores do mockup. O consolidado e o previsto vêm do total da lista de
 * contas, e não da evolução do saldo, porque é o mesmo número do rodapé da tela Contas: as duas
 * telas nunca podem discordar sobre o saldo do mês.
 * Regra de negócio (Contas): o total soma só as contas com "considerar no saldo", e a contagem
 * do subtítulo conta as mesmas (database-design §4.4).
 * Regra de negócio (Relatórios): receitas e despesas são as do mês do pagamento, a mesma fonte
 * do relatório por categoria; a variação das despesas é contra o mês anterior, com "novo" na
 * base zero (R6), aqui dito por extenso porque "novo" solto num subtítulo não se explica
 * (reports-design §5).
 *
 * @param accounts Contas do perfil no mês de referência, com o total.
 * @param summary Indicadores do mês do núcleo (`reports.monthSummary`).
 * @return Os indicadores formatados.
 */
export function overviewKpis(accounts: AccountListResponse, summary: MonthSummaryResponse): OverviewKpis {
    const counted = accounts.accounts.filter((account) => account.considerBalance).length;
    return {
        consolidated: {
            label: 'Saldo consolidado',
            value: formatMoney(accounts.total.consolidated),
            sub: `Já pago/recebido · ${plural(counted, 'conta', 'contas')}`,
            tone: 'strong',
        },
        projected: {
            label: 'Saldo previsto',
            value: formatMoney(accounts.total.projected),
            sub: 'Fim do mês, com tudo lançado',
            tone: 'projected',
        },
        income: {
            label: '↑ Receitas',
            value: formatMoney(summary.income, 'always'),
            sub: launchCount(summary.incomeCount),
            tone: 'in',
        },
        expenses: {
            label: '↓ Despesas',
            // O núcleo entrega o gasto em positivo; a tela mostra a saída com `−`.
            value: formatMoney(negate(summary.expenses), 'always'),
            sub: expenseVariationText(summary),
            tone: 'out',
        },
        openInvoices: {
            label: 'Faturas em aberto',
            value: formatMoney(summary.openInvoices.amountDue, 'absolute'),
            sub: openInvoicesText(summary.openInvoices),
            tone: 'strong',
        },
    };
}

/**
 * @param count Lançamentos de receita no mês.
 * @return `1 lançamento`, `3 lançamentos` ou `Nenhum lançamento`.
 */
function launchCount(count: number): string {
    return count === 0 ? 'Nenhum lançamento' : plural(count, 'lançamento', 'lançamentos');
}

/**
 * Regra de negócio (Relatórios, R6): com base zero não há percentual. Sem despesas nos dois
 * meses, o núcleo já entrega 0%, que se mostra como tal.
 *
 * @param summary Indicadores do mês.
 * @return `−12% vs mês anterior`, ou `Sem despesas no mês anterior` com base zero.
 */
function expenseVariationText(summary: MonthSummaryResponse): string {
    const { change } = summary.expenseVariation;
    if (change.kind === 'new') {
        return 'Sem despesas no mês anterior';
    }
    return `${formatPercent(change.ratio, { sign: 'always', decimals: 0 })} vs mês anterior`;
}

/**
 * Regra de negócio (Relatórios): as faturas em aberto são as que **vencem** no mês de
 * referência (reports-design §5); por isso o subtítulo diz o vencimento, e com mais de uma
 * fatura, o mais próximo.
 *
 * @param openInvoices Faturas em aberto do mês, como o núcleo as resume.
 * @return `1 cartão · vence 10/10`, `2 cartões · a primeira vence 05/10` ou
 * `Nenhuma vence neste mês`.
 */
function openInvoicesText(openInvoices: MonthSummaryResponse['openInvoices']): string {
    if (openInvoices.invoices === 0 || openInvoices.nextDueDate === null) {
        return 'Nenhuma vence neste mês';
    }
    const due = formatDayMonth(openInvoices.nextDueDate);
    const cards = plural(openInvoices.creditCards, 'cartão', 'cartões');
    return openInvoices.invoices === 1 ? `${cards} · vence ${due}` : `${cards} · a primeira vence ${due}`;
}

/** Um mês da evolução do saldo: os números para o gráfico e os textos para a tabela. */
export interface BalanceEvolutionRow {
    readonly period: string;
    /** `out`, o rótulo do eixo do gráfico; o ano se subentende pela vizinhança. */
    readonly axisLabel: string;
    /** `out/2026`, o rótulo da tabela e da dica, onde a virada do ano precisa aparecer. */
    readonly label: string;
    readonly isReference: boolean;
    /** Em unidades da moeda, só para a altura da barra; a tela mostra os textos. */
    readonly consolidated: number;
    readonly projected: number;
    readonly consolidatedText: string;
    readonly projectedText: string;
}

/**
 * Série da evolução do saldo, do mês mais antigo ao de referência, para o gráfico e para a
 * tabela equivalente. Os dois saem da mesma linha para que nunca mostrem números diferentes —
 * a tabela existe porque o gráfico sozinho não é acessível (desktop-mvp-plan §2, Gráficos).
 *
 * @param evolution Série do núcleo (`reports.balanceEvolution`).
 * @return Um mês por linha, na ordem do núcleo.
 */
export function balanceEvolutionRows(evolution: BalanceEvolutionResponse): readonly BalanceEvolutionRow[] {
    return evolution.points.map((point) => ({
        period: point.period,
        axisLabel: formatMonthAbbreviation(point.period),
        label: formatMonthShort(point.period),
        isReference: point.period === evolution.period,
        consolidated: point.closing.consolidated.amount,
        projected: point.closing.projected.amount,
        consolidatedText: formatMoney(point.closing.consolidated),
        projectedText: formatMoney(point.closing.projected),
    }));
}

/** Uma categoria no bloco "Maiores categorias". */
export interface TopCategory {
    readonly categoryId: string;
    readonly name: string;
    readonly amount: string;
    /** Largura da barra, de 0 a 1, relativa à maior categoria. */
    readonly barRatio: number;
}

/** Quantas categorias o bloco mostra, como no mockup. */
export const TOP_CATEGORIES_LIMIT = 4;

/**
 * Maiores categorias de despesa do mês, lidas do `reports.byCategory` para que o bloco e o
 * relatório nunca discordem. A barra é relativa à maior categoria, e não ao total do mês,
 * como no mockup: o bloco compara as categorias entre si. Não reordena: o núcleo já entrega a
 * árvore da maior para a menor, com o desempate do relatório, e as duas telas mostram a mesma
 * ordem.
 * Regra de negócio (Relatórios, R2): o estorno abate a própria categoria, então uma categoria
 * pode fechar o mês em zero ou negativa; ela fica fora, porque não é um gasto.
 *
 * @param report Relatório por categoria do mês de referência.
 * @param limit Quantas categorias mostrar.
 * @return As categorias com gasto, da maior para a menor; vazio quando o mês não tem despesas.
 */
export function topCategories(report: CategoryReportResponse, limit: number = TOP_CATEGORIES_LIMIT): readonly TopCategory[] {
    const spent = report.categories.filter((category) => category.amount.amount > 0).slice(0, limit);
    const largest = spent[0]?.amount.amount ?? 0;
    return spent.map((category) => ({
        categoryId: category.categoryId,
        name: category.name,
        amount: formatMoney(category.amount, 'absolute'),
        barRatio: largest > 0 ? category.amount.amount / largest : 0,
    }));
}

/** Uma conta no resumo de contas. */
export interface OverviewAccountRow {
    readonly accountId: string;
    readonly name: string;
    /** `Corrente`, ou `Corrente · fora do total`. */
    readonly detail: string;
    readonly consolidated: string;
    /** `previsto R$ 1.870,40`; `null` na conta fora do total, que mostra só o consolidado. */
    readonly projected: string | null;
    /** A conta fora do total aparece apagada (mockup). */
    readonly outsideTotal: boolean;
    readonly disabled: boolean;
}

/**
 * Resumo de contas, na ordem da tela Contas.
 * Regra de negócio (Contas): a conta com "considerar no saldo" desligado não entra no total e
 * aparece apagada e só com o consolidado, como na lista de Contas (database-design §4.4). A
 * desativada continua, porque o histórico e os saldos não mudam (desktop-mvp-plan §5.1).
 *
 * @param accounts Contas do perfil no mês de referência.
 * @return Uma linha por conta.
 */
export function overviewAccountRows(accounts: readonly AccountInPeriodResponse[]): readonly OverviewAccountRow[] {
    return accounts.map((account) => {
        const outsideTotal = !account.considerBalance;
        return {
            accountId: account.id,
            name: account.name,
            detail: outsideTotal ? `${formatAccountType(account.type)} · fora do total` : formatAccountType(account.type),
            consolidated: formatMoney(account.balances.consolidated),
            projected: outsideTotal ? null : `previsto ${formatMoney(account.balances.projected)}`,
            outsideTotal,
            disabled: account.disabled,
        };
    });
}

/** Situação da fatura do mês na etiqueta do resumo de cartões. */
export interface OverviewInvoiceStatus {
    readonly text: 'Em aberto' | 'Paga';
    /** `warn` em aberto e `ok` paga, como as etiquetas do mockup. */
    readonly tone: 'warn' | 'ok';
}

/** Um cartão no resumo de cartões. */
export interface OverviewCardRow {
    readonly creditCardId: string;
    readonly name: string;
    /** `vence 10/10 · paga com Nubank`. */
    readonly detail: string;
    /** `null` no mês sem fatura: não há o que estar paga nem em aberto. */
    readonly status: OverviewInvoiceStatus | null;
    /** Valor a pagar em módulo; `—` sem fatura no mês. */
    readonly amount: string;
    readonly disabled: boolean;
}

/**
 * Resumo de cartões com a fatura do mês de referência, a mesma da lista de Cartões.
 * Regra de negócio (Fatura): a fatura está paga ou em aberto (database-design §4.7); a
 * competência sem lançamentos não tem fatura, e o resumo mostra só o vencimento.
 *
 * @param creditCards Cartões do perfil no mês de referência.
 * @param accounts Contas do perfil, desativadas incluídas, para nomear a conta que paga cada
 * cartão.
 * @return Uma linha por cartão.
 */
export function overviewCardRows(creditCards: CreditCardListResponse, accounts: readonly AccountInPeriodResponse[]): readonly OverviewCardRow[] {
    const names = new Map(accounts.map((account) => [account.id, account.name]));
    return creditCards.creditCards.map((creditCard) => cardRow(creditCard, names.get(creditCard.accountId)));
}

/**
 * @param creditCard Cartão com a fatura do mês.
 * @param payerName Nome da conta pagadora; ausente se a conta não veio na lista.
 * @return A linha do cartão.
 */
function cardRow(creditCard: CreditCardInPeriodResponse, payerName: string | undefined): OverviewCardRow {
    const cycle = creditCard.invoiceOfMonth;
    const due = `vence ${formatDayMonth(cycle.dueDate)}`;
    return {
        creditCardId: creditCard.id,
        name: creditCard.name,
        detail: payerName === undefined ? due : `${due} · paga com ${payerName}`,
        status: cycle.invoice === null ? null : cycle.invoice.status === 'open' ? { text: 'Em aberto', tone: 'warn' } : { text: 'Paga', tone: 'ok' },
        amount: formatInvoiceAmount(cycle),
        disabled: creditCard.disabled,
    };
}
