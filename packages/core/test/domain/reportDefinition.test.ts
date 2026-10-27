import { describe, expect, it } from 'vitest';
import { ReportFilter, type ReportFilterProps } from '../../src/domain/report/ReportFilter.ts';
import { ReportLayout, type ReportLayoutProps } from '../../src/domain/report/ReportLayout.ts';
import { buildReportResult, type ReportAggregateRow, type ReportAggregation } from '../../src/domain/report/ReportResult.ts';
import { Currency } from '../../src/domain/shared/Currency.ts';
import { BusinessRuleViolation } from '../../src/domain/shared/errors.ts';
import { TagId } from '../../src/domain/shared/ids.ts';
import { YearMonth } from '../../src/domain/shared/YearMonth.ts';

const BRL = Currency.of('BRL');
const TAG = TagId('00000000-0000-4000-8000-000000000001');

/**
 * @param overrides Campos que o teste quer fixar.
 * @return As props de um filtro sem restrição, no mês de referência e só nele.
 */
function filterProps(overrides: Partial<ReportFilterProps> = {}): ReportFilterProps {
    return {
        period: { anchor: { kind: 'reference' }, previousMonths: 0, basis: 'payment' },
        types: [],
        categoryIds: [],
        subCategoryIds: [],
        accountIds: [],
        creditCardIds: [],
        tagIds: [],
        tagMatch: 'any',
        partnerIds: [],
        goalIds: [],
        status: 'all',
        minValue: null,
        maxValue: null,
        ...overrides,
    };
}

/**
 * @param overrides Campos que o teste quer fixar.
 * @return Um formato de tabela agrupado pela categoria, somando o valor.
 */
function layout(overrides: Partial<ReportLayoutProps> = {}): ReportLayout {
    return ReportLayout.create({ format: 'table', primary: 'category', secondary: null, measure: 'sum', analysis: false, ...overrides });
}

/**
 * @param keys Chave de cada dimensão da linha; o rótulo é a própria chave.
 * @param total Soma da linha.
 * @param count Quantidade da linha.
 * @return Uma linha de somas como o banco devolve.
 */
function row(keys: readonly (string | null)[], total: number, count = 1): ReportAggregateRow {
    return { groups: keys.map((key) => ({ key, label: key })), total, count };
}

/**
 * @param overrides Níveis de agrupamento que o teste quer fixar.
 * @return Somas vazias, completadas pelo teste.
 */
function aggregation(overrides: Partial<ReportAggregation>): ReportAggregation {
    return { cells: [], primaryTotals: [], secondaryTotals: [], grandTotal: { total: 0, count: 0 }, ...overrides };
}

describe('janela do relatório (reports-design §2.1)', () => {
    it('Regra de negócio (Relatórios, F1 e F2): termina no mês de referência e volta os meses anteriores, virando o ano', () => {
        const filter = ReportFilter.create(filterProps({ period: { anchor: { kind: 'reference' }, previousMonths: 2, basis: 'due' } }));
        const window = filter.windowFor(YearMonth.parse('2026-01'));
        expect([window.from.toString(), window.to.toString()]).toEqual(['2025-11', '2026-01']);
    });

    it('o mês fixo ignora o mês de referência', () => {
        const filter = ReportFilter.create(filterProps({ period: { anchor: { kind: 'fixed', month: YearMonth.parse('2025-12') }, previousMonths: 11, basis: 'payment' } }));
        const window = filter.windowFor(YearMonth.parse('2026-10'));
        expect([window.from.toString(), window.to.toString()]).toEqual(['2025-01', '2025-12']);
    });

    it('aceita de 0 a 35 meses anteriores e recusa fora disso', () => {
        expect(() => ReportFilter.create(filterProps({ period: { anchor: { kind: 'reference' }, previousMonths: 35, basis: 'payment' } }))).not.toThrow();
        expect(() => ReportFilter.create(filterProps({ period: { anchor: { kind: 'reference' }, previousMonths: 36, basis: 'payment' } }))).toThrow(/meses anteriores/);
        expect(() => ReportFilter.create(filterProps({ period: { anchor: { kind: 'reference' }, previousMonths: 1.5, basis: 'payment' } }))).toThrow(/meses anteriores/);
    });
});

describe('filtro e formato', () => {
    it('recusa o valor mínimo acima do máximo e aceita os dois iguais', () => {
        expect(() => ReportFilter.create(filterProps({ minValue: 100, maxValue: 50 }))).toThrow(/máximo/);
        expect(ReportFilter.create(filterProps({ minValue: 50, maxValue: 50 })).maxValue).toBe(50);
    });

    it('tira as repetições das listas', () => {
        const filter = ReportFilter.create(filterProps({ types: ['expense', 'expense', 'income'], tagIds: [TAG, TAG] }));
        expect(filter.types).toEqual(['expense', 'income']);
        expect(filter.tagIds).toEqual([TAG]);
    });

    it('Regra de negócio (Relatórios, L5): principal e secundária não podem ser a mesma dimensão', () => {
        const repeated = (): ReportLayout => layout({ primary: 'tag', secondary: 'tag' });
        expect(repeated).toThrow(BusinessRuleViolation);
        expect(repeated).toThrow(/repete a principal/);
        expect(layout({ primary: 'tag', secondary: 'month' }).dimensions()).toEqual(['tag', 'month']);
    });
});

