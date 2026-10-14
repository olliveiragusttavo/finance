import type { MoneyResponse, TagCategoryResponse, TagReportResponse, TagSummaryResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { buildTagDetail, buildTagList, buildTagTransactionList, openTag, tagContainers } from '../src/index.ts';
import { ClientWorld } from './support/ClientWorld.ts';

/**
 * @param amount Valor.
 * @return Dinheiro em BRL como vem do núcleo.
 */
function brl(amount: number): MoneyResponse {
    return { amount, currency: 'BRL' };
}

/** A tag do mockup `DesktopRelTag`: só despesas, em três categorias, de setembro a outubro. */
const TRIP: TagSummaryResponse = {
    tagId: 'trip',
    name: 'viagem-floripa',
    expense: brl(1400),
    income: brl(0),
    net: brl(1400),
    count: 8,
    firstPeriod: '2026-09',
    lastPeriod: '2026-10',
    categories: [
        { categoryId: 'transport', name: 'Transporte', expense: brl(620), income: brl(0), net: brl(620), count: 3, share: 0.4429 },
        { categoryId: 'shopping', name: 'Compras', expense: brl(400), income: brl(0), net: brl(400), count: 3, share: 0.2857 },
        { categoryId: 'food', name: 'Alimentação', expense: brl(380), income: brl(0), net: brl(380), count: 2, share: 0.2714 },
    ],
};

/** Uma tag em que o reembolso supera o gasto. */
const REFUNDABLE: TagSummaryResponse = {
    tagId: 'refundable',
    name: 'reembolsável',
    expense: brl(300),
    income: brl(342.6),
    net: brl(-42.6),
    count: 1,
    firstPeriod: '2026-10',
    lastPeriod: '2026-10',
    categories: [
        { categoryId: 'transport', name: 'Transporte', expense: brl(300), income: brl(0), net: brl(300), count: 1, share: 1 },
        { categoryId: 'refunds', name: 'Reembolsos', expense: brl(0), income: brl(342.6), net: brl(-342.6), count: 1, share: null },
    ],
};

const REPORT: TagReportResponse = { period: '2026-10', range: 'all', tags: [TRIP, REFUNDABLE] };

describe('lista do relatório por tag', () => {
    it('itens com contagens no singular e no plural e o líquido com o sentido', () => {
        expect(buildTagList(REPORT)).toEqual([
            { tagId: 'trip', name: 'viagem-floripa', detail: '8 lançamentos · 3 categorias', amount: 'R$ 1.400,00' },
            { tagId: 'refundable', name: 'reembolsável', detail: '1 lançamento · 2 categorias', amount: '+R$ 42,60' },
        ]);
    });

    it('a tag da URL fica aberta; sem ela, ou fora do período, abre a primeira', () => {
        expect(openTag(REPORT, 'refundable')?.tagId).toBe('refundable');
        expect(openTag(REPORT, undefined)?.tagId).toBe('trip');
        expect(openTag(REPORT, 'sumiu')?.tagId).toBe('trip');
        expect(openTag({ ...REPORT, tags: [] }, 'trip')).toBeNull();
    });
});

describe('detalhe da tag', () => {
    it('sem receita: "Total gasto" com o intervalo de meses, categorias nomeadas e participação', () => {
        const detail = buildTagDetail(TRIP, 'all', { accounts: 2, creditCards: 1 });
        expect(detail.kpis.total).toEqual({ label: 'Total gasto', value: 'R$ 1.400,00', sub: 'set/2026 a out/2026' });
        expect(detail.kpis.count).toEqual({ label: 'Lançamentos', value: '8', sub: 'em 2 contas e 1 cartão' });
        expect(detail.kpis.categories).toEqual({ label: 'Categorias envolvidas', value: '3', sub: 'Transporte, Compras, Alimentação' });
        expect(detail.categories.map((category) => [category.name, category.amount, category.percent])).toEqual([
            ['Transporte', 'R$ 620,00', '44%'],
            ['Compras', 'R$ 400,00', '29%'],
            ['Alimentação', 'R$ 380,00', '27%'],
        ]);
        expect(detail.total).toEqual({ amount: 'R$ 1.400,00', percent: '100%' });
        expect(detail.hasNegative).toBe(false);
    });

    it('com receita: "Total líquido" explica as duas partes; a categoria da receita sai como entrada e sem participação', () => {
        const detail = buildTagDetail(REFUNDABLE, 'month', null);
        expect(detail.kpis.total).toEqual({ label: 'Total líquido', value: '+R$ 42,60', sub: 'R$ 300,00 em despesas − R$ 342,60 em receitas' });
        expect(detail.kpis.count.sub).toBe('');
        expect(detail.categories[1]).toMatchObject({ name: 'Reembolsos', amount: '+R$ 342,60', percent: '—', share: null, chartAmount: -342.6 });
        expect(detail.hasNegative).toBe(true);
    });

    it('mais de três categorias resumem o resto', () => {
        const extra = (categoryId: string, name: string): TagCategoryResponse => ({ categoryId, name, expense: brl(10), income: brl(0), net: brl(10), count: 1, share: 0.01 });
        const many: TagSummaryResponse = { ...TRIP, categories: [...TRIP.categories, extra('a', 'Lazer'), extra('b', 'Saúde')] };
        expect(buildTagDetail(many, 'month', { accounts: 0, creditCards: 3 }).kpis).toMatchObject({
            categories: { sub: 'Transporte, Compras, Alimentação e mais 2' },
            count: { sub: 'em 3 cartões' },
            total: { sub: 'set/2026' },
        });
    });
});

describe('lançamentos da tag, contra o núcleo real', () => {
    it('conta contas e cartões, soma o total líquido e põe o ano na data de "todo o período"', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        await world.ok('transactions.create', {
            profileId: s.profileId,
            subCategoryId: s.subCategoryId,
            type: 'expense',
            source: { kind: 'account', accountId: s.checkingId },
            name: 'Pousada',
            value: 600,
            dueDate: '2026-12-05',
            tagIds: [s.tagId],
        });
        const [accounts, creditCards, categories, tags] = await Promise.all([
            world.ok('accounts.list', { profileId: s.profileId, period: '2026-10' }),
            world.ok('creditCards.list', { profileId: s.profileId, period: '2026-10' }),
            world.ok('categories.tree', { profileId: s.profileId }),
            world.ok('tags.list', { profileId: s.profileId }),
        ]);
        const source = { profileId: s.profileId, accounts: accounts.accounts, creditCards: creditCards.creditCards, categories, tags };

        const all = await world.ok('reports.tagTransactions', { profileId: s.profileId, period: '2026-10', range: 'all', tagId: s.tagId });
        expect(tagContainers(all)).toEqual({ accounts: 1, creditCards: 1 });
        const list = buildTagTransactionList(all, 'all', source);
        expect(list.rows.map((row) => [row.name, row.date])).toEqual([
            ['Supermercado', '06/10/2026'],
            ['Pousada', '05/12/2026'],
        ]);
        expect(list.totalText).toBe('−R$ 1.087,32');

        const month = await world.ok('reports.tagTransactions', { profileId: s.profileId, period: '2026-10', range: 'month', tagId: s.tagId });
        expect(buildTagTransactionList(month, 'month', source).rows.map((row) => row.date)).toEqual([]);
        const report = await world.ok('reports.byTag', { profileId: s.profileId, period: '2026-10', range: 'all' });
        expect(report.tags[0]?.net).toEqual(all.total);
    });
});
