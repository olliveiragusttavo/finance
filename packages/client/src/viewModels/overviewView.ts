import {
    Currency,
    LocalDate,
    Money,
    type AccountInPeriodResponse,
    type AccountListResponse,
    type CreditCardInPeriodResponse,
    type CreditCardListResponse,
    type GoalProgressResponse,
    type MoneyResponse,
    type NoteResponse,
    type OverviewNextInvoicesResponse,
    type OverviewPendingResponse,
    type OverviewSpendingResponse,
    type PendingItemResponse,
} from '@finance/core';
import { formatAccountType } from '../format/account.ts';
import { formatDate, formatDayMonth, formatMonthAbbreviation, formatMonthLong } from '../format/dates.ts';
import { formatMoney } from '../format/money.ts';
import { summarizeNote } from '../format/note.ts';
import { formatPercent } from '../format/percent.ts';
import { describeGoalListItem, type GoalListItem } from './goalView.ts';
import { formatInvoiceAmount } from './invoiceView.ts';

/*
 * Visão geral pronta para a tela (mockup `DesktopVisaoGeral2`, que substituiu o `Main`; e o
 * `MobileInicio` do celular): os indicadores, o gráfico de gastos, as maiores categorias, o selo
 * de atrasados e os resumos de contas, cartões, metas e anotações. Fica no `client`, e não na
 * tela, porque o celular mostra os mesmos números com as mesmas frases (desktop-shell-design §4.2).
 */

/**
 * Tom do valor de um indicador, que a tela converte em token:
 * - `strong`: o número principal, sem sentido de entrada ou saída;
 * - `in` e `out`: entradas e gastos, sempre junto da seta do rótulo — a cor não é o único sinal
 *   (decisão de interface 7 dos mockups).
 */
export type OverviewKpiTone = 'strong' | 'in' | 'out';

/** Um indicador do topo da Visão geral. */
export interface OverviewKpi {
    readonly label: string;
    readonly value: string;
    readonly sub: string;
    readonly tone: OverviewKpiTone;
}

