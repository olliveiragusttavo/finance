import type { ReportDimension, ReportFigureResponse, ReportFlowGroup, ReportFormat, ReportGroupResponse, ReportMeasure, ReportRecurrenceGroup, ReportResultResponse, TransactionType } from '@finance/core';
import { formatMonthAbbreviation, formatMonthShort } from '../format/dates.ts';
import { formatMoney } from '../format/money.ts';
import { formatPercent } from '../format/percent.ts';
import { REPORT_DIMENSION_LABELS, REPORT_MEASURE_LABELS } from './reportEditor.ts';
import { formatTransactionType } from './transactionEditor.ts';

/*
 * Resultado de um relatório personalizado pronto para a tela (reports-design §3): a tabela
 * agrupada e o gráfico saem da mesma grade do núcleo, para que nunca mostrem números diferentes —
 * a tabela acompanha todo gráfico porque o gráfico sozinho não é acessível.
 */

/**
 * Rótulo do grupo "sem" de cada dimensão que o tem. A categoria e a subcategoria só ficam sem na
 * transferência recebida de outro perfil, cuja classificação é de lá (reports-design §2.2).
 */
const MISSING_LABELS: Readonly<Partial<Record<ReportDimension, string>>> = {
    tag: 'Sem tag',
    partner: 'Sem sócio',
    category: 'Sem categoria',
    subCategory: 'Sem subcategoria',
};

/** Rótulo de cada situação. */
const STATUS_GROUP_LABELS: Readonly<Record<string, string>> = { paid: 'Pago', open: 'Em aberto' };

/** Rótulo de cada grupo de entrada e saída. */
const FLOW_GROUP_LABELS: Readonly<Record<ReportFlowGroup, string>> = { in: 'Entrada', out: 'Saída' };

/** Rótulo de cada grupo de recorrência, no plural da coluna "Rec." da tabela de lançamentos. */
const RECURRENCE_GROUP_LABELS: Readonly<Record<ReportRecurrenceGroup, string>> = { fixed: 'Fixas', installments: 'Parceladas', single: 'Avulsas' };

/**
 * @param value Chave de um grupo de tipo.
 * @return O tipo, quando a chave é um deles.
 */
function asTransactionType(value: string): TransactionType | null {
    return value === 'income' || value === 'expense' || value === 'transference' || value === 'investment' ? value : null;
}

/**
 * @param value Chave de um grupo de recorrência.
 * @return O grupo, quando a chave é um deles.
 */
function asRecurrenceGroup(value: string): ReportRecurrenceGroup | null {
    return value === 'fixed' || value === 'installments' || value === 'single' ? value : null;
}

/**
 * O núcleo dá o nome dos cadastros e deixa para a tela o rótulo do que não é cadastro — o mês, o
 * tipo, a situação, a recorrência, a entrada e a saída e os grupos "sem" —, para que o texto seja o mesmo dos outros
 * lugares do app.
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
        case 'recurrence': {
            const recurrence = asRecurrenceGroup(group.key);
            return recurrence === null ? group.key : RECURRENCE_GROUP_LABELS[recurrence];
        }
        case 'flow':
            return group.key === 'in' || group.key === 'out' ? FLOW_GROUP_LABELS[group.key] : group.key;
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

/** Variação de um valor em relação ao mês anterior (reports-design L9). */
export interface ReportChange {
    /** `+12,3%`, `−4,0%` ou `0%`. */
    readonly text: string;
    /** Para a seta ao lado do número: aumento e redução não dependem só da cor. */
    readonly direction: 'up' | 'down' | 'same';
}

/** Uma linha da tabela. */
export interface ReportTableRow {
    readonly key: string;
    readonly label: string;
    /** Uma por coluna; vazio sem segunda divisão. */
    readonly cells: readonly string[];
    readonly total: string;
    /** Variação de cada célula, na ordem das colunas; `null` onde não há o que comparar. */
    readonly cellChanges: readonly (ReportChange | null)[];
    /** Variação do total da linha; `null` onde não há o que comparar. */
    readonly totalChange: ReportChange | null;
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
    /** Variação de cada total de coluna; `null` onde não há o que comparar. */
    readonly columnTotalChanges: readonly (ReportChange | null)[];
    readonly total: string;
    /**
     * Cabeçalho da coluna do total da linha: a medida ("Soma dos valores"), "Total" com colunas,
     * ou "Resultado" quando as colunas são entrada e saída com a análise.
     */
    readonly totalHeader: string;
    /** Rótulo da linha do rodapé: "Total", ou "Resultado" quando as linhas são entrada e saída com a análise. */
    readonly footerLabel: string;
}

