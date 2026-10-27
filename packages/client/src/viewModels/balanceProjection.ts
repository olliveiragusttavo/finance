import type { BalanceProjectionBasis, BalanceProjectionResponse } from '@finance/core';
import { formatMonthShort } from '../format/dates.ts';
import { formatMoney } from '../format/money.ts';
import type { ReportChartView } from './reportView.ts';

/*
 * Projeção de saldo (reports-design §9): o saldo de hoje, o que já está lançado para cada mês, a
 * estimativa dos avulsos e a faixa de incerteza. Fica no `client` para que o celular mostre os
 * mesmos números e as mesmas palavras.
 */

/** Rótulo de cada janela da estimativa, no seletor da tela. */
export const BALANCE_PROJECTION_BASIS_LABELS: Readonly<Record<BalanceProjectionBasis, string>> = {
    12: '12 meses',
    6: '6 meses',
    3: '3 meses',
    1: '1 mês',
};

/** Um indicador da projeção. */
export interface BalanceProjectionKpi {
    readonly label: string;
    readonly value: string;
    /** Explicação curta embaixo do número. */
    readonly sub: string;
    /** A cor do número: entrada e saída na estimativa, neutro nos saldos. */
    readonly tone: 'in' | 'out' | 'neutral';
}

/** Uma linha de mês da projeção. */
export interface BalanceProjectionRow {
    readonly period: string;
    /** `out/2026 (fim do mês)` no mês corrente; `nov/2026` nos demais. */
    readonly label: string;
    /** O que já está lançado, com sinal. */
    readonly scheduled: string;
    /** A estimativa dos avulsos, com sinal. */
    readonly estimated: string;
    readonly balance: string;
    /** `R$ 900,00 a R$ 1.400,00`; `—` sem faixa. */
    readonly range: string;
    /** Saldo abaixo de zero, para a cor da saída. */
    readonly negative: boolean;
}

/** Uma linha de mês do histórico que formou a estimativa. */
export interface BalanceProjectionHistoryRow {
    readonly period: string;
    readonly label: string;
    readonly result: string;
    readonly recurring: string;
    readonly nonRecurring: string;
}

/** A projeção pronta para a tela. */
export interface BalanceProjectionView {
    readonly kpis: readonly [BalanceProjectionKpi, BalanceProjectionKpi, BalanceProjectionKpi];
    /** Saldo projetado com os cenários pessimista e otimista, no formato dos gráficos dos relatórios. */
    readonly chart: ReportChartView;
    readonly projection: readonly BalanceProjectionRow[];
    readonly history: readonly BalanceProjectionHistoryRow[];
    /** Aviso de que a estimativa usou menos meses que os pedidos; `null` sem ele. */
    readonly historyNote: string | null;
    /** Aviso de que não há faixa, por falta de meses para medir a variação; `null` com faixa. */
    readonly rangeNote: string | null;
}

/**
 * Regra de negócio (Relatórios, §9): a linha parte do saldo de hoje e mostra o cenário pessimista e
 * o otimista junto do projetado, para que a projeção não pareça mais firme do que é; a tela diz
 * quantos meses formaram a estimativa e separa o que já está lançado do que é estimado.
 *
 * @param response Projeção do núcleo.
 * @return Indicadores, gráfico, tabelas e os avisos.
 */
