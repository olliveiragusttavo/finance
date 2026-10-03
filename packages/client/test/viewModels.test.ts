import type { CardImpactResponse, CategoryReportResponse, CreditCardResponse, MoneyResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import {
    buildCardImpactGrid,
    buildCategoryReport,
    buildTransactionTable,
    categoryBreadcrumb,
    categoryChartBars,
    comparisonOptions,
    NO_TRANSACTION_FILTERS,
    type TransactionTableSource,
} from '../src/index.ts';
import { ClientWorld, type Scenario } from './support/ClientWorld.ts';

/**
 * @param amount Valor.
 * @return Dinheiro em BRL como vem do núcleo.
 */
function brl(amount: number): MoneyResponse {
    return { amount, currency: 'BRL' };
}

/**
 * Lê do núcleo de verdade tudo que a tela de Transações tem em cache.
 *
 * @param world Núcleo do teste.
 * @param s Ids do cenário.
 * @return A fonte da tabela de outubro.
 */
async function transactionSource(world: ClientWorld, s: Scenario): Promise<TransactionTableSource> {
    const [transactions, accounts, creditCards, categories, cycles] = await Promise.all([
        world.ok('transactions.listByPeriod', { profileId: s.profileId, period: '2026-10' }),
        world.ok('accounts.list', { profileId: s.profileId, period: '2026-10' }),
        world.ok('creditCards.list', { profileId: s.profileId, period: '2026-10' }),
        world.ok('categories.tree', { profileId: s.profileId }),
        world.ok('invoices.listByCard', { creditCardId: s.creditCardId, from: '2026-08' }),
    ]);
    return {
        transactions,
        accounts: accounts.accounts,
        creditCards: creditCards.creditCards,
        categories,
        invoices: cycles.flatMap((cycle) => (cycle.invoice === null ? [] : [cycle.invoice])),
    };
}

describe('tabela de Transações', () => {
    it('junta nomes, sinais e situação como no mockup, e soma o resultado sem transferências', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        await world.ok('transactions.create', {
            profileId: s.profileId, subCategoryId: s.otherSubCategoryId, type: 'expense', source: { kind: 'creditCard', creditCardId: s.creditCardId }, name: 'Estorno Uber', value: -23.9, dueDate: '2026-10-09',
        });
        const table = buildTransactionTable(await transactionSource(world, s), NO_TRANSACTION_FILTERS);

        expect(table.rows.map((row) => [row.date, row.name, row.category, row.container, row.amountText, row.situationText])).toEqual([
            ['01/10', 'Salário', 'Alimentação › Mercado', 'Nubank', '+R$ 9.500,00', 'Pago'],
            ['05/10', 'Aluguel', 'Alimentação › Mercado', 'Nubank', '−R$ 2.300,00', 'Pendente'],
            ['06/10', 'Supermercado', 'Alimentação › Mercado', 'Roxinho · fat. nov', '−R$ 487,32', 'Na fatura'],
            ['09/10', 'Estorno Uber', 'Alimentação › Restaurantes', 'Roxinho · fat. nov', '+R$ 23,90', 'Na fatura'],
            ['10/10', 'Aporte', 'Alimentação › Mercado', 'Nubank → Tesouro', '⇄ R$ 500,00', 'Pendente'],
        ]);
        expect(table.rows.find((row) => row.name === 'Estorno Uber')?.refund).toBe(true);
        expect(table.summary).toBe('5 lançamentos · resultado +R$ 6.736,58');
    });

    it('marca a compra de fatura paga como "Fat. paga"', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        await world.ok('invoices.pay', { invoiceId: s.openInvoiceId, paymentDate: '2026-11-09' });
        const table = buildTransactionTable(await transactionSource(world, s), NO_TRANSACTION_FILTERS);
        expect(table.rows.find((row) => row.name === 'Supermercado')?.situationText).toBe('Fat. paga');
    });

    it('filtra por conta (incluindo o que chega nela), cartão, categoria, situação e busca sem acento', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const source = await transactionSource(world, s);
        const names = (filters: Partial<typeof NO_TRANSACTION_FILTERS>): readonly string[] =>
            buildTransactionTable(source, { ...NO_TRANSACTION_FILTERS, ...filters }).rows.map((row) => row.name);

        expect(names({ container: { kind: 'account', accountId: s.savingsId } })).toEqual(['Aporte']);
        expect(names({ container: { kind: 'creditCard', creditCardId: s.creditCardId } })).toEqual(['Supermercado']);
        expect(names({ category: { kind: 'subCategory', subCategoryId: s.otherSubCategoryId } })).toEqual([]);
        expect(names({ category: { kind: 'category', categoryId: s.categoryId } })).toHaveLength(4);
        expect(names({ situation: 'pending' })).toEqual(['Aluguel', 'Aporte']);
        expect(names({ search: '  SALARIO ' })).toEqual(['Salário']);
        expect(buildTransactionTable(source, { ...NO_TRANSACTION_FILTERS, search: 'nada' }).summary).toBe('Nenhum lançamento');
    });

    it('usa o singular com um lançamento', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        expect(buildTransactionTable(await transactionSource(world, s), { ...NO_TRANSACTION_FILTERS, search: 'aluguel' }).summary)
            .toBe('1 lançamento · resultado −R$ 2.300,00');
    });
});