/** Uma série do gráfico. */
export interface ReportChartSeries {
    /** Chave do dado e da variável de cor (`s0`, `s1`...). */
    readonly key: string;
    readonly label: string;
    /** Posição na paleta da tela, de 0 a `REPORT_CHART_MAX_SERIES − 1`. */
    readonly color: number;
}

/** O gráfico de barras ou de linha pronto para o Recharts. */
export interface ReportChartView {
    readonly kind: Exclude<ReportFormat, 'table' | 'pie'>;
    /**
     * Barras deitadas, com o rótulo à esquerda: quando o eixo não é o tempo, os nomes (categorias,
     * contas) são longos e cabem melhor numa coluna do que embaixo de cada barra.
     */
    readonly horizontal: boolean;
    /**
     * Um ponto por grupo da dimensão principal: `group` (a chave do grupo, única), `label` e um
     * número por série. O eixo usa `group`, e não `label`: dois grupos podem ter o mesmo rótulo
     * (subcategorias homônimas em categorias diferentes), e o Recharts junta categorias iguais
     * do eixo, mostrando os números da primeira nas duas.
     */
    readonly data: readonly Readonly<Record<string, string | number>>[];
    readonly series: readonly ReportChartSeries[];
    /** Algum valor abaixo de zero (estornos maiores que as compras): o eixo precisa mostrar o zero. */
    readonly hasNegative: boolean;
}

/** Uma fatia da pizza: um grupo da dimensão principal, ou "Outros". */
export interface ReportPieSlice {
    /** Chave da variável de cor (`s0`, `s1`...). */
    readonly key: string;
    readonly label: string;
    /** O número que a fatia desenha: o valor em unidades da moeda, ou a quantidade. */
    readonly value: number;
    /** Participação no total das fatias, já formatada (`32,2%`). */
    readonly share: string;
    /** Posição na paleta da tela, de 0 a `REPORT_CHART_MAX_SERIES − 1`. */
    readonly color: number;
}

/** O gráfico de pizza pronto para o Recharts. */
export interface ReportPieView {
    /** Na ordem do resultado, com "Outros" por último; vazio quando nenhum grupo é positivo. */
    readonly slices: readonly ReportPieSlice[];
    /** Resultado de entradas menos saídas, já formatado, com a análise; `null` sem ele. */
    readonly result: string | null;
}

/** O resultado pronto: tabela, gráfico e os avisos. */
export interface ReportView {
    readonly table: ReportTableView;
    /** Barras ou linha; `null` na tabela e na pizza. */
    readonly chart: ReportChartView | null;
    /** `null` fora do formato pizza. */
    readonly pie: ReportPieView | null;
    /** Nenhuma transação entrou no filtro. */
    readonly empty: boolean;
    /** Aviso de que os totais não são a soma das linhas (tag como dimensão); `null` sem ele. */
    readonly overlapNote: string | null;
    /** Aviso de que as séries além da quarta foram juntadas em "Outros"; `null` sem ele. */
    readonly seriesNote: string | null;
    /** Aviso de que grupos zerados ou negativos ficaram fora da pizza; `null` sem ele. */
    readonly pieNote: string | null;
    /** Aviso de como a entrada e a saída somam; `null` sem essa divisão. */
    readonly flowNote: string | null;
}

/**
 * Quantas séries o gráfico desenha. Com mais que isso as cores deixam de se distinguir; a partir
 * da quinta, as séries viram uma só, "Outros", e a tabela continua com todas.
 */
export const REPORT_CHART_MAX_SERIES = 5;

/** Rótulo do resultado de entradas menos saídas, na tabela, no gráfico e na pizza. */
const FLOW_RESULT_LABEL = 'Resultado';