export function buildBalanceProjectionView(response: BalanceProjectionResponse): BalanceProjectionView {
    const last = response.points.at(-1);
    const months = response.history.length;
    const average = response.average.amount;
    const hasRange = response.deviation.amount > 0;
    const current = response.points[0]?.period;
    const series = hasRange
        ? [
            { key: 's0', label: 'Saldo projetado', color: 0 },
            { key: 's1', label: 'Cenário pessimista', color: 1 },
            { key: 's2', label: 'Cenário otimista', color: 2 },
        ]
        : [{ key: 's0', label: 'Saldo projetado', color: 0 }];
    const data = [
        { group: 'today', label: 'Hoje', s0: response.start.amount, ...(hasRange ? { s1: response.start.amount, s2: response.start.amount } : {}) },
        ...response.points.map((point) => ({
            group: point.period,
            label: formatMonthShort(point.period),
            s0: point.balance.amount,
            ...(hasRange ? { s1: point.low.amount, s2: point.high.amount } : {}),
        })),
    ];
    return {
        kpis: [
            { label: 'Saldo hoje', value: formatMoney(response.start), sub: 'Consolidado das contas do total', tone: 'neutral' },
            {
                label: 'Avulsos por mês',
                value: formatMoney(response.average, 'always'),
                sub: months === 0 ? 'Sem mês fechado no histórico' : `Estimativa: média de ${monthCount(months)}, fora as séries`,
                tone: average > 0 ? 'in' : average < 0 ? 'out' : 'neutral',
            },
            {
                label: last === undefined ? 'Saldo projetado' : `Em ${formatMonthShort(last.period)}`,
                value: last === undefined ? '—' : formatMoney(last.balance),
                sub: last === undefined || !hasRange ? 'Com o já lançado e a estimativa' : `Entre ${formatMoney(last.low)} e ${formatMoney(last.high)}`,
                tone: 'neutral',
            },
        ],
        chart: { kind: 'line', horizontal: false, data, series, hasNegative: data.some((point) => Math.min(point.s0, point.s1 ?? 0) < 0) },
        projection: response.points.map((point) => ({
            period: point.period,
            label: point.period === current ? `${formatMonthShort(point.period)} (fim do mês)` : formatMonthShort(point.period),
            scheduled: formatMoney(point.scheduled, 'always'),
            estimated: formatMoney(point.estimated, 'always'),
            balance: formatMoney(point.balance),
            range: hasRange ? `${formatMoney(point.low)} a ${formatMoney(point.high)}` : '—',
            negative: point.balance.amount < 0,
        })),
        history: response.history.map((month) => ({
            period: month.period,
            label: formatMonthShort(month.period),
            result: formatMoney(month.result, 'always'),
            recurring: formatMoney(month.recurring, 'always'),
            nonRecurring: formatMoney(month.nonRecurring, 'always'),
        })),
        historyNote: historyNote(response.basis, months),
        rangeNote: rangeNote(months, hasRange),
    };
}

/**
 * Regra de negócio (Relatórios, §9, B5): a faixa fecha por dois motivos diferentes, e o aviso
 * precisa dizer qual — com um mês só não há variação a medir; com mais meses, os avulsos não
 * variaram (um perfil só de séries, por exemplo). Dizer "um mês" para um histórico de doze
 * contradizia a tabela do histórico ao lado.
 *
 * @param months Meses que formaram a estimativa.
 * @param hasRange Se o desvio-padrão dos avulsos abre a faixa.
 * @return O aviso da faixa fechada; `null` com faixa ou sem histórico (o `historyNote` já explica).
 */
function rangeNote(months: number, hasRange: boolean): string | null {
    if (hasRange || months === 0) {
        return null;
    }
    return months === 1
        ? 'Com um mês de histórico não dá para medir quanto os avulsos variam; a projeção sai sem faixa.'
        : 'Os avulsos não variaram entre os meses da estimativa; sem variação para medir, a projeção sai sem faixa.';
}

/**
 * @param basis Janela pedida.
 * @param months Meses que formaram a estimativa.
 * @return O aviso quando o histórico é mais curto que a janela; `null` quando a cobre.
 */
function historyNote(basis: BalanceProjectionBasis, months: number): string | null {
    if (months === 0) {
        return 'Ainda não há mês fechado com movimento nas contas do total; a projeção usa só o que já está lançado.';
    }
    if (months < basis) {
        return `O histórico tem só ${monthCount(months)} fechado${months === 1 ? '' : 's'}; a estimativa usa ${months === 1 ? 'ele' : 'esses'}, e não ${BALANCE_PROJECTION_BASIS_LABELS[basis]}.`;
    }
    return null;
}

/**
 * @param months Quantidade de meses.
 * @return `1 mês`, `12 meses`.
 */
function monthCount(months: number): string {
    return months === 1 ? '1 mês' : `${String(months)} meses`;
}
