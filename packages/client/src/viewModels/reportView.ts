import type { ReportDimension, ReportFigureResponse, ReportFormat, ReportGroupResponse, ReportMeasure, ReportResultResponse, TransactionType } from '@finance/core';
import { formatMonthAbbreviation, formatMonthShort } from '../format/dates.ts';
import { formatMoney } from '../format/money.ts';
import { REPORT_DIMENSION_LABELS, REPORT_MEASURE_LABELS } from './reportEditor.ts';
import { formatTransactionType } from './transactionEditor.ts';

/*
 * Resultado de um relatório personalizado pronto para a tela (reports-design §3): a tabela
 * agrupada e o gráfico saem da mesma grade do núcleo, para que nunca mostrem números diferentes —
 * a tabela acompanha todo gráfico porque o gráfico sozinho não é acessível.
 */

/** Rótulo do grupo "sem" de cada dimensão que o tem. */
const MISSING_LABELS: Readonly<Partial<Record<ReportDimension, string>>> = {
    tag: 'Sem tag',
    partner: 'Sem sócio',
};

/** Rótulo de cada situação. */
const STATUS_GROUP_LABELS: Readonly<Record<string, string>> = { paid: 'Pago', open: 'Em aberto' };

/**
 * @param value Chave de um grupo de tipo.
 * @return O tipo, quando a chave é um deles.
 */
function asTransactionType(value: string): TransactionType | null {
    return value === 'income' || value === 'expense' || value === 'transference' || value === 'investment' ? value : null;
}

/**
 * O núcleo dá o nome dos cadastros e deixa para a tela o rótulo do que não é cadastro — o mês, o
 * tipo, a situação e os grupos "sem" —, para que o texto seja o mesmo dos outros lugares do app.
 *
 * @param dimension Dimensão do grupo.
 * @param group Grupo do resultado.
 * @param short `true` no eixo do gráfico, onde o mês cabe sem o ano (`out`).
 * @return O rótulo do grupo.
 */
export function reportGroupLabel(dimension: ReportDimension, group: ReportGroupResponse, short = false): string {
    if (group.key === null) {
        return MISSING_LABELS[dimension] ?? '—';
    }
    switch (dimension) {
        case 'month':
            return short ? formatMonthAbbreviation(group.key) : formatMonthShort(group.key);
        case 'type': {
            const type = asTransactionType(group.key);
            return type === null ? group.key : formatTransactionType(type);
        }
        case 'status':
            return STATUS_GROUP_LABELS[group.key] ?? group.key;
        case 'category':
        case 'subCategory':
        case 'source':
        case 'tag':
        case 'partner':
            return group.label ?? '—';
    }
}

/**
 * @param measure Medida do relatório.
 * @param figure Número de uma célula ou total.
 * @return A soma em dinheiro, ou a quantidade de lançamentos.
 */
export function formatReportFigure(measure: ReportMeasure, figure: ReportFigureResponse): string {
    return measure === 'sum' ? formatMoney(figure.total) : String(figure.count);
}

/**
 * @param measure Medida do relatório.
 * @param figure Número de uma célula ou total.
 * @return O número que o gráfico desenha: o valor em unidades da moeda, ou a quantidade.
 */
function chartValue(measure: ReportMeasure, figure: ReportFigureResponse): number {
    return measure === 'sum' ? figure.total.amount : figure.count;
}

/** Uma coluna da tabela (um grupo da segunda divisão). */
export interface ReportTableColumn {
    readonly key: string;
    readonly label: string;
}

/** Uma linha da tabela. */
export interface ReportTableRow {
    readonly key: string;
    readonly label: string;
    /** Uma por coluna; vazio sem segunda divisão. */
    readonly cells: readonly string[];
    readonly total: string;
}

/** A tabela agrupada. */
export interface ReportTableView {
    /** Cabeçalho da primeira coluna: o nome da dimensão principal. */
    readonly rowHeader: string;
    /** Grupos da segunda divisão; vazio sem ela. */
    readonly columns: readonly ReportTableColumn[];
    readonly rows: readonly ReportTableRow[];
    /** Totais de cada coluna, na ordem delas. */
    readonly columnTotals: readonly string[];
    readonly total: string;
    /** Cabeçalho da coluna do total da linha: a medida ("Soma dos valores"), ou "Total" com colunas. */
    readonly totalHeader: string;
}

/** Uma série do gráfico. */
export interface ReportChartSeries {
    /** Chave do dado e da variável de cor (`s0`, `s1`...). */
    readonly key: string;
    readonly label: string;
    /** Posição na paleta da tela, de 0 a `REPORT_CHART_MAX_SERIES − 1`. */
    readonly color: number;
}

/** O gráfico pronto para o Recharts. */
export interface ReportChartView {
    readonly kind: Exclude<ReportFormat, 'table'>;
    /**
     * Barras deitadas, com o rótulo à esquerda: quando o eixo não é o tempo, os nomes (categorias,
     * contas) são longos e cabem melhor numa coluna do que embaixo de cada barra.
     */
    readonly horizontal: boolean;
    /** Um ponto por grupo da dimensão principal: `label` e um número por série. */
    readonly data: readonly Readonly<Record<string, string | number>>[];
    readonly series: readonly ReportChartSeries[];
    /** Algum valor abaixo de zero (estornos maiores que as compras): o eixo precisa mostrar o zero. */
    readonly hasNegative: boolean;
}

