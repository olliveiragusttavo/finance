import type { CategoryReportResponse, MoneyResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import {
    ALL_CATEGORIES,
    buildCategoryReport,
    buildCategoryTransactionList,
    categoryBreadcrumb,
    categoryChart,
    comparisonOptions,
    openCategoryId,
    resolveCategorySelection,
} from '../src/index.ts';
import { ClientWorld } from './support/ClientWorld.ts';

/**
 * @param amount Valor.
 * @return Dinheiro em BRL como vem do núcleo.
 */
function brl(amount: number): MoneyResponse {
    return { amount, currency: 'BRL' };
}

/**
 * @param amount Gasto do período.
 * @param comparison Gasto da base.
 * @param ratio Variação proporcional; `null` quando a base é zero ("novo").
 * @return Os números de uma linha do relatório, como o núcleo os devolve.
 */
function line(amount: number, comparison: number, ratio: number | null): CategoryReportResponse['total'] {
    return {
        amount: brl(amount),
        comparison: brl(comparison),
        variation: { absolute: brl(amount - comparison), change: ratio === null ? { kind: 'new' } : { kind: 'ratio', ratio } },
    };
}

const CATEGORY_REPORT: CategoryReportResponse = {
    period: '2026-10',
    comparison: { mode: 'lastThreeMonthsAverage', periods: ['2026-09', '2026-08', '2026-07'] },
    categories: [
        {
            categoryId: 'food',
            name: 'Alimentação',
            ...line(1142.5, 980.1, 0.1657),
            subCategories: [
                { subCategoryId: 'market', name: 'Mercado', ...line(487.32, 610, -0.2011) },
                { subCategoryId: 'delivery', name: 'Delivery', ...line(143, 0, null) },
            ],
        },
        {
            categoryId: 'home',
            name: 'Moradia',
            ...line(2300, 2300, 0),
            subCategories: [{ subCategoryId: 'rent', name: 'Aluguel', ...line(2300, 2300, 0) }],
        },
    ],
    total: line(3442.5, 3280.1, 0.0495),
};

describe('tabela do relatório por categoria', () => {
    it('achata a árvore mostrando só as subcategorias das categorias abertas', () => {
        const view = buildCategoryReport(CATEGORY_REPORT, new Set(['food']));
        expect(view.periodLabel).toBe('out/2026');
        expect(view.comparisonLabel).toBe('média jul–set/2026');
        expect(view.rows.map((row) => [row.kind, row.name, row.amount, row.variation.arrow, row.variation.absolute, row.variation.percent])).toEqual([
            ['category', 'Alimentação', 'R$ 1.142,50', '▲', '+R$ 162,40', '+16,6%'],
            ['subCategory', 'Mercado', 'R$ 487,32', '▼', '−R$ 122,68', '−20,1%'],
            ['subCategory', 'Delivery', 'R$ 143,00', '▲', '+R$ 143,00', 'novo'],
            ['category', 'Moradia', 'R$ 2.300,00', '=', 'R$ 0,00', '0%'],
        ]);
        expect(buildCategoryReport(CATEGORY_REPORT, new Set()).rows).toHaveLength(2);
        expect(view.total.variation.percent).toBe('+5,0%');
        expect(view.empty).toBe(false);
        expect(view.periodWithoutExpenses).toBe(false);
    });

    it('marca a linha do nível aberto, e só ela', () => {
        const rows = buildCategoryReport(CATEGORY_REPORT, new Set(['food']), { kind: 'subCategory', subCategoryId: 'market' }).rows;
        expect(rows.filter((row) => row.selected).map((row) => row.name)).toEqual(['Mercado']);
        expect(rows[0]?.target).toEqual({ kind: 'category', categoryId: 'food' });
        const byCategory = buildCategoryReport(CATEGORY_REPORT, new Set(), { kind: 'category', categoryId: 'home' }).rows;
        expect(byCategory.filter((row) => row.selected).map((row) => row.name)).toEqual(['Moradia']);
    });

    it('a média que atravessa a virada do ano mostra o ano de cada ponta', () => {
        const report: CategoryReportResponse = { ...CATEGORY_REPORT, period: '2026-02', comparison: { mode: 'lastThreeMonthsAverage', periods: ['2026-01', '2025-12', '2025-11'] } };
        expect(buildCategoryReport(report, new Set()).comparisonLabel).toBe('média nov/2025–jan/2026');
    });

    it('distingue o relatório vazio do mês sem gasto que só tem linhas pela comparação', () => {
        const none: CategoryReportResponse = { ...CATEGORY_REPORT, categories: [], total: line(0, 0, 0) };
        expect(buildCategoryReport(none, new Set())).toEqual(expect.objectContaining({ empty: true, periodWithoutExpenses: false }));
        const onlyBefore: CategoryReportResponse = {
            ...CATEGORY_REPORT,
            categories: [{ categoryId: 'home', name: 'Moradia', ...line(0, 2300, -1), subCategories: [{ subCategoryId: 'rent', name: 'Aluguel', ...line(0, 2300, -1) }] }],
            total: line(0, 2300, -1),
        };
        expect(buildCategoryReport(onlyBefore, new Set())).toEqual(expect.objectContaining({ empty: false, periodWithoutExpenses: true }));
        // Regra de negócio (Relatórios): estorno não é despesa — o mês só com estorno também avisa.
        const onlyRefund: CategoryReportResponse = {
            ...CATEGORY_REPORT,
            categories: [{ categoryId: 'food', name: 'Alimentação', ...line(-30, 120, -1.25), subCategories: [{ subCategoryId: 'restaurants', name: 'Restaurantes', ...line(-30, 120, -1.25) }] }],
            total: line(-30, 120, -1.25),
        };
        expect(buildCategoryReport(onlyRefund, new Set())).toEqual(expect.objectContaining({ empty: false, periodWithoutExpenses: true }));
    });

    it('rotula o seletor de comparação como o mockup', () => {
        expect(comparisonOptions('2026-01').map((option) => option.label)).toEqual([
            'Mês anterior (dez/2025)', 'Mesmo mês do ano anterior', 'Média dos últimos 3 meses',
        ]);
    });
});

describe('drill-down do relatório por categoria', () => {
    it('resolve o nível pelo relatório e volta à raiz quando o id sumiu', () => {
        const sub = resolveCategorySelection(CATEGORY_REPORT, { kind: 'subCategory', subCategoryId: 'market' });
        expect(sub.kind === 'subCategory' ? [sub.category.name, sub.subCategory.name] : []).toEqual(['Alimentação', 'Mercado']);
        expect(openCategoryId(sub)).toBe('food');
        expect(resolveCategorySelection(CATEGORY_REPORT, { kind: 'category', categoryId: 'sumiu' })).toEqual({ kind: 'all' });
        expect(resolveCategorySelection(CATEGORY_REPORT, { kind: 'subCategory', subCategoryId: 'sumiu' })).toEqual({ kind: 'all' });
        expect(openCategoryId(resolveCategorySelection(CATEGORY_REPORT, ALL_CATEGORIES))).toBeNull();
    });

    it('monta a trilha da raiz até o nível aberto', () => {
        const labels = (selection: Parameters<typeof resolveCategorySelection>[1]): readonly string[] =>
            categoryBreadcrumb(resolveCategorySelection(CATEGORY_REPORT, selection)).map((item) => item.label);
        expect(labels({ kind: 'subCategory', subCategoryId: 'market' })).toEqual(['Todas as categorias', 'Alimentação', 'Mercado']);
        expect(labels({ kind: 'category', categoryId: 'home' })).toEqual(['Todas as categorias', 'Moradia']);
        expect(labels({ kind: 'category', categoryId: 'sumiu' })).toEqual(['Todas as categorias']);
    });

    it('o gráfico mostra as categorias na raiz e as subcategorias abaixo, cada barra abrindo o nível seguinte', () => {
        const root = categoryChart(resolveCategorySelection(CATEGORY_REPORT, ALL_CATEGORIES), CATEGORY_REPORT);
        expect(root.title).toBe('Despesas por categoria');
        expect(root.bars.map((bar) => [bar.name, bar.amountText, bar.comparisonText])).toEqual([
            ['Alimentação', 'R$ 1.142,50', 'R$ 980,10'],
            ['Moradia', 'R$ 2.300,00', 'R$ 2.300,00'],
        ]);
        expect(root.bars[0]?.target).toEqual({ kind: 'category', categoryId: 'food' });
        expect(root.hint).toContain('clique para descer um nível');

        const food = categoryChart(resolveCategorySelection(CATEGORY_REPORT, { kind: 'category', categoryId: 'food' }), CATEGORY_REPORT);
        expect(food.title).toBe('Alimentação por subcategoria');
        expect(food.bars.map((bar) => bar.target)).toEqual([
            { kind: 'subCategory', subCategoryId: 'market' },
            { kind: 'subCategory', subCategoryId: 'delivery' },
        ]);
        expect(food.bars.some((bar) => bar.selected)).toBe(false);
    });

    it('na subcategoria, o gráfico mostra as irmãs com a selecionada em destaque', () => {
        const chart = categoryChart(resolveCategorySelection(CATEGORY_REPORT, { kind: 'subCategory', subCategoryId: 'delivery' }), CATEGORY_REPORT);
        expect(chart.title).toBe('Alimentação por subcategoria');
        expect(chart.bars.map((bar) => [bar.name, bar.selected])).toEqual([['Mercado', false], ['Delivery', true]]);
        expect(chart.hint).toContain('clique para trocar de subcategoria');
        expect(chart.hasNegative).toBe(false);
    });

    it('Regra de negócio (Relatórios, R2): subcategoria só com estorno desenha a barra negativa', () => {
        const report: CategoryReportResponse = {
            ...CATEGORY_REPORT,
            categories: [{ categoryId: 'food', name: 'Alimentação', ...line(-20, 0, null), subCategories: [{ subCategoryId: 'market', name: 'Mercado', ...line(-20, 0, null) }] }],
        };
        const chart = categoryChart(resolveCategorySelection(report, { kind: 'category', categoryId: 'food' }), report);
        expect(chart.hasNegative).toBe(true);
        expect(chart.bars[0]?.amountText).toBe('−R$ 20,00');
    });
});

describe('lista de lançamentos do drill-down', () => {
    /**
     * Cenário padrão mais um jantar com tag e o estorno dele em Restaurantes, os dois pagos em
     * outubro pela Nubank.
     *
     * @param world Núcleo do teste.
     * @return Os ids do cenário e as fontes da lista de outubro.
     */
    async function octoberScenario(world: ClientWorld): Promise<{ readonly s: Awaited<ReturnType<ClientWorld['seed']>>; readonly source: Parameters<typeof buildCategoryTransactionList>[1] }> {
        const s = await world.seed();
        const base = { profileId: s.profileId, subCategoryId: s.otherSubCategoryId, type: 'expense', source: { kind: 'account', accountId: s.checkingId } } as const;
        await world.ok('transactions.create', { ...base, name: 'Jantar', value: 80, dueDate: '2026-10-12', paymentDate: '2026-10-12', tagIds: [s.tagId] });
        await world.ok('transactions.create', { ...base, name: 'Estorno jantar', value: -30, dueDate: '2026-10-14', paymentDate: '2026-10-14' });
        const [accounts, creditCards, categories, tags] = await Promise.all([
            world.ok('accounts.list', { profileId: s.profileId, period: '2026-10' }),
            world.ok('creditCards.list', { profileId: s.profileId, period: '2026-10' }),
            world.ok('categories.tree', { profileId: s.profileId }),
            world.ok('tags.list', { profileId: s.profileId }),
        ]);
        return { s, source: { profileId: s.profileId, accounts: accounts.accounts, creditCards: creditCards.creditCards, categories, tags } };
    }

    it('Regra de negócio (Relatórios, R1): lista pelo mês do pagamento, com a compra de agosto da fatura paga em outubro', async () => {
        const world = new ClientWorld();
        const { s, source } = await octoberScenario(world);
        const response = await world.ok('reports.categoryTransactions', { profileId: s.profileId, period: '2026-10', categoryId: s.categoryId });
        const list = buildCategoryTransactionList(response, source);
        // O Supermercado de 06/10 cai na fatura de novembro, em aberto: conta em novembro.
        expect(list.rows.map((row) => [row.date, row.name, row.category, row.container, row.amountText])).toEqual([
            ['20/08', 'Feira', 'Alimentação › Mercado', 'Roxinho · fat. set', '−R$ 120,00'],
            ['05/10', 'Aluguel', 'Alimentação › Mercado', 'Nubank', '−R$ 2.300,00'],
            ['12/10', 'Jantar', 'Alimentação › Restaurantes', 'Nubank', '−R$ 80,00'],
            ['14/10', 'Estorno jantar', 'Alimentação › Restaurantes', 'Nubank', '+R$ 30,00'],
        ]);
        expect(list.totalText).toBe('−R$ 2.470,00');
    });

    it('a subcategoria traz só os dela, com as tags e o estorno abatendo o total (R2)', async () => {
        const world = new ClientWorld();
        const { s, source } = await octoberScenario(world);
        const response = await world.ok('reports.categoryTransactions', { profileId: s.profileId, period: '2026-10', subCategoryId: s.otherSubCategoryId });
        const list = buildCategoryTransactionList(response, source);
        expect(list.rows.map((row) => [row.name, row.tags, row.direction])).toEqual([
            ['Jantar', ['viagem'], 'out'],
            ['Estorno jantar', [], 'in'],
        ]);
        expect(list.totalText).toBe('−R$ 50,00');
    });

    it('a subcategoria sem lançamento no mês lista nada e o total zerado fica sem sinal', async () => {
        const world = new ClientWorld();
        const { s, source } = await octoberScenario(world);
        const response = await world.ok('reports.categoryTransactions', { profileId: s.profileId, period: '2026-09', subCategoryId: s.otherSubCategoryId });
        const list = buildCategoryTransactionList(response, source);
        expect(list.rows).toEqual([]);
        expect(list.totalText).toBe('R$ 0,00');
    });
});