/** Linha do relatório por categoria. */
const line = (amount: number, comparison: number, ratio: number | null): CategoryReportResponse['total'] => ({
    amount: brl(amount),
    comparison: brl(comparison),
    variation: { absolute: brl(amount - comparison), change: ratio === null ? { kind: 'new' } : { kind: 'ratio', ratio } },
});

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
        { categoryId: 'home', name: 'Moradia', ...line(2300, 2300, 0), subCategories: [] },
    ],
    total: line(3442.5, 3280.1, 0.0495),
};

describe('relatório por categoria', () => {
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
    });

    it('a média que atravessa a virada do ano mostra o ano de cada ponta', () => {
        const report: CategoryReportResponse = { ...CATEGORY_REPORT, period: '2026-02', comparison: { mode: 'lastThreeMonthsAverage', periods: ['2026-01', '2025-12', '2025-11'] } };
        expect(buildCategoryReport(report, new Set()).comparisonLabel).toBe('média nov/2025–jan/2026');
    });

    it('rotula o seletor de comparação como o mockup', () => {
        expect(comparisonOptions('2026-01').map((option) => option.label)).toEqual([
            'Mês anterior (dez/2025)', 'Mesmo mês do ano anterior', 'Média dos últimos 3 meses',
        ]);
    });

    it('dimensiona as barras do gráfico pela maior entre período e comparação', () => {
        const food = CATEGORY_REPORT.categories[0];
        expect(food).toBeDefined();
        const [market, delivery] = food === undefined ? [] : categoryChartBars(food);
        expect(market?.comparisonShare).toBe(1);
        expect(market?.amountShare).toBeCloseTo(487.32 / 610);
        expect(delivery?.comparisonShare).toBe(0);
    });

    it('monta a trilha até a subcategoria e encurta quando o id sumiu do relatório', () => {
        expect(categoryBreadcrumb(CATEGORY_REPORT, { kind: 'subCategory', subCategoryId: 'market' }).map((item) => item.label))
            .toEqual(['Todas as categorias', 'Alimentação', 'Mercado']);
        expect(categoryBreadcrumb(CATEGORY_REPORT, { kind: 'category', categoryId: 'sumiu' })).toHaveLength(1);
    });
});

const CARD: CreditCardResponse = { id: 'card', profileId: 'p', accountId: 'acc', name: 'Nubank Roxinho', limit: brl(5000), closingDay: 3, dueDay: 10, disabled: false };

/**
 * @param period Mês.
 * @param weight Peso do mês.
 * @param invoices Faturas da célula do cartão.
 * @return Um mês da grade.
 */
