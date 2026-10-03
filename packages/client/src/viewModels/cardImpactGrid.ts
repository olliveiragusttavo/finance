import type { AccountResponse, CardImpactInvoiceResponse, CardImpactResponse } from '@finance/core';
import { formatDayMonth, formatMonthAbbreviation, formatMonthShort } from '../format/dates.ts';
import { formatMoney } from '../format/money.ts';
import { formatPercent } from '../format/percent.ts';

/** Tom da etiqueta de situação, que a tela converte nos tokens `warn`, `ok`, `track` ou `muted`. */
export type SituationTone = 'muted' | 'warn' | 'ok' | 'neutral';

/** Situação de uma fatura dentro de uma célula. */
export interface CardImpactNote {
    readonly invoiceId: string;
    /** `paga no extrato de jul`, `Em aberto · vence 10/10` ou `Futura`. */
    readonly text: string;
    readonly tone: SituationTone;
}

/** Uma célula mês × cartão. */
export interface CardImpactCell {
    readonly creditCardId: string;
    /** Total das faturas que pesam no mês; vazio quando nenhuma pesa. */
    readonly amount: string;
    /** Uma nota por fatura: uma célula pode ter a fatura atrasada e a do mês (reports-design §4). */
    readonly notes: readonly CardImpactNote[];
}

/** Uma linha da grade (um mês). */
export interface CardImpactRow {
    readonly period: string;
    /** `jul/2026`. */
    readonly label: string;
    readonly isReference: boolean;
    /** O mês seguinte ao de referência (C5), mostrado mais apagado. */
    readonly isNext: boolean;
    readonly cells: readonly CardImpactCell[];
    readonly total: string;
    /** `36,6%`, ou `—` sem receita no mês (peso indefinido, nunca 0% nem ∞). */
    readonly weight: string;
    /** Proporção para a barra do peso, limitada a 0–1; `null` sem receita. */
    readonly weightShare: number | null;
}

/** Um indicador do topo da tela. */
export interface CardImpactKpi {
    readonly label: string;
    readonly value: string;
    readonly sub: string;
}

/** O impacto do cartão pronto para a tela. */
export interface CardImpactGrid {
    /** Colunas: `Nubank Roxinho · paga com Nubank`. */
    readonly columns: readonly { readonly creditCardId: string; readonly title: string; readonly disabled: boolean }[];
    readonly rows: readonly CardImpactRow[];
    readonly kpis: { readonly invoices: CardImpactKpi; readonly weight: CardImpactKpi; readonly average: CardImpactKpi };
    /** Perfil sem cartão: a tela mostra o estado vazio em vez de uma grade sem colunas. */
    readonly empty: boolean;
}

/** Peso indefinido (mês sem receita): traço, como nas tabelas dos mockups. */
const NO_WEIGHT = '—';

/**
 * Monta a grade do impacto do cartão (mockup DesktopRelCartao) a partir do relatório do
 * núcleo. Regra de negócio (Relatórios, C4): cada fatura aparece como paga (com o mês do
 * extrato que a absorveu), em aberto (com o vencimento) ou futura — a situação vem pronta do
 * núcleo, e aqui só se escolhe o texto e o tom.
 *
 * @param report Relatório do núcleo.
 * @param accounts Contas do perfil, desativadas incluídas, para nomear a conta pagadora no
 * cabeçalho de cada cartão.
 * @return Colunas, linhas, indicadores e o estado vazio.
 */
export function buildCardImpactGrid(report: CardImpactResponse, accounts: readonly Pick<AccountResponse, 'id' | 'name'>[]): CardImpactGrid {
    const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
    const nextPeriod = report.months[report.months.length - 1]?.period;
    return {
        columns: report.creditCards.map((creditCard) => ({
            creditCardId: creditCard.id,
            title: `${creditCard.name} · paga com ${accountNames.get(creditCard.accountId) ?? ''}`,
            disabled: creditCard.disabled,
        })),
        rows: report.months.map((month) => {
            const isReference = month.period === report.period;
            return {
                period: month.period,
                label: formatMonthShort(month.period),
                isReference,
                isNext: month.period === nextPeriod && month.period > report.period,
                cells: month.cells.map((cell) => ({
                    creditCardId: cell.creditCardId,
                    amount: cell.invoices.length === 0 ? '' : formatMoney(cell.total, 'absolute'),
                    notes: cell.invoices.map((invoice) => noteOf(invoice, isReference)),
                })),
                total: formatMoney(month.total, 'absolute'),
                weight: weightText(month.weight),
                weightShare: month.weight === null ? null : Math.min(1, Math.max(0, month.weight)),
            };
        }),
        kpis: kpisOf(report),
        empty: report.creditCards.length === 0,
    };
}

/**
 * @param invoice Fatura da célula.
 * @param isReference Se a linha é a do mês de referência; ali a fatura paga ganha destaque
 * de situação concluída, nos meses anteriores ela é só uma nota discreta.
 * @return A nota da fatura.
 */
function noteOf(invoice: CardImpactInvoiceResponse, isReference: boolean): CardImpactNote {
    const { situation } = invoice;
    switch (situation.kind) {
        case 'paid':
            return { invoiceId: invoice.invoiceId, text: `paga no extrato de ${formatMonthAbbreviation(situation.paidIn)}`, tone: isReference ? 'ok' : 'muted' };
        case 'open':
            return { invoiceId: invoice.invoiceId, text: `Em aberto · vence ${formatDayMonth(situation.dueDate)}`, tone: 'warn' };
        case 'future':
            return { invoiceId: invoice.invoiceId, text: 'Futura', tone: 'neutral' };
    }
}

/**
 * @param report Relatório do núcleo.
 * @return Os três indicadores do mockup.
 */
function kpisOf(report: CardImpactResponse): CardImpactGrid['kpis'] {
    const { reference, previousAverage } = report;
    return {
        invoices: {
            label: `Faturas de ${formatMonthShort(report.period)}`,
            value: formatMoney(reference.total, 'absolute'),
            sub: `${plural(reference.creditCards, 'cartão', 'cartões')} · ${String(reference.unpaid)} em aberto`,
        },
        weight: {
            label: 'Peso nas entradas do mês',
            value: weightText(reference.weight),
            sub: reference.weight === null ? 'sem entradas no mês' : `das entradas de ${formatMoney(reference.income)}`,
        },
        average: {
            label: 'Média dos 3 meses anteriores',
            value: formatMoney(previousAverage.total, 'absolute'),
            sub: previousAverage.weight === null ? 'sem entradas no período' : `${weightText(previousAverage.weight)} das entradas`,
        },
    };
}

/**
 * Regra de negócio (Relatórios, C3): sem receita o peso é indefinido e aparece como traço.
 *
 * @param weight Proporção do núcleo, ou `null` sem receita.
 * @return O peso formatado.
 */
function weightText(weight: number | null): string {
    return weight === null ? NO_WEIGHT : formatPercent(weight, { sign: 'negative', decimals: 1 });
}

/**
 * @param count Quantidade.
 * @param singular Palavra no singular.
 * @param pluralForm Palavra no plural.
 * @return `1 cartão`, `2 cartões`.
 */
function plural(count: number, singular: string, pluralForm: string): string {
    return `${String(count)} ${count === 1 ? singular : pluralForm}`;
}