describe('montagem do resultado (reports-design §3)', () => {
    const window = { from: YearMonth.parse('2026-08'), to: YearMonth.parse('2026-10') };

    it('Regra de negócio (Relatórios, Ordem): o mês traz todos os meses da janela, inclusive os sem lançamento', () => {
        const months = [row(['2026-08'], 100), row(['2026-10'], 50)];
        const result = buildReportResult(layout({ primary: 'month', format: 'line' }), window, aggregation({ cells: months, primaryTotals: months, grandTotal: { total: 150, count: 2 } }), BRL);
        expect(result.rows.map((line) => [line.group.key, line.total.total.amount])).toEqual([
            ['2026-08', 100],
            ['2026-09', 0],
            ['2026-10', 50],
        ]);
        expect(result.total.total.amount).toBe(150);
    });

    it('os grupos vão do maior valor absoluto para o menor, com o grupo "sem" por último', () => {
        const rows = [row([null], 900), row(['Mercado'], 200), row(['Estornos'], -500), row(['Aluguel'], 200)];
        const result = buildReportResult(layout({ primary: 'tag' }), window, aggregation({ cells: rows, primaryTotals: rows }), BRL);
        expect(result.rows.map((line) => line.group.key)).toEqual(['Estornos', 'Aluguel', 'Mercado', null]);
    });

    it('com a quantidade como medida, ordena pela quantidade', () => {
        const rows = [row(['Mercado'], 900, 1), row(['Padaria'], 30, 12)];
        const result = buildReportResult(layout({ measure: 'count' }), window, aggregation({ cells: rows, primaryTotals: rows }), BRL);
        expect(result.rows.map((line) => line.group.key)).toEqual(['Padaria', 'Mercado']);
    });

    it('tipo, situação e recorrência seguem a ordem do domínio, não a do valor', () => {
        const types = [row(['investment'], 1000), row(['expense'], 10), row(['income'], 5)];
        const byType = buildReportResult(layout({ primary: 'type' }), window, aggregation({ cells: types, primaryTotals: types }), BRL);
        expect(byType.rows.map((line) => line.group.key)).toEqual(['income', 'expense', 'investment']);
        const status = [row(['open'], 1000), row(['paid'], 10)];
        const byStatus = buildReportResult(layout({ primary: 'status' }), window, aggregation({ cells: status, primaryTotals: status }), BRL);
        expect(byStatus.rows.map((line) => line.group.key)).toEqual(['paid', 'open']);
        const recurrence = [row(['single'], 1000), row(['installments'], 10), row(['fixed'], 5)];
        const byRecurrence = buildReportResult(layout({ primary: 'recurrence' }), window, aggregation({ cells: recurrence, primaryTotals: recurrence }), BRL);
        expect(byRecurrence.rows.map((line) => line.group.key)).toEqual(['fixed', 'installments', 'single']);
    });

    it('com secundária, completa as combinações sem lançamento com zero e põe cada total no lugar', () => {
        const result = buildReportResult(
            layout({ primary: 'category', secondary: 'month', format: 'bar' }),
            window,
            aggregation({
                cells: [row(['Mercado', '2026-08'], 100), row(['Mercado', '2026-10'], 40), row(['Aluguel', '2026-09'], 1500)],
                primaryTotals: [row(['Mercado'], 140, 2), row(['Aluguel'], 1500)],
                secondaryTotals: [row(['2026-08'], 100), row(['2026-09'], 1500), row(['2026-10'], 40)],
                grandTotal: { total: 1640, count: 3 },
            }),
            BRL,
        );
        expect(result.secondary?.groups.map((group) => group.key)).toEqual(['2026-08', '2026-09', '2026-10']);
        expect(result.rows.map((line) => [line.group.key, line.cells.map((cell) => cell.total.amount), line.total.total.amount, line.total.count])).toEqual([
            ['Aluguel', [0, 1500, 0], 1500, 1],
            ['Mercado', [100, 0, 40], 140, 2],
        ]);
        expect(result.columnTotals.map((cell) => cell.total.amount)).toEqual([100, 1500, 40]);
        expect(result.overlapping).toBe(false);
    });

    it('marca a sobreposição quando a tag é uma das dimensões, e o total geral vem do banco', () => {
        const rows = [row(['viagem'], 300), row(['trabalho'], 300)];
        const result = buildReportResult(layout({ primary: 'month', secondary: 'tag' }), window, aggregation({ cells: [], primaryTotals: [], secondaryTotals: rows, grandTotal: { total: 300, count: 1 } }), BRL);
        expect(result.overlapping).toBe(true);
        expect(result.total.total.amount).toBe(300);
    });
});
