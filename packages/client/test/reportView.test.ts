import type { ReportFigureResponse, ReportResultResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { buildReportView, REPORT_CHART_MAX_SERIES, reportGroupLabel } from '../src/index.ts';
import { ClientWorld } from './support/ClientWorld.ts';

/**
 * @param amount Soma em reais.
 * @param count Quantidade.
 * @return O número de uma célula como o núcleo o devolve.
 */
function figure(amount: number, count = 1): ReportFigureResponse {
    return { total: { amount, currency: 'BRL' }, count };
}

/**
 * @param columns Quantas colunas a segunda divisão (tag) tem.
 * @return Um resultado por mês × tag, com R$ 10,00 por célula.
 */
function byMonthAndTag(columns: number): ReportResultResponse {
    const groups = Array.from({ length: columns }, (_, index) => ({ key: `t${String(index)}`, label: `tag ${String(index)}` }));
    return {
        from: '2026-09',
        to: '2026-10',
        measure: 'sum',
        primary: { dimension: 'month', groups: [{ key: '2026-09', label: null }, { key: '2026-10', label: null }] },
        secondary: { dimension: 'tag', groups },
        rows: ['2026-09', '2026-10'].map((key) => ({ group: { key, label: null }, cells: groups.map(() => figure(10)), total: figure(10 * columns, columns) })),
        columnTotals: groups.map(() => figure(20, 2)),
        total: figure(10 * columns, 2),
        overlapping: true,
    };
}

describe('rótulos dos grupos', () => {
    it('escreve o mês, o tipo, a situação e os grupos "sem"; o cadastro vem com o nome do núcleo', () => {
        expect(reportGroupLabel('month', { key: '2026-10', label: null })).toBe('out/2026');
        expect(reportGroupLabel('month', { key: '2026-10', label: null }, true)).toBe('out');
        expect(reportGroupLabel('type', { key: 'transference', label: null })).toBe('Transferência');
        expect(reportGroupLabel('status', { key: 'open', label: null })).toBe('Em aberto');
        expect(reportGroupLabel('tag', { key: null, label: null })).toBe('Sem tag');
        expect(reportGroupLabel('partner', { key: null, label: null })).toBe('Sem sócio');
        expect(reportGroupLabel('category', { key: 'c', label: 'Moradia' })).toBe('Moradia');
    });
});

describe('visualização do resultado (reports-design §3)', () => {
    it('monta a tabela e o gráfico de uma divisão a partir do núcleo real', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const result = await world.ok('reports.preview', {
            profileId: s.profileId,
            period: '2026-10',
            filter: { period: { anchor: { kind: 'reference' }, previousMonths: 2, basis: 'due' }, types: ['expense'] },
            layout: { format: 'line', primary: 'month' },
        });
        const view = buildReportView(result, 'line');
        expect(view.table).toEqual({
            rowHeader: 'Mês',
            columns: [],
            rows: [
                { key: '2026-08', label: 'ago/2026', cells: [], total: 'R$ 120,00' },
                { key: '2026-09', label: 'set/2026', cells: [], total: 'R$ 0,00' },
                { key: '2026-10', label: 'out/2026', cells: [], total: 'R$ 2.787,32' },
            ],
            columnTotals: [],
            total: 'R$ 2.907,32',
            totalHeader: 'Soma dos valores',
        });
        expect(view.chart).toEqual({
            kind: 'line',
            horizontal: false,
            data: [
                { label: 'ago', s0: 120 },
                { label: 'set', s0: 0 },
                { label: 'out', s0: 2787.32 },
            ],
            series: [{ key: 's0', label: 'Soma dos valores', color: 0 }],
            hasNegative: false,
        });
        expect(view.empty).toBe(false);
        expect(view.overlapNote).toBeNull();
    });

    it('no formato tabela não há gráfico, e a quantidade aparece como número', () => {
        const view = buildReportView({ ...byMonthAndTag(2), measure: 'count' }, 'table');
        expect(view.chart).toBeNull();
        expect(view.table.rows[0]?.cells).toEqual(['1', '1']);
        expect(view.table.totalHeader).toBe('Total');
    });

    it('Regra de negócio (Relatórios, §3): com a tag numa divisão, avisa que os totais contam cada lançamento uma vez', () => {
        expect(buildReportView(byMonthAndTag(2), 'bar').overlapNote).toMatch(/mais de uma tag/);
    });

    it('com mais séries que o limite, junta as demais em "Outros" e avisa; a tabela traz todas', () => {
        const view = buildReportView(byMonthAndTag(REPORT_CHART_MAX_SERIES + 2), 'bar');
        expect(view.chart?.series.map((series) => series.label)).toEqual(['tag 0', 'tag 1', 'tag 2', 'tag 3', 'Outros']);
        expect(view.chart?.data[0]).toEqual({ label: 'set', s0: 10, s1: 10, s2: 10, s3: 10, s4: 30 });
        expect(view.chart?.horizontal).toBe(false);
        expect(view.seriesNote).toBe('O gráfico mostra as 4 maiores e junta as demais em "Outros"; a tabela traz todas.');
        expect(view.table.columns).toHaveLength(REPORT_CHART_MAX_SERIES + 2);
        expect(buildReportView(byMonthAndTag(REPORT_CHART_MAX_SERIES), 'bar').seriesNote).toBeNull();
    });

    it('barras deitadas quando o eixo não é o mês, e o zero no eixo com estorno maior que a compra', () => {
        const result: ReportResultResponse = {
            ...byMonthAndTag(1),
            primary: { dimension: 'category', groups: [{ key: 'c', label: 'Compras' }] },
            secondary: null,
            rows: [{ group: { key: 'c', label: 'Compras' }, cells: [], total: figure(-40) }],
            columnTotals: [],
            total: figure(-40),
            overlapping: false,
        };
        const view = buildReportView(result, 'bar');
        expect(view.chart).toMatchObject({ horizontal: true, hasNegative: true, data: [{ label: 'Compras', s0: -40 }] });
    });

    it('sem lançamento no filtro, o resultado é vazio', () => {
        const view = buildReportView({ ...byMonthAndTag(0), total: figure(0, 0) }, 'table');
        expect(view.empty).toBe(true);
    });
});