/** O resultado pronto: tabela, gráfico e os avisos. */
export interface ReportView {
    readonly table: ReportTableView;
    /** `null` no formato tabela. */
    readonly chart: ReportChartView | null;
    /** Nenhuma transação entrou no filtro. */
    readonly empty: boolean;
    /** Aviso de que os totais não são a soma das linhas (tag como dimensão); `null` sem ele. */
    readonly overlapNote: string | null;
    /** Aviso de que as séries além da quarta foram juntadas em "Outros"; `null` sem ele. */
    readonly seriesNote: string | null;
}

/**
 * Quantas séries o gráfico desenha. Com mais que isso as cores deixam de se distinguir; a partir
 * da quinta, as séries viram uma só, "Outros", e a tabela continua com todas.
 */
export const REPORT_CHART_MAX_SERIES = 5;

/**
 * Monta a tabela e o gráfico do resultado.
 * Regra de negócio (Relatórios, §3 "Tag como dimensão"): com a tag numa das divisões, a transação
 * com várias tags aparece em várias linhas, e o total geral a conta uma vez só; o aviso explica a
 * diferença.
 *
 * @param result Resultado do núcleo.
 * @param format Formato da definição.
 * @return A tela pronta.
 */
export function buildReportView(result: ReportResultResponse, format: ReportFormat): ReportView {
    const { measure } = result;
    const primary = result.primary.dimension;
    const secondary = result.secondary;
    const columns = secondary === null ? [] : secondary.groups.map((group) => ({ key: String(group.key), label: reportGroupLabel(secondary.dimension, group) }));
    const table: ReportTableView = {
        rowHeader: REPORT_DIMENSION_LABELS[primary],
        columns,
        rows: result.rows.map((row) => ({
            key: String(row.group.key),
            label: reportGroupLabel(primary, row.group),
            cells: row.cells.map((cell) => formatReportFigure(measure, cell)),
            total: formatReportFigure(measure, row.total),
        })),
        columnTotals: result.columnTotals.map((cell) => formatReportFigure(measure, cell)),
        total: formatReportFigure(measure, result.total),
        totalHeader: secondary === null ? REPORT_MEASURE_LABELS[measure] : 'Total',
    };
    const seriesCount = secondary === null ? 1 : secondary.groups.length;
    return {
        table,
        chart: format === 'table' ? null : buildChart(result, format),
        empty: result.total.count === 0,
        overlapNote: result.overlapping
            ? 'Um lançamento com mais de uma tag aparece em cada uma delas; por isso os totais contam cada lançamento uma vez e podem ser menores que a soma das linhas.'
            : null,
        seriesNote: format !== 'table' && seriesCount > REPORT_CHART_MAX_SERIES
            ? `O gráfico mostra as ${String(REPORT_CHART_MAX_SERIES - 1)} maiores e junta as demais em "Outros"; a tabela traz todas.`
            : null,
    };
}

/**
 * @param result Resultado do núcleo.
 * @param kind Barras ou linha.
 * @return O gráfico: sem segunda divisão, uma série com o total de cada grupo; com ela, uma série
 * por grupo da segunda, juntando os que passam do limite em "Outros".
 */
function buildChart(result: ReportResultResponse, kind: Exclude<ReportFormat, 'table'>): ReportChartView {
    const { measure } = result;
    const primary = result.primary.dimension;
    const secondary = result.secondary;
    const values: number[] = [];
    let series: readonly ReportChartSeries[];
    let data: readonly Readonly<Record<string, string | number>>[];
    if (secondary === null) {
        series = [{ key: 's0', label: REPORT_MEASURE_LABELS[measure], color: 0 }];
        data = result.rows.map((row) => {
            const value = chartValue(measure, row.total);
            values.push(value);
            return { label: reportGroupLabel(primary, row.group, true), s0: value };
        });
    } else {
        const overflow = secondary.groups.length > REPORT_CHART_MAX_SERIES;
        const shown = overflow ? REPORT_CHART_MAX_SERIES - 1 : secondary.groups.length;
        series = [
            ...secondary.groups.slice(0, shown).map((group, index) => ({ key: `s${String(index)}`, label: reportGroupLabel(secondary.dimension, group), color: index })),
            ...(overflow ? [{ key: `s${String(shown)}`, label: 'Outros', color: shown }] : []),
        ];
        data = result.rows.map((row) => {
            const point: Record<string, string | number> = { label: reportGroupLabel(primary, row.group, true) };
            row.cells.forEach((cell, index) => {
                const slot = `s${String(Math.min(index, shown))}`;
                const current = point[slot];
                point[slot] = (typeof current === 'number' ? current : 0) + chartValue(measure, cell);
            });
            for (const entry of series) {
                const value = point[entry.key];
                values.push(typeof value === 'number' ? value : 0);
            }
            return point;
        });
    }
    return { kind, horizontal: kind === 'bar' && primary !== 'month', data, series, hasNegative: values.some((value) => value < 0) };
}