/** Os indicadores que saem da lista de contas. */
export interface OverviewBalanceKpis {
    readonly balance: OverviewKpi;
    readonly netWorth: OverviewKpi;
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
 * Soma valores do núcleo pelo `Money`, e não com `+` solto, para que o arredondamento e a
 * proibição de misturar moedas sejam os mesmos do núcleo.
 *
 * @param values Valores na moeda do perfil.
 * @param currency Moeda do perfil, para a soma vazia.
 * @return A soma, no formato dos DTOs.
 */
function sum(values: readonly MoneyResponse[], currency: string): MoneyResponse {
    const total = values.reduce((acc, value) => acc.add(Money.of(value.amount, Currency.of(value.currency))), Money.zero(Currency.of(currency)));
    return { amount: total.amount, currency: total.currency.code };
}

/**
 * Indicadores de saldo e de patrimônio. O consolidado e o previsto vêm do total da lista de
 * contas porque é o mesmo número do rodapé da tela Contas: as duas telas nunca podem discordar
 * sobre o saldo do mês. O previsto fica na mesma caixa, com peso menor (decisão de interface 6).
 * Regra de negócio (Contas): o total soma só as contas com "considerar no saldo", e a contagem
 * conta as mesmas (database-design §4.4). O patrimônio soma **todas** as contas, inclusive as
 * fora do total — os investimentos que o usuário não quer ver no saldo do dia a dia continuam
 * sendo dele.
 *
 * @param accounts Contas do perfil no mês de referência, com o total.
 * @return Os dois indicadores formatados.
 */
export function overviewKpis(accounts: AccountListResponse): OverviewBalanceKpis {
    const counted = accounts.accounts.filter((account) => account.considerBalance);
    const outside = accounts.accounts.filter((account) => !account.considerBalance);
    const { consolidated, projected } = accounts.total;
    const forecast = consolidated.amount === projected.amount ? 'previsto igual' : `previsto ${formatMoney(projected)}`;
    return {
        balance: {
            label: 'Saldo consolidado',
            value: formatMoney(consolidated),
            sub: `${plural(counted.length, 'conta', 'contas')} no total · ${forecast}`,
            tone: 'strong',
        },
        netWorth: {
            label: 'Patrimônio',
            value: formatMoney(sum(accounts.accounts.map((account) => account.balances.consolidated), consolidated.currency)),
            sub: outside.length === 0 ? 'todas as contas estão no saldo' : `inclui ${outside.map((account) => account.name).join(', ')}, fora do saldo total`,
            tone: 'strong',
        },
    };
}

/**
 * @param period Competência `YYYY-MM`.
 * @return O nome do mês em minúsculas, `outubro` — o dos rótulos "Gastos em outubro".
 */
function monthName(period: string): string {
    return (formatMonthLong(period).split(' ')[0] ?? '').toLowerCase();
}

/**
 * Quantos meses entram na média: do primeiro com gasto da janela ao de referência — a mesma
 * regra do núcleo (`buildSpendingSummary`), para que o texto diga de quantos meses é a média.
 *
 * @param spending Resumo de gastos.
 * @return A quantidade de meses da média; zero sem gasto na janela.
 */
function averagedMonths(spending: OverviewSpendingResponse): number {
    const first = spending.months.findIndex((month) => month.expenses.amount !== 0);
    return first < 0 ? 0 : spending.months.length - first;
}

/**
 * Indicadores de gastos e de entradas do mês de referência.
 * Regra de negócio (Visão geral): o gasto se compara com a média dos meses do gráfico; sem
 * média (nenhum gasto na janela) não há com o que comparar, e a frase diz isso em vez de "0%".
 *
 * @param spending Resumo de gastos do mês de referência.
 * @return Gastos e entradas, nessa ordem.
 */
export function overviewSpendingKpis(spending: OverviewSpendingResponse): readonly [OverviewKpi, OverviewKpi] {
    const month = monthName(spending.period);
    return [
        {
            label: `↓ Gastos em ${month}`,
            value: formatMoney(spending.expenses, 'absolute'),
            sub: compareWithAverage(spending),
            tone: 'out',
        },
        {
            label: `↑ Entradas em ${month}`,
            value: formatMoney(spending.income, 'absolute'),
            sub: 'receitas + transferências recebidas',
            tone: 'in',
        },
    ];
}

/**
 * @param spending Resumo de gastos.
 * @return `18% abaixo da média de 6 meses`, `igual à média…` ou por que não há comparação.
 */
function compareWithAverage(spending: OverviewSpendingResponse): string {
    const { average } = spending;
    if (average === null || average.amount === 0) {
        return 'sem gastos nos últimos meses para comparar';
    }
    const months = averagedMonths(spending);
    const ratio = spending.expenses.amount / average.amount - 1;
    const text = formatPercent(Math.abs(ratio), { sign: 'negative', decimals: 0 });
    const base = `média de ${plural(months, 'mês', 'meses')}`;
    if (text === '0%') {
        return `igual à ${base}`;
    }
    return `${text} ${ratio < 0 ? 'abaixo' : 'acima'} da ${base}`;
}

/**
 * Indicador "Próximas faturas": a soma da próxima fatura em aberto de cada cartão.
 *
 * @param next Próximas faturas do perfil.
 * @param currency Moeda do perfil, para o total sem fatura.
 * @return O indicador formatado.
 */
export function overviewNextInvoicesKpi(next: OverviewNextInvoicesResponse, currency: string): OverviewKpi {
    const dates = [...new Set(next.invoices.map((invoice) => invoice.dueDate))];
    const first = dates[0];
    const cards = plural(next.invoices.length, 'cartão', 'cartões');
    return {
        label: 'Próximas faturas',
        value: formatMoney(sum(next.invoices.map((invoice) => invoice.amount), currency), 'absolute'),
        sub: first === undefined ? 'nenhuma fatura em aberto' : dates.length === 1 ? `${cards} · ${next.invoices.length === 1 ? 'vence' : 'vencem'} ${formatDayMonth(first)}` : `${cards} · a primeira vence ${formatDayMonth(first)}`,
        tone: 'strong',
    };
}

/**
 * Valor arredondado ao inteiro, sem centavos — o dos rótulos das barras (`7.615`), em que os
 * centavos só poluiriam um gráfico de comparação.
 *
 * @param money Valor do núcleo.
 * @param withSymbol Se leva o símbolo da moeda (`R$ 7.938`, na linha da média).
 * @return O valor agrupado em milhares.
 */
function formatWhole(money: MoneyResponse, withSymbol: boolean): string {
    const text = formatMoney({ amount: Math.round(money.amount), currency: money.currency }, 'negative').replace(/,\d+$/, '');
    return withSymbol ? text : text.replace(/^(−?)\S+ /, '$1');
}

/** Uma barra do gráfico "Gastos por mês". */
export interface SpendingBar {
    readonly period: string;
    /** `mai`. */
    readonly label: string;
    /** `7.615`. */
    readonly value: string;
    /** Altura entre 0 e 1, relativa ao maior valor do gráfico (barra ou média). */
    readonly ratio: number;
    /** O mês de referência, em destaque. */
    readonly current: boolean;
}

/** O gráfico "Gastos por mês". */
export interface SpendingChart {
    readonly bars: readonly SpendingBar[];
    /** A linha da média; `null` sem gasto na janela. */
    readonly average: { readonly text: string; readonly ratio: number } | null;
    /** Descrição para o leitor de tela, com todos os valores. */
    readonly description: string;
}

/**
 * Monta o gráfico de barras dos seis meses com a linha da média. As alturas são relativas ao
 * maior valor entre as barras e a média, para que a linha nunca saia do gráfico; o mês com
 * estorno maior que as compras (negativo) fica sem barra.
 *
 * @param spending Resumo de gastos.
 * @return As barras, a média e a descrição.
 */
export function spendingChart(spending: OverviewSpendingResponse): SpendingChart {
    const top = Math.max(0, spending.average?.amount ?? 0, ...spending.months.map((month) => month.expenses.amount));
    const ratio = (amount: number): number => (top === 0 ? 0 : Math.max(0, amount) / top);
    const bars = spending.months.map((month) => ({
        period: month.period,
        label: formatMonthAbbreviation(month.period),
        value: formatWhole(month.expenses, false),
        ratio: ratio(month.expenses.amount),
        current: month.period === spending.period,
    }));
    const first = spending.months[0];
    const average = spending.average === null ? null : { text: `média ${formatWhole(spending.average, true)}`, ratio: ratio(spending.average.amount) };
    const values = bars.map((bar) => bar.value).join(', ');
    return {
        bars,
        average,
        description: `Gastos de ${first === undefined ? '' : monthName(first.period)} a ${monthName(spending.period)}: ${values}${average === null ? '' : `; ${average.text}`}`,
    };
}

/** Uma linha de "Para onde foi no mês". */
export interface CategoryShareRow {
    /** `null` na linha das outras categorias. */
    readonly categoryId: string | null;
    readonly name: string;
    readonly amount: string;
    /** `31%` dos gastos com categoria do mês. */
    readonly share: string;
    /** Comprimento da barra entre 0 e 1, relativo à maior categoria. */
    readonly barRatio: number;
}

/** O bloco "Para onde foi no mês". */
export interface CategoryShares {
    readonly title: string;
    readonly rows: readonly CategoryShareRow[];
    /** As outras categorias juntas, sem barra; `null` quando todas cabem no bloco. */
    readonly others: CategoryShareRow | null;
}

/**
 * As maiores categorias do mês com a participação de cada uma.
 * Regra de negócio (Visão geral): a participação é sobre a soma das categorias com gasto
 * positivo — a que o núcleo devolve, maiores e outras —, para que os percentuais fechem 100%
 * mesmo com estornos numa categoria.
 *
 * @param spending Resumo de gastos.
 * @return As linhas do bloco.
 */
export function categoryShares(spending: OverviewSpendingResponse): CategoryShares {
    const currency = spending.expenses.currency;
    const total = sum([...spending.categories.map((category) => category.amount), spending.others.amount], currency).amount;
    const top = spending.categories[0]?.amount.amount ?? 0;
    const share = (amount: number): string => formatPercent(total === 0 ? 0 : amount / total, { sign: 'negative', decimals: 0 });
    const { count, amount } = spending.others;
    return {
        title: `Para onde foi em ${monthName(spending.period)}`,
        rows: spending.categories.map((category) => ({
            categoryId: category.categoryId,
            name: category.name,
            amount: formatMoney(category.amount, 'absolute'),
            share: share(category.amount.amount),
            barRatio: top === 0 ? 0 : category.amount.amount / top,
        })),
        others: count === 0 ? null : { categoryId: null, name: count === 1 ? 'Outra categoria' : `Outras ${String(count)} categorias`, amount: formatMoney(amount, 'absolute'), share: share(amount.amount), barRatio: 0 },
    };
}

/** Uma conta no resumo de contas. */
export interface OverviewAccountRow {
    readonly accountId: string;
    readonly name: string;
    /** O tipo: `Corrente`, `Investimentos`. */
    readonly detail: string;
    readonly consolidated: string;
    /** O previsto embaixo do consolidado; `null` na conta fora do total e na zerada, que mostram um valor só. */
    readonly projected: string | null;
    /** Conta com consolidado e previsto zerados: aparece esmaecida, para que as que têm dinheiro se destaquem (mockup). */
    readonly empty: boolean;
    readonly disabled: boolean;
}

/** O bloco de contas: as do total, as de fora e o total do saldo. */
export interface OverviewAccounts {
    readonly inTotal: readonly OverviewAccountRow[];
    /** As contas com "considerar no saldo" desligado, num grupo próprio. */
    readonly outsideTotal: readonly OverviewAccountRow[];
    /** O total do saldo, o mesmo do indicador e do rodapé de Contas. */
    readonly total: string;
}

/**
 * Resumo de contas, na ordem da tela Contas.
 * Regra de negócio (Contas): a conta com "considerar no saldo" desligado não entra no total e
 * fica num grupo à parte, só com o consolidado (database-design §4.4). A desativada continua,
 * porque o histórico e os saldos não mudam (desktop-mvp-plan §5.1).
 *
 * @param accounts Contas do perfil no mês de referência, com o total.
 * @return As contas separadas pelo total e o total formatado.
 */
export function overviewAccounts(accounts: AccountListResponse): OverviewAccounts {
    return {
        inTotal: accounts.accounts.filter((account) => account.considerBalance).map((account) => accountRow(account, true)),
        outsideTotal: accounts.accounts.filter((account) => !account.considerBalance).map((account) => accountRow(account, false)),
        total: formatMoney(accounts.total.consolidated),
    };
}

/**
 * @param account Conta no mês.
 * @param inTotal Se a conta entra no saldo, e por isso mostra também o previsto.
 * @return A linha da conta.
 */
function accountRow(account: AccountInPeriodResponse, inTotal: boolean): OverviewAccountRow {
    const { consolidated, projected } = account.balances;
    const empty = consolidated.amount === 0 && projected.amount === 0;
    return {
        accountId: account.id,
        name: account.name,
        detail: formatAccountType(account.type),
        consolidated: formatMoney(consolidated),
        projected: inTotal && !empty ? formatMoney(projected) : null,
        empty,
        disabled: account.disabled,
    };
}

/** Situação de uma fatura na etiqueta do resumo de cartões. */
export interface OverviewInvoiceStatus {
    readonly text: 'Em aberto' | 'Paga';
    /** `warn` em aberto e `ok` paga, como as etiquetas do mockup. */
    readonly tone: 'warn' | 'ok';
}

/** Uma fatura na linha de um cartão. */
export interface OverviewInvoiceLine {
    /** Competência, que abre a fatura certa na tela Cartões. */
    readonly period: string;
    /** `out · vence 15/10`. */
    readonly label: string;
    /** `null` no mês sem fatura. */
    readonly status: OverviewInvoiceStatus | null;
    /** Valor a pagar em módulo; `—` sem fatura no mês. */
    readonly amount: string;
    /** A próxima em aberto, em destaque. */
    readonly next: boolean;
}

/** Um cartão no resumo de cartões. */
export interface OverviewCardRow {
    readonly creditCardId: string;
    readonly name: string;
    /** `paga com Inter`; vazio quando a conta não veio na lista. */
    readonly payer: string;
    /** A fatura do mês de referência e, quando é outra, a próxima em aberto. */
    readonly invoices: readonly OverviewInvoiceLine[];
    readonly disabled: boolean;
}

/**
 * Resumo de cartões: a fatura do mês de referência, a mesma da lista de Cartões, e a próxima em
 * aberto quando não é ela — para que o resumo diga o que vem a pagar mesmo num mês já fechado.
 * Regra de negócio (Fatura): a fatura está paga ou em aberto (database-design §4.7); a
 * competência sem lançamentos não tem fatura, e a linha mostra só o vencimento.
 *
 * @param creditCards Cartões do perfil no mês de referência.
 * @param accounts Contas do perfil, desativadas incluídas, para nomear a conta que paga cada cartão.
 * @param next Próximas faturas do perfil; `null` enquanto carregam.
 * @return Uma linha por cartão.
 */
export function overviewCardRows(creditCards: CreditCardListResponse, accounts: readonly AccountInPeriodResponse[], next: OverviewNextInvoicesResponse | null): readonly OverviewCardRow[] {
    const names = new Map(accounts.map((account) => [account.id, account.name]));
    return creditCards.creditCards.map((creditCard) => cardRow(creditCard, names.get(creditCard.accountId), next?.invoices.find((invoice) => invoice.creditCardId === creditCard.id)));
}

/**
 * @param creditCard Cartão com a fatura do mês.
 * @param payerName Nome da conta pagadora; ausente se a conta não veio na lista.
 * @param next A próxima fatura em aberto do cartão, se houver.
 * @return A linha do cartão.
 */
function cardRow(creditCard: CreditCardInPeriodResponse, payerName: string | undefined, next: OverviewNextInvoicesResponse['invoices'][number] | undefined): OverviewCardRow {
    const cycle = creditCard.invoiceOfMonth;
    const month: OverviewInvoiceLine = {
        period: cycle.period,
        label: `${formatMonthAbbreviation(cycle.period)} · vence ${formatDayMonth(cycle.dueDate)}`,
        status: cycle.invoice === null ? null : cycle.invoice.status === 'open' ? { text: 'Em aberto', tone: 'warn' } : { text: 'Paga', tone: 'ok' },
        amount: formatInvoiceAmount(cycle),
        next: next?.period === cycle.period,
    };
    const upcoming: readonly OverviewInvoiceLine[] =
        next === undefined || next.period === cycle.period
            ? []
            : [{ period: next.period, label: `${formatMonthAbbreviation(next.period)} · vence ${formatDayMonth(next.dueDate)}`, status: { text: 'Em aberto', tone: 'warn' }, amount: formatMoney(next.amount, 'absolute'), next: true }];
    return {
        creditCardId: creditCard.id,
        name: creditCard.name,
        payer: payerName === undefined ? '' : `paga com ${payerName}`,
        invoices: [month, ...upcoming],
        disabled: creditCard.disabled,
    };
}

/** Uma meta no resumo de metas. */
export interface OverviewGoalRow extends GoalListItem {
    /** O prazo terminou e a meta não foi atingida: a etiqueta "Prazo vencido". */
    readonly overdue: boolean;
    /** `Ritmo necessário ≈ R$ 3.600,66/mês`; `null` quando não há ritmo a seguir. */
    readonly pace: string | null;
}

/**
 * A meta no resumo, com o alerta de prazo e o ritmo — o que pede ação, sem abrir a tela Metas.
 * Regra de negócio (Metas, desktop-mvp-plan Fase 9.3): o prazo e o ritmo contam a partir do fim
 * do mês de referência; o prazo encerrado (`monthsLeft` zero) sem a meta atingida é vencido, e
 * sem prazo, atingida ou vencida não há ritmo a seguir.
 *
 * @param goal Meta com o progresso.
 * @return Os textos da linha.
 */
export function overviewGoalRow(goal: GoalProgressResponse): OverviewGoalRow {
    const item = describeGoalListItem(goal);
    const overdue = !goal.reached && goal.monthsLeft === 0;
    return {
        ...item,
        summary: overdue && goal.targetDate !== null ? `${formatMoney(goal.saved)} de ${formatMoney(goal.value)} · prazo era ${formatDate(goal.targetDate)}` : item.summary,
        overdue,
        pace: overdue || goal.requiredPerMonth === null ? null : `Ritmo necessário ≈ ${formatMoney(goal.requiredPerMonth)}/mês`,
    };
}

/** O selo ao lado do título da Visão geral. */
export interface PendingBadge {
    /** `warn` com atrasados, `ok` sem. */
    readonly tone: 'warn' | 'ok';
    /** `3 atrasados` ou `Nada atrasado`. */
    readonly title: string;
    /** `R$ 350,65 a pagar · R$ 6,00 a receber`; `null` sem valores. */
    readonly detail: string | null;
    /** Se o selo abre o painel: há algo atrasado ou em aberto até o fim do mês. */
    readonly opens: boolean;
}

/**
 * @param totals Totais de um grupo.
 * @return `R$ 350,65 a pagar · R$ 6,00 a receber`, sem as partes zeradas; `null` se ambas forem.
 */
function describeTotals(totals: OverviewPendingResponse['overdueTotals']): string | null {
    const parts = [
        totals.toPay.amount === 0 ? null : `${formatMoney(totals.toPay, 'absolute')} a pagar`,
        totals.toReceive.amount === 0 ? null : `${formatMoney(totals.toReceive, 'absolute')} a receber`,
    ].filter((part) => part !== null);
    return parts.length === 0 ? null : parts.join(' · ');
}

/**
 * O selo de atrasados (mockup `DesktopVisaoGeral2`): a contagem e os valores dos lançamentos e
 * faturas que venceram antes de hoje sem pagamento. Sem atraso, o selo verde ainda abre o painel
 * quando há algo em aberto até o fim do mês (pedido do usuário: o que está em aberto mora no
 * painel, no lugar da lista "Próximos 30 dias").
 *
 * @param pending Atrasados e em aberto.
 * @return O selo.
 */
export function pendingBadge(pending: OverviewPendingResponse): PendingBadge {
    const count = pending.overdue.length;
    return {
        tone: count === 0 ? 'ok' : 'warn',
        title: count === 0 ? 'Nada atrasado' : plural(count, 'atrasado', 'atrasados'),
        detail: count === 0 ? upcomingHint(pending) : describeTotals(pending.overdueTotals),
        opens: count > 0 || pending.upcoming.length > 0,
    };
}

/**
 * @param pending Atrasados e em aberto.
 * @return `2 em aberto até 31/10`; `null` sem nada em aberto.
 */
function upcomingHint(pending: OverviewPendingResponse): string | null {
    return pending.upcoming.length === 0 ? null : `${String(pending.upcoming.length)} em aberto até ${formatDayMonth(pending.until)}`;
}

/** O que a linha do painel oferece. */
export type PendingAction =
    | { readonly kind: 'markPaid'; readonly transactionId: string; readonly label: 'Marcar como pago' | 'Marcar como recebido' }
    | { readonly kind: 'openInvoice'; readonly creditCardId: string; readonly period: string; readonly label: 'Abrir fatura' }
    | null;

/** Uma linha do painel de atrasados e em aberto. */
export interface PendingRow {
    readonly key: string;
    readonly name: string;
    /** `11/10/2026`. */
    readonly date: string;
    /** `há 16 dias`, `vence hoje`, `em 3 dias`. */
    readonly when: string;
    readonly overdue: boolean;
    /** Conta, "origem → destino" ou a conta que paga a fatura. */
    readonly where: string;
    /** Com o sinal ou o ⇄ (decisão de interface 7). */
    readonly value: string;
    readonly tone: 'in' | 'out' | 'transfer';
    readonly action: PendingAction;
}

/** O painel aberto pelo selo. */
export interface PendingPanel {
    readonly overdue: readonly PendingRow[];
    readonly upcoming: readonly PendingRow[];
    /** O rodapé: o que ainda vence até o fim do mês, ou que nada vence. */
    readonly footer: string;
}

/**
 * @param count Dias.
 * @return `1 dia`, `16 dias`.
 */
function days(count: number): string {
    return plural(count, 'dia', 'dias');
}

/**
 * @param item Item em aberto.
 * @param today Dia de hoje.
 * @return A linha do painel.
 */
function pendingRow(item: PendingItemResponse, today: LocalDate): PendingRow {
    const due = LocalDate.parse(item.dueDate);
    const distance = due.toEpochDay() - today.toEpochDay();
    const value = item.direction === 'transfer' ? `⇄ ${formatMoney(item.amount, 'absolute')}` : `${item.direction === 'in' ? '+' : '−'}${formatMoney(item.amount, 'absolute')}`;
    return {
        key: `${item.kind}:${item.id}`,
        name: item.kind === 'invoice' ? `Fatura ${item.name}` : item.name,
        date: formatDate(item.dueDate),
        when: distance < 0 ? `há ${days(-distance)}` : distance === 0 ? 'vence hoje' : `em ${days(distance)}`,
        overdue: distance < 0,
        where: item.kind === 'invoice' ? `${formatMonthAbbreviation(item.period)} · paga com ${item.where}` : item.where,
        value,
        tone: item.direction,
        action: pendingAction(item),
    };
}

/**
 * Regra de negócio (Visão geral): a transferência que chega de outro perfil só aparece — quem a
 * marca como paga é o perfil de origem, dono da linha (database-design §4.13). A fatura não se
 * paga daqui: o pagamento pede conta, valor e data, e a linha leva à fatura na tela Cartões.
 *
 * @param item Item em aberto.
 * @return A ação da linha, ou `null` quando não há o que fazer daqui.
 */
function pendingAction(item: PendingItemResponse): PendingAction {
    if (item.kind === 'invoice') {
        return { kind: 'openInvoice', creditCardId: item.creditCardId, period: item.period, label: 'Abrir fatura' };
    }
    if (!item.canMarkPaid) {
        return null;
    }
    return { kind: 'markPaid', transactionId: item.id, label: item.direction === 'in' ? 'Marcar como recebido' : 'Marcar como pago' };
}

/**
 * O painel do selo: os atrasados e, embaixo, o que ainda vence até o fim do mês.
 *
 * @param pending Atrasados e em aberto.
 * @return As linhas dos dois grupos e o rodapé.
 */
export function pendingPanel(pending: OverviewPendingResponse): PendingPanel {
    const today = LocalDate.parse(pending.today);
    const until = formatDayMonth(pending.until);
    const totals = describeTotals(pending.upcomingTotals);
    return {
        overdue: pending.overdue.map((item) => pendingRow(item, today)),
        upcoming: pending.upcoming.map((item) => pendingRow(item, today)),
        footer: pending.upcoming.length === 0 ? `Nada mais vence até ${until}.` : `Até ${until}: ${totals ?? 'só transferências entre contas'}.`,
    };
}

/**
 * Mensagem do "Desfazer" depois de marcar um lançamento pelo painel: diz o que mudou e em que dia
 * — o núcleo grava o pagamento com a data de hoje, o que pode mudar o mês do lançamento.
 *
 * @param row Linha marcada.
 * @param today Dia de hoje, `YYYY-MM-DD`.
 * @return `Crossfit marcado como pago em 27/10/2026.`
 */
export function markedPaidMessage(row: PendingRow, today: string): string {
    return `${row.name} marcado como ${row.tone === 'in' ? 'recebido' : 'pago'} em ${formatDate(today)}.`;
}

/** Uma anotação no bloco da Visão geral: só o título, que leva a ela na tela Anotações. */
export interface OverviewNoteRow {
    readonly noteId: string;
    /** A primeira linha da anotação (decisão de interface 9 dos mockups). */
    readonly title: string;
}

/** O bloco de anotações da Visão geral. */
export interface OverviewNotes {
    readonly rows: readonly OverviewNoteRow[];
    /** Quantas ficaram de fora do bloco; o link "Todas" diz o total. */
    readonly hiddenCount: number;
}

/**
 * Quantas anotações o bloco mostra: as mais recentes. O bloco é pequeno no mockup
 * `DesktopVisaoGeral2`, embaixo das metas; as outras estão a um clique, na tela Anotações.
 */
export const OVERVIEW_NOTES_LIMIT = 4;

/**
 * Anotações da Visão geral (desktop-mvp-plan Fase 13.2): só os títulos, das mais recentes para as
 * mais antigas — a ordem em que o núcleo as lista —, para que se ache a anotação sem abrir
 * Anotações; o texto inteiro fica no editor, para onde cada título leva.
 *
 * @param notes Anotações do perfil, da mais recente para a mais antiga.
 * @param limit Quantas mostrar.
 * @return Os títulos mostrados e quantos ficaram de fora.
 */
export function overviewNotes(notes: readonly NoteResponse[], limit: number = OVERVIEW_NOTES_LIMIT): OverviewNotes {
    return {
        rows: notes.slice(0, limit).map((note) => ({ noteId: note.id, title: summarizeNote(note.text).title })),
        hiddenCount: Math.max(0, notes.length - limit),
    };
}
