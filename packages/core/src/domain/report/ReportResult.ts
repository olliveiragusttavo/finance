import type { Currency } from '../shared/Currency.ts';
import { foldName } from '../shared/names.ts';
import { Money } from '../shared/Money.ts';
import type { YearMonth } from '../shared/YearMonth.ts';
import { TRANSACTION_TYPES } from '../transaction/TransactionType.ts';
import type { ReportWindow } from './ReportFilter.ts';
import type { ReportDimension, ReportLayout, ReportMeasure } from './ReportLayout.ts';

/**
 * Um grupo de uma dimensão. A chave é o id do cadastro (categoria, conta, tag...), o mês
 * `YYYY-MM`, o tipo (`expense`...) ou a situação (`paid`, `open`); `null` é o grupo "sem" — sem
 * tag, sem sócio (reports-design §3). O rótulo vem do cadastro e é `null` quando a tela é quem o
 * escreve: mês, tipo, situação e os grupos "sem".
 */
export interface ReportGroup {
    readonly key: string | null;
    readonly label: string | null;
}

/** Uma linha das somas como o banco agrupou: um grupo por dimensão pedida. */
export interface ReportAggregateRow {
    readonly groups: readonly ReportGroup[];
    /** Soma do `value`, na moeda do perfil, ainda sem arredondar. */
    readonly total: number;
    readonly count: number;
}

/**
 * As somas de um relatório em cada nível de agrupamento. Vêm em consultas separadas, e não
 * somadas aqui a partir das células, porque com a tag como dimensão a transação com duas tags
 * está em duas células: só o banco, agrupando de novo, conta cada transação uma vez no total
 * (reports-design §3, "Tag como dimensão").
 */
export interface ReportAggregation {
    /** Agrupadas pelas duas dimensões; com uma dimensão só, pela principal. */
    readonly cells: readonly ReportAggregateRow[];
    /** Agrupadas só pela principal; igual a `cells` sem secundária. */
    readonly primaryTotals: readonly ReportAggregateRow[];
    /** Agrupadas só pela secundária; vazio sem secundária. */
    readonly secondaryTotals: readonly ReportAggregateRow[];
    /** Sem agrupamento: cada transação do filtro uma vez. */
    readonly grandTotal: { readonly total: number; readonly count: number };
}

/** O número de uma célula ou de um total. */
export interface ReportFigure {
    readonly total: Money;
    readonly count: number;
}

/** Os grupos de uma dimensão, na ordem em que aparecem. */
export interface ReportAxis {
    readonly dimension: ReportDimension;
    readonly groups: readonly ReportGroup[];
}

/** Uma linha da tabela, ou um ponto do eixo do gráfico. */
export interface ReportRow {
    readonly group: ReportGroup;
    /** Uma por grupo da secundária, na ordem dela; vazio sem secundária. */
    readonly cells: readonly ReportFigure[];
    readonly total: ReportFigure;
}

/** O relatório pronto: a grade ordenada e completa, com os totais. */
export interface ReportResult {
    readonly window: ReportWindow;
    readonly measure: ReportMeasure;
    readonly primary: ReportAxis;
    readonly secondary: ReportAxis | null;
    readonly rows: readonly ReportRow[];
    /** Total de cada grupo da secundária, na ordem dela; vazio sem secundária. */
    readonly columnTotals: readonly ReportFigure[];
    readonly total: ReportFigure;
    /**
     * `true` quando a tag é uma das dimensões: a transação com várias tags conta em vários grupos,
     * e os totais deixam de ser a soma das células (reports-design §3).
     */
    readonly overlapping: boolean;
}

/** Ordem fixa da situação: o que já aconteceu antes do que vai acontecer. */
const STATUS_ORDER: readonly string[] = ['paid', 'open'];

/**
 * Monta a grade do relatório a partir das somas do banco: ordena os grupos, completa os meses e
 * as combinações sem lançamento com zero e põe cada total no lugar.
 * Regra de negócio (Relatórios, §3 "Ordem"): o mês é cronológico e traz todos os meses da janela;
 * tipo e situação seguem a ordem do domínio; as demais dimensões vão do maior número para o menor
 * na medida escolhida, com desempate pelo rótulo, e o grupo "sem" fica por último.
 *
 * @param layout Formato da definição: as dimensões e a medida.
 * @param window Meses cobertos, para completar a dimensão de mês.
 * @param aggregation Somas do banco em cada nível de agrupamento.
 * @param currency Moeda do perfil, a de todo `value` somado.
 * @return A grade pronta; sem lançamento no filtro, as linhas vêm vazias (ou só com os meses
 * zerados, quando a principal é o mês).
 */