/**
 * Regra de negócio (Relatórios, L9): a análise de entrada e saída é o resultado — entradas menos
 * saídas. Só vale na soma: a diferença entre quantidades de lançamentos não mede nada.
 *
 * @param result Resultado do núcleo.
 * @param analysis Se a definição pede a análise.
 * @return `true` quando o resultado de entradas menos saídas aparece.
 */
function showsFlowResult(result: ReportResultResponse, analysis: boolean): boolean {
    return analysis && result.measure === 'sum' && (result.primary.dimension === 'flow' || result.secondary?.dimension === 'flow');
}

/**
 * Regra de negócio (Relatórios, L9): a variação compara o valor com o do mês anterior, sobre o
 * tamanho do anterior — assim uma saída (negativa) que fica mais negativa aparece como redução do
 * valor, como na conta. Sem mês anterior, ou com ele zerado, não há percentual: dividir por zero
 * não diz quanto mudou.
 *
 * @param measure Medida do relatório, que decide se compara a soma ou a quantidade.
 * @param current Número do mês.
 * @param previous Número do mesmo grupo no mês anterior; `undefined` no primeiro mês.
 * @return A variação, ou `null` quando não há o que comparar.
 */
function changeFrom(measure: ReportMeasure, current: ReportFigureResponse, previous: ReportFigureResponse | undefined): ReportChange | null {
    if (previous === undefined) {
        return null;
    }
    const before = chartValue(measure, previous);
    if (before === 0) {
        return null;
    }
    const ratio = (chartValue(measure, current) - before) / Math.abs(before);
    const text = formatPercent(ratio, { sign: 'always', decimals: 1 });
    return { text, direction: text === '0%' ? 'same' : ratio > 0 ? 'up' : 'down' };
}

/**
 * Monta a tabela e o gráfico do resultado.
 * Regra de negócio (Relatórios, §3 "Tag como dimensão"): com a tag numa das divisões, a transação
 * com várias tags aparece em várias linhas, e o total geral a conta uma vez só; o aviso explica a
 * diferença.
 * Regra de negócio (Relatórios, L9): com a análise, a tabela com o mês numa das divisões mostra a
 * variação de cada valor em relação ao mês anterior — o da linha de cima quando o mês são as
 * linhas, o da coluna à esquerda quando são as colunas —, e a entrada e saída mostra o resultado.
 *
 * @param result Resultado do núcleo.
 * @param format Formato da definição.
 * @param analysis Se a definição pede a análise.
 * @return A tela pronta.
 */
