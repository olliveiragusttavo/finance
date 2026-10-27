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
    it('escreve o mês, o tipo, a situação, a recorrência e os grupos "sem"; o cadastro vem com o nome do núcleo', () => {
        expect(reportGroupLabel('month', { key: '2026-10', label: null })).toBe('out/2026');
        expect(reportGroupLabel('month', { key: '2026-10', label: null }, true)).toBe('out');
        expect(reportGroupLabel('type', { key: 'transference', label: null })).toBe('Transferência');
        expect(reportGroupLabel('status', { key: 'open', label: null })).toBe('Em aberto');
        expect(reportGroupLabel('recurrence', { key: 'fixed', label: null })).toBe('Fixas');
        expect(reportGroupLabel('recurrence', { key: 'installments', label: null })).toBe('Parceladas');
        expect(reportGroupLabel('recurrence', { key: 'single', label: null })).toBe('Avulsas');
        expect(reportGroupLabel('flow', { key: 'in', label: null })).toBe('Entrada');
        expect(reportGroupLabel('flow', { key: 'out', label: null })).toBe('Saída');
        expect(reportGroupLabel('category', { key: null, label: null })).toBe('Sem categoria');
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
                { key: '2026-08', label: 'ago/2026', cells: [], total: 'R$ 120,00', cellChanges: [], totalChange: null },
                { key: '2026-09', label: 'set/2026', cells: [], total: 'R$ 0,00', cellChanges: [], totalChange: null },
                { key: '2026-10', label: 'out/2026', cells: [], total: 'R$ 2.787,32', cellChanges: [], totalChange: null },
            ],
            columnTotals: [],
            columnTotalChanges: [],
            total: 'R$ 2.907,32',
            totalHeader: 'Soma dos valores',
            footerLabel: 'Total',
        });
        expect(view.chart).toEqual({
            kind: 'line',
            horizontal: false,
            data: [
                { group: '2026-08', label: 'ago', s0: 120 },
                { group: '2026-09', label: 'set', s0: 0 },
                { group: '2026-10', label: 'out', s0: 2787.32 },
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
        expect(view.chart?.data[0]).toEqual({ group: '2026-09', label: 'set', s0: 10, s1: 10, s2: 10, s3: 10, s4: 30 });
        expect(view.chart?.horizontal).toBe(false);
        expect(view.seriesNote).toBe('O gráfico mostra as 4 maiores e junta as demais em "Outros"; a tabela traz todas.');
        expect(view.table.columns).toHaveLength(REPORT_CHART_MAX_SERIES + 2);
        expect(buildReportView(byMonthAndTag(REPORT_CHART_MAX_SERIES), 'bar').seriesNote).toBeNull();
    });

    it('com a janela atravessando anos, cada mês do eixo tem chave própria e o rótulo leva o ano', () => {
        const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01'];
        const result: ReportResultResponse = {
            ...byMonthAndTag(1),
            from: '2026-01',
            to: '2027-01',
            primary: { dimension: 'month', groups: months.map((key) => ({ key, label: null })) },
            secondary: null,
            rows: months.map((key, index) => ({ group: { key, label: null }, cells: [], total: figure(index + 1) })),
            columnTotals: [],
            total: figure(91, 13),
            overlapping: false,
        };
        const data = buildReportView(result, 'bar').chart?.data ?? [];
        expect(data[0]).toEqual({ group: '2026-01', label: 'jan/2026', s0: 1 });
        expect(data[12]).toEqual({ group: '2027-01', label: 'jan/2027', s0: 13 });
        expect(new Set(data.map((point) => point['group'])).size).toBe(months.length);
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

    it('Regra de negócio (Relatórios, L7): a pizza divide os grupos positivos, junta os menores em "Outros" e avisa dos negativos', () => {
        const rows = [['Moradia', 600], ['Mercado', 300], ['Lazer', 50], ['Saúde', 30], ['Roupas', 15], ['Livros', 5], ['Estornos', -20]] as const;
        const result: ReportResultResponse = {
            ...byMonthAndTag(1),
            primary: { dimension: 'category', groups: rows.map(([label]) => ({ key: label, label })) },
            secondary: null,
            rows: rows.map(([label, amount]) => ({ group: { key: label, label }, cells: [], total: figure(amount) })),
            columnTotals: [],
            total: figure(980, rows.length),
            overlapping: false,
        };
        const view = buildReportView(result, 'pie');
        expect(view.chart).toBeNull();
        expect(view.pie?.slices).toEqual([
            { key: 's0', label: 'Moradia', value: 600, share: '60,0%', color: 0 },
            { key: 's1', label: 'Mercado', value: 300, share: '30,0%', color: 1 },
            { key: 's2', label: 'Lazer', value: 50, share: '5,0%', color: 2 },
            { key: 's3', label: 'Saúde', value: 30, share: '3,0%', color: 3 },
            { key: 's4', label: 'Outros', value: 20, share: '2,0%', color: 4 },
        ]);
        expect(view.seriesNote).toMatch(/Outros/);
        expect(view.pieNote).toMatch(/negativa/);
        expect(buildReportView(result, 'bar').pie).toBeNull();
    });

    it('Regra de negócio (Relatórios, L8): a entrada e saída avisa que o total é o líquido, e a pizza usa o tamanho de cada lado', () => {
        const result: ReportResultResponse = {
            ...byMonthAndTag(1),
            primary: { dimension: 'flow', groups: [{ key: 'in', label: null }, { key: 'out', label: null }] },
            secondary: null,
            rows: [{ group: { key: 'in', label: null }, cells: [], total: figure(300, 2) }, { group: { key: 'out', label: null }, cells: [], total: figure(-100, 1) }],
            columnTotals: [],
            total: figure(200, 3),
            overlapping: false,
        };
        expect(buildReportView(result, 'table').flowNote).toMatch(/líquido/);
        const pie = buildReportView(result, 'pie');
        expect(pie.pie?.slices.map((slice) => [slice.label, slice.value, slice.share])).toEqual([['Entrada', 300, '75,0%'], ['Saída', 100, '25,0%']]);
        expect(pie.pieNote).toBeNull();
        expect(buildReportView(byMonthAndTag(2), 'table').flowNote).toBeNull();
    });

    describe('análise (reports-design L9)', () => {
        /**
         * @param primary Dimensão das linhas.
         * @param rows Chave e valor de cada linha, na ordem.
         * @param secondary Colunas: dimensão, grupos e o valor de cada célula por linha.
         * @return Um resultado com essas linhas.
         */
        function grid(
            primary: 'month' | 'flow' | 'category',
            rows: readonly (readonly [string, number])[],
            secondary: { readonly dimension: 'month' | 'flow'; readonly keys: readonly string[]; readonly cells: readonly (readonly number[])[]; readonly totals: readonly number[] } | null = null,
        ): ReportResultResponse {
            const total = rows.reduce((sum, [, amount]) => sum + amount, 0);
            return {
                ...byMonthAndTag(1),
                primary: { dimension: primary, groups: rows.map(([key]) => ({ key, label: key })) },
                secondary: secondary === null ? null : { dimension: secondary.dimension, groups: secondary.keys.map((key) => ({ key, label: null })) },
                rows: rows.map(([key, amount], index) => ({ group: { key, label: key }, cells: (secondary?.cells[index] ?? []).map((cell) => figure(cell)), total: figure(amount) })),
                columnTotals: (secondary?.totals ?? []).map((cell) => figure(cell)),
                total: figure(total, rows.length),
                overlapping: false,
            };
        }

        it('Regra de negócio (Relatórios, L9): com o mês nas linhas, cada valor ganha a variação sobre a linha de cima; sem anterior ou com ele zerado, nada', () => {
            const result = grid('month', [['2026-08', 100], ['2026-09', 0], ['2026-10', 150], ['2026-11', 120], ['2026-12', 120]]);
            const changes = buildReportView(result, 'table', true).table.rows.map((row) => row.totalChange);
            expect(changes).toEqual([
                null,
                { text: '−100,0%', direction: 'down' },
                null,
                { text: '−20,0%', direction: 'down' },
                { text: '0%', direction: 'same' },
            ]);
            expect(buildReportView(result, 'table').table.rows.every((row) => row.totalChange === null)).toBe(true);
        });

        it('Regra de negócio (Relatórios, L9): com o mês nas colunas, a célula e o total da coluna comparam com a coluna à esquerda; a saída que cresce em módulo é redução', () => {
            const result = grid('flow', [['in', 300], ['out', -260]], { dimension: 'month', keys: ['2026-09', '2026-10'], cells: [[100, 200], [-100, -160]], totals: [0, 40] });
            const table = buildReportView(result, 'table', true).table;
            expect(table.rows.map((row) => row.cellChanges)).toEqual([
                [null, { text: '+100,0%', direction: 'up' }],
                [null, { text: '−60,0%', direction: 'down' }],
            ]);
            expect(table.rows.map((row) => row.totalChange)).toEqual([null, null]);
            // O mês anterior somou zero: sem percentual.
            expect(table.columnTotalChanges).toEqual([null, null]);
            expect(table.footerLabel).toBe('Resultado');
        });

        it('Regra de negócio (Relatórios, L9): a entrada e saída mostra o resultado na tabela, no gráfico e na pizza, só na soma', () => {
            const byFlow = grid('flow', [['in', 300], ['out', -100]]);
            const view = buildReportView(byFlow, 'bar', true);
            expect(view.table.footerLabel).toBe('Resultado');
            expect(view.chart?.data.at(-1)).toEqual({ group: 'result', label: 'Resultado', s0: 200 });
            expect(buildReportView(byFlow, 'pie', true).pie?.result).toBe('R$ 200,00');
            expect(buildReportView(byFlow, 'bar').chart?.data).toHaveLength(2);
            expect(buildReportView({ ...byFlow, measure: 'count' }, 'table', true).table.footerLabel).toBe('Total');

            const monthly = grid('month', [['2026-09', 50], ['2026-10', 70]], { dimension: 'flow', keys: ['in', 'out'], cells: [[100, -50], [100, -30]], totals: [200, -80] });
            const chart = buildReportView(monthly, 'line', true).chart;
            expect(chart?.series.map((series) => series.label)).toEqual(['Entrada', 'Saída', 'Resultado']);
            expect(chart?.data.map((point) => point['result'])).toEqual([50, 70]);
            expect(buildReportView(monthly, 'table', true).table.totalHeader).toBe('Resultado');
        });
    });

    it('sem lançamento no filtro, o resultado é vazio', () => {
        const view = buildReportView({ ...byMonthAndTag(0), total: figure(0, 0) }, 'table');
        expect(view.empty).toBe(true);
    });
});