export function buildReportResult(layout: ReportLayout, window: ReportWindow, aggregation: ReportAggregation, currency: Currency): ReportResult {
    const figure = (row: { readonly total: number; readonly count: number } | undefined): ReportFigure => ({
        total: Money.of(row?.total ?? 0, currency),
        count: row?.count ?? 0,
    });
    const primary = { dimension: layout.primary, groups: orderGroups(layout.primary, aggregation.primaryTotals, 0, layout.measure, window) };
    const secondary = layout.secondary === null
        ? null
        : { dimension: layout.secondary, groups: orderGroups(layout.secondary, aggregation.secondaryTotals, 0, layout.measure, window) };
    const primaryTotals = indexBy(aggregation.primaryTotals, (row) => keyOf(row, 0));
    const secondaryTotals = indexBy(aggregation.secondaryTotals, (row) => keyOf(row, 0));
    const cells = indexBy(aggregation.cells, (row) => `${keyOf(row, 0)}|${keyOf(row, 1)}`);
    return {
        window,
        measure: layout.measure,
        primary,
        secondary,
        rows: primary.groups.map((group) => ({
            group,
            cells: secondary === null ? [] : secondary.groups.map((column) => figure(cells.get(`${String(group.key)}|${String(column.key)}`))),
            total: figure(primaryTotals.get(String(group.key))),
        })),
        columnTotals: secondary === null ? [] : secondary.groups.map((column) => figure(secondaryTotals.get(String(column.key)))),
        total: figure(aggregation.grandTotal),
        overlapping: layout.primary === 'tag' || layout.secondary === 'tag',
    };
}

/**
 * Ordena os grupos de uma dimensão a partir dos totais dela.
 *
 * @param dimension Dimensão ordenada; decide se a ordem é fixa, cronológica ou pela medida.
 * @param totals Somas agrupadas por essa dimensão.
 * @param position Posição da dimensão em `groups` de cada linha.
 * @param measure Medida da definição: ordenar pela soma ou pela quantidade.
 * @param window Meses cobertos, para que a dimensão de mês traga todos.
 * @return Os grupos na ordem da tela.
 */
function orderGroups(dimension: ReportDimension, totals: readonly ReportAggregateRow[], position: number, measure: ReportMeasure, window: ReportWindow): readonly ReportGroup[] {
    if (dimension === 'month') {
        return monthsOf(window).map((month) => ({ key: month.toString(), label: null }));
    }
    const present = totals.map((row) => ({ group: row.groups[position] ?? { key: null, label: null }, row }));
    if (dimension === 'type' || dimension === 'status') {
        const order: readonly string[] = dimension === 'type' ? TRANSACTION_TYPES : STATUS_ORDER;
        return present.map((entry) => entry.group).sort((a, b) => order.indexOf(a.key ?? '') - order.indexOf(b.key ?? ''));
    }
    const weight = (row: ReportAggregateRow): number => (measure === 'sum' ? Math.abs(row.total) : row.count);
    return present
        .sort((a, b) => {
            if ((a.group.key === null) !== (b.group.key === null)) {
                return a.group.key === null ? 1 : -1;
            }
            return weight(b.row) - weight(a.row) || compareText(foldName(a.group.label ?? ''), foldName(b.group.label ?? '')) || compareText(a.group.key ?? '', b.group.key ?? '');
        })
        .map((entry) => entry.group);
}

/**
 * @param window Meses cobertos.
 * @return Cada mês da janela, do mais antigo ao final.
 */
function monthsOf(window: ReportWindow): readonly YearMonth[] {
    const months: YearMonth[] = [];
    for (let month = window.from; !window.to.isBefore(month); month = month.next()) {
        months.push(month);
    }
    return months;
}

/**
 * @param row Linha das somas.
 * @param position Posição da dimensão.
 * @return A chave do grupo como texto, com `null` virando `"null"` — o mesmo texto que a busca
 * usa, para que o grupo "sem" também se encontre no índice.
 */
function keyOf(row: ReportAggregateRow, position: number): string {
    return String(row.groups[position]?.key ?? null);
}

/**
 * @param rows Linhas a indexar.
 * @param key Chave de cada linha.
 * @return As linhas pela chave.
 */
function indexBy(rows: readonly ReportAggregateRow[], key: (row: ReportAggregateRow) => string): ReadonlyMap<string, ReportAggregateRow> {
    return new Map(rows.map((row) => [key(row), row]));
}

/**
 * Comparação por código de caractere, sem `localeCompare`: o núcleo roda no Chromium e no Hermes,
 * que ordenam acentos de jeitos diferentes, e a ordem do relatório não pode mudar entre aparelhos.
 *
 * @param a Primeiro texto.
 * @param b Segundo texto.
 * @return Negativo, zero ou positivo, como um comparador de `sort`.
 */
function compareText(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}