function month(period: string, weight: number | null, invoices: CardImpactResponse['months'][number]['cells'][number]['invoices']): CardImpactResponse['months'][number] {
    const total = brl(invoices.reduce((sum, invoice) => sum + invoice.total.amount, 0));
    return { period, cells: [{ creditCardId: 'card', invoices, total }], total, income: brl(weight === null ? 0 : 9500), weight };
}

const CARD_IMPACT: CardImpactResponse = {
    period: '2026-10',
    creditCards: [CARD],
    months: [
        month('2026-07', 0.366, [{ invoiceId: 'i7', invoicePeriod: '2026-07', total: brl(2890), situation: { kind: 'paid', paidIn: '2026-07' } }]),
        month('2026-08', null, []),
        month('2026-09', 0.338, [{ invoiceId: 'i9', invoicePeriod: '2026-09', total: brl(2611.25), situation: { kind: 'paid', paidIn: '2026-09' } }]),
        month('2026-10', 0.322, [
            { invoiceId: 'i9b', invoicePeriod: '2026-09', total: brl(100), situation: { kind: 'paid', paidIn: '2026-10' } },
            { invoiceId: 'i10', invoicePeriod: '2026-10', total: brl(2449.75), situation: { kind: 'open', dueDate: '2026-10-10' } },
        ]),
        month('2026-11', 0.097, [{ invoiceId: 'i11', invoicePeriod: '2026-11', total: brl(863.42), situation: { kind: 'future', dueDate: '2026-11-10' } }]),
    ],
    reference: { total: brl(2549.75), creditCards: 1, unpaid: 1, weight: 0.322, income: brl(9500) },
    previousAverage: { total: brl(1833.75), weight: null },
};

describe('grade do impacto do cartão', () => {
    it('nomeia a conta pagadora no cabeçalho e descreve cada situação como o mockup', () => {
        const grid = buildCardImpactGrid(CARD_IMPACT, [{ id: 'acc', name: 'Nubank' }]);
        expect(grid.columns).toEqual([{ creditCardId: 'card', title: 'Nubank Roxinho · paga com Nubank', disabled: false }]);
        expect(grid.rows.map((row) => [row.label, row.isReference, row.isNext, row.cells[0]?.amount, row.cells[0]?.notes.map((note) => `${note.text} (${note.tone})`), row.weight])).toEqual([
            ['jul/2026', false, false, 'R$ 2.890,00', ['paga no extrato de jul (muted)'], '36,6%'],
            ['ago/2026', false, false, '', [], '—'],
            ['set/2026', false, false, 'R$ 2.611,25', ['paga no extrato de set (muted)'], '33,8%'],
            ['out/2026', true, false, 'R$ 2.549,75', ['paga no extrato de out (ok)', 'Em aberto · vence 10/10 (warn)'], '32,2%'],
            ['nov/2026', false, true, 'R$ 863,42', ['Futura (neutral)'], '9,7%'],
        ]);
    });

    it('Regra de negócio (Relatórios, C3): sem receita o peso é "—", nunca 0% nem ∞', () => {
        const grid = buildCardImpactGrid(CARD_IMPACT, []);
        expect(grid.rows[1]?.weightShare).toBeNull();
        expect(grid.kpis).toEqual({
            invoices: { label: 'Faturas de out/2026', value: 'R$ 2.549,75', sub: '1 cartão · 1 em aberto' },
            weight: { label: 'Peso nas entradas do mês', value: '32,2%', sub: 'das entradas de R$ 9.500,00' },
            average: { label: 'Média dos 3 meses anteriores', value: 'R$ 1.833,75', sub: 'sem entradas no período' },
        });
    });

    it('sinaliza o perfil sem cartão para a tela mostrar o estado vazio', () => {
        expect(buildCardImpactGrid({ ...CARD_IMPACT, creditCards: [] }, []).empty).toBe(true);
    });
});