export function buildReportView(result: ReportResultResponse, format: ReportFormat, analysis = false): ReportView {
    const { measure } = result;
    const primary = result.primary.dimension;
    const secondary = result.secondary;
    const flowResult = showsFlowResult(result, analysis);
    const monthRows = analysis && primary === 'month';
    const monthColumns = analysis && secondary?.dimension === 'month';
    const columns = secondary === null ? [] : secondary.groups.map((group) => ({ key: String(group.key), label: reportGroupLabel(secondary.dimension, group) }));
    const table: ReportTableView = {
        rowHeader: REPORT_DIMENSION_LABELS[primary],
        columns,
        rows: result.rows.map((row, rowIndex) => {
            const above = result.rows[rowIndex - 1];
            return {
                key: String(row.group.key),
                label: reportGroupLabel(primary, row.group),
                cells: row.cells.map((cell) => formatReportFigure(measure, cell)),
                total: formatReportFigure(measure, row.total),
                cellChanges: row.cells.map((cell, index) => {
                    if (monthRows) {
                        return changeFrom(measure, cell, above?.cells[index]);
                    }
                    return monthColumns ? changeFrom(measure, cell, row.cells[index - 1]) : null;
                }),
                totalChange: monthRows ? changeFrom(measure, row.total, above?.total) : null,
            };
        }),
        columnTotals: result.columnTotals.map((cell) => formatReportFigure(measure, cell)),
        columnTotalChanges: result.columnTotals.map((cell, index) => (monthColumns ? changeFrom(measure, cell, result.columnTotals[index - 1]) : null)),
        total: formatReportFigure(measure, result.total),
        totalHeader: secondary === null ? REPORT_MEASURE_LABELS[measure] : flowResult && secondary.dimension === 'flow' ? FLOW_RESULT_LABEL : 'Total',
        footerLabel: flowResult && primary === 'flow' ? FLOW_RESULT_LABEL : 'Total',
    };
    const pie = format === 'pie' ? buildPie(result, flowResult) : null;
    const seriesCount = pie !== null ? countPositive(result) : secondary === null ? 1 : secondary.groups.length;
    return {
        table,
        chart: format === 'table' || format === 'pie' ? null : buildChart(result, format, flowResult),
        pie,
        empty: result.total.count === 0,
        overlapNote: result.overlapping
            ? 'Um lançamento com mais de uma tag aparece em cada uma delas; por isso os totais contam cada lançamento uma vez e podem ser menores que a soma das linhas.'
            : null,
        seriesNote: format !== 'table' && seriesCount > REPORT_CHART_MAX_SERIES
            ? `O gráfico mostra as ${String(REPORT_CHART_MAX_SERIES - 1)} maiores e junta as demais em "Outros"; a tabela traz todas.`
            : null,
        pieNote: pie !== null && primary !== 'flow' && result.rows.some((row) => row.total.count > 0 && chartValue(measure, row.total) <= 0)
            ? 'Grupos com soma zerada ou negativa (estornos maiores que as compras) não viram fatia e ficam fora do gráfico; a tabela traz todos.'
            : null,
        flowNote: primary === 'flow' || secondary?.dimension === 'flow'
            ? 'A saída soma negativo e os totais são o líquido (entradas menos saídas). A transferência entre contas do perfil aparece como saída e como entrada; na quantidade, conta uma vez.'
            : null,
    };
}

/**
 * @param result Resultado do núcleo.
 * @return Quantos grupos da dimensão principal viram fatia, para o aviso de "Outros".
 */
function countPositive(result: ReportResultResponse): number {
    return result.rows.filter((row) => (result.primary.dimension === 'flow' ? row.total.count > 0 : chartValue(result.measure, row.total) > 0)).length;
}

/**
 * Regra de negócio (Relatórios, L7): a pizza divide o total entre os grupos da dimensão principal,
 * e só um valor positivo vira fatia — um grupo negativo não tem ângulo, e incluí-lo deixaria as
 * participações sem somar 100%. Como nas séries, os grupos além do quarto maior viram "Outros".
 *
 * @param result Resultado do núcleo, sem dimensão secundária.
 * @param flowResult Se a análise mostra o resultado de entradas menos saídas.
 * @return As fatias, na ordem do resultado e com a participação de cada uma.
 */
function buildPie(result: ReportResultResponse, flowResult: boolean): ReportPieView {
    const { measure } = result;
    const primary = result.primary.dimension;
    const positive = result.rows
        // Na entrada e saída a saída soma negativo; na pizza vale o tamanho de cada lado.
        .map((row) => ({ label: reportGroupLabel(primary, row.group), value: primary === 'flow' ? Math.abs(chartValue(measure, row.total)) : chartValue(measure, row.total) }))
        .filter((entry) => entry.value > 0);
    // A seleção dos maiores não reordena as fatias: o tipo, a situação e a recorrência mantêm a
    // ordem fixa do domínio, e as demais já vêm do maior para o menor.
    const overflow = positive.length > REPORT_CHART_MAX_SERIES;
    const largest = new Set([...positive].sort((a, b) => b.value - a.value).slice(0, overflow ? REPORT_CHART_MAX_SERIES - 1 : positive.length));
    const kept = positive.filter((entry) => largest.has(entry));
    const others = positive.filter((entry) => !largest.has(entry)).reduce((sum, entry) => sum + entry.value, 0);
    const entries = overflow ? [...kept, { label: 'Outros', value: others }] : kept;
    const whole = entries.reduce((sum, entry) => sum + entry.value, 0);
    return {
        slices: entries.map((entry, index) => ({
            key: `s${String(index)}`,
            label: entry.label,
            value: entry.value,
            share: formatPercent(entry.value / whole, { sign: 'negative', decimals: 1 }),
            color: index,
        })),
        result: flowResult ? formatReportFigure(measure, result.total) : null,
    };
}

