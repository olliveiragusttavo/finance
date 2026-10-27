import type { ReportDimension, ReportMeasure } from '../../domain/report/ReportLayout.ts';
import type { ReportAxis, ReportFigure, ReportGroup, ReportResult } from '../../domain/report/ReportResult.ts';
import { toMoneyResponse, type MoneyResponse } from '../shared/MoneyResponse.ts';

/** Um grupo de uma dimensão; `key: null` é o grupo "sem" (sem tag, sem sócio). */
export interface ReportGroupResponse {
    readonly key: string | null;
    /** Nome do cadastro; `null` quando a tela escreve o rótulo (mês, tipo, situação, "sem"). */
    readonly label: string | null;
}

/** Os grupos de uma dimensão, na ordem da tela. */
export interface ReportAxisResponse {
    readonly dimension: ReportDimension;
    readonly groups: readonly ReportGroupResponse[];
}

/** O número de uma célula ou de um total, nas duas medidas. */
export interface ReportFigureResponse {
    readonly total: MoneyResponse;
    readonly count: number;
}

/** Uma linha da tabela, ou um ponto do eixo do gráfico. */
export interface ReportRowResponse {
    readonly group: ReportGroupResponse;
    /** Uma por grupo da secundária, na ordem dela; vazio sem secundária. */
    readonly cells: readonly ReportFigureResponse[];
    readonly total: ReportFigureResponse;
}

/** Resultado de um relatório, salvo ou do editor. */
export interface ReportResultResponse {
    /** Primeiro e último mês da janela, `YYYY-MM`. */
    readonly from: string;
    readonly to: string;
    readonly measure: ReportMeasure;
    readonly primary: ReportAxisResponse;
    readonly secondary: ReportAxisResponse | null;
    readonly rows: readonly ReportRowResponse[];
    readonly columnTotals: readonly ReportFigureResponse[];
    readonly total: ReportFigureResponse;
    /** Com a tag como dimensão, os totais não são a soma das células (reports-design §3). */
    readonly overlapping: boolean;
}

/**
 * @param group Grupo do domínio.
 * @return O grupo serializável.
 */
function toGroup(group: ReportGroup): ReportGroupResponse {
    return { key: group.key, label: group.label };
}

/**
 * @param axis Eixo do domínio.
 * @return O eixo serializável.
 */
function toAxis(axis: ReportAxis): ReportAxisResponse {
    return { dimension: axis.dimension, groups: axis.groups.map(toGroup) };
}

/**
 * Cada número é arredondado uma vez, aqui, a partir da soma sem arredondar (database-design §3.7);
 * por isso um total pode diferir em um centavo da soma das células arredondadas.
 *
 * @param figure Número do domínio.
 * @return O número serializável.
 */
function toFigure(figure: ReportFigure): ReportFigureResponse {
    return { total: toMoneyResponse(figure.total), count: figure.count };
}

/**
 * @param result Resultado montado pelo domínio.
 * @return O resultado serializável.
 */
export function toReportResultResponse(result: ReportResult): ReportResultResponse {
    return {
        from: result.window.from.toString(),
        to: result.window.to.toString(),
        measure: result.measure,
        primary: toAxis(result.primary),
        secondary: result.secondary === null ? null : toAxis(result.secondary),
        rows: result.rows.map((row) => ({ group: toGroup(row.group), cells: row.cells.map(toFigure), total: toFigure(row.total) })),
        columnTotals: result.columnTotals.map(toFigure),
        total: toFigure(result.total),
        overlapping: result.overlapping,
    };
}