/**
 * @param result Resultado do núcleo.
 * @param kind Barras ou linha.
 * @param flowResult Se a análise mostra o resultado de entradas menos saídas: um ponto a mais no
 * eixo quando a entrada e saída é a principal, uma série a mais quando é a secundária.
 * @return O gráfico: sem segunda divisão, uma série com o total de cada grupo; com ela, uma série
 * por grupo da segunda, juntando os que passam do limite em "Outros". O mês só perde o ano no
 * eixo quando a janela inteira cabe num ano: com 13 meses, "jan" apareceria duas vezes.
 */
function buildChart(result: ReportResultResponse, kind: Exclude<ReportFormat, 'table' | 'pie'>, flowResult: boolean): ReportChartView {
    const { measure } = result;
    const primary = result.primary.dimension;
    const secondary = result.secondary;
    const values: number[] = [];
    /**
     * O mês só perde o ano no eixo quando a janela inteira cabe num ano: numa janela de 13 meses
     * "jan" apareceria duas vezes e os dois pontos ficariam indistinguíveis.
     *
     * @param group Grupo da dimensão principal.
     * @return O rótulo do ponto no eixo.
     */
    const axisLabel =(group: ReportGroupResponse): string => reportGroupLabel(primary, group, result.from.slice(0, 4) === result.to.slice(0, 4));
    let series: readonly ReportChartSeries[];
    let data: readonly Readonly<Record<string, string | number>>[];
    if (secondary === null) {
        series = [{ key: 's0', label: REPORT_MEASURE_LABELS[measure], color: 0 }];
        data = result.rows.map((row) => {
            const value = chartValue(measure, row.total);
            values.push(value);
            return { group: String(row.group.key), label: axisLabel(row.group), s0: value };
        });
        if (flowResult) {
            const value = chartValue(measure, result.total);
            values.push(value);
            data = [...data, { group: 'result', label: FLOW_RESULT_LABEL, s0: value }];
        }
    } else {
        const overflow = secondary.groups.length > REPORT_CHART_MAX_SERIES;
        const shown = overflow ? REPORT_CHART_MAX_SERIES - 1 : secondary.groups.length;
        series = [
            ...secondary.groups.slice(0, shown).map((group, index) => ({ key: `s${String(index)}`, label: reportGroupLabel(secondary.dimension, group), color: index })),
            ...(overflow ? [{ key: `s${String(shown)}`, label: 'Outros', color: shown }] : []),
        ];
        /**
         * @param group Chave do ponto no eixo.
         * @param label Rótulo do ponto.
         * @param cells Números da segunda divisão, na ordem dela.
         * @return O ponto, com os grupos além do limite somados em "Outros".
         */
        const pointOf = (group: string, label: string, cells: readonly ReportFigureResponse[]): Record<string, string | number> => {
            const point: Record<string, string | number> = { group, label };
            cells.forEach((cell, index) => {
                const slot = `s${String(Math.min(index, shown))}`;
                const current = point[slot];
                point[slot] = (typeof current === 'number' ? current : 0) + chartValue(measure, cell);
            });
            return point;
        };
        const rows = result.rows.map((row) => ({ point: pointOf(String(row.group.key), axisLabel(row.group), row.cells), total: row.total }));
        if (flowResult && secondary.dimension === 'flow') {
            // O resultado de cada ponto é o total da linha: com a entrada e saída, ele já é o líquido.
            series = [...series, { key: 'result', label: FLOW_RESULT_LABEL, color: series.length }];
            for (const row of rows) {
                row.point['result'] = chartValue(measure, row.total);
            }
        }
        data = rows.map((row) => row.point);
        if (flowResult && primary === 'flow') {
            data = [...data, pointOf('result', FLOW_RESULT_LABEL, result.columnTotals)];
        }
        for (const point of data) {
            for (const entry of series) {
                const value = point[entry.key];
                values.push(typeof value === 'number' ? value : 0);
            }
        }
    }
    return { kind, horizontal: kind === 'bar' && primary !== 'month', data, series, hasNegative: values.some((value) => value < 0) };
}
