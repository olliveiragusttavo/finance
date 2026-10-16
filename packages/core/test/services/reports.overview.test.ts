import { describe, expect, it } from 'vitest';
import { TestWorld } from '../support/TestWorld.ts';

/**
 * Perfil com uma conta e dois cartões: o Roxinho fecha no dia 28 e vence no dia 10; o Click
 * fecha no dia 1 e vence no dia 7. Hoje é 15/10/2026.
 *
 * @return O mundo e os ids semeados.
 */
function setup(): { world: TestWorld; profileId: string; accountId: string; roxinho: string; click: string; base: { profileId: string; subCategoryId: string } } {
    const world = new TestWorld('2026-10-15');
    const profileId = world.profile();
    const accountId = world.account(profileId, { openingBalance: 1000 });
    return {
        world,
        profileId,
        accountId,
        roxinho: world.creditCard(profileId, accountId, 28, 10),
        click: world.creditCard(profileId, accountId, 1, 7),
        base: { profileId, subCategoryId: world.subCategory(profileId) },
    };
}

describe('Visão geral — indicadores do mês (reports.monthSummary)', () => {
    it('receitas e despesas pelo mês do pagamento, com variação e faturas em aberto que vencem no mês', async () => {
        const { world, profileId, accountId, roxinho, click, base } = setup();
        const account = { kind: 'account', accountId } as const;
        await world.create(base, { source: account, type: 'income', value: 9500, charges: 10, dueDate: '2026-10-05', paymentDate: '2026-10-05' });
        await world.create(base, { source: account, value: 1000, dueDate: '2026-10-10', paymentDate: '2026-10-10' });
        await world.create(base, { source: account, value: 2000, dueDate: '2026-09-10', paymentDate: '2026-09-10' });
        // Roxinho: fatura de setembro, em aberto, vence 10/10. Click: fatura de outubro, vence 07/10.
        await world.create(base, { source: { kind: 'creditCard', creditCardId: roxinho }, value: 2449.75, dueDate: '2026-09-05' });
        await world.create(base, { source: { kind: 'creditCard', creditCardId: click }, value: 612.3, dueDate: '2026-09-15' });
        // Fatura de agosto do Click (vence 07/08) paga em outubro: pesa em outubro, mas não está em aberto.
        await world.create(base, { source: { kind: 'creditCard', creditCardId: click }, value: 55.9, dueDate: '2026-07-20' });
        await world.payInvoice(click, '2026-08', '2026-10-01');

        const summary = await world.ok('reports.monthSummary', { profileId, period: '2026-10' });

        expect(summary.income).toEqualMoney('9490');
        expect(summary.incomeCount).toBe(1);
        // 1000 + 2449,75 + 612,30 + 55,90 = 4117,95.
        expect(summary.expenses).toEqualMoney('4117.95');
        expect(summary.expenseCount).toBe(4);
        expect(summary.previousExpenses).toEqualMoney('2000');
        expect(summary.expenseVariation.absolute).toEqualMoney('2117.95');
        expect(summary.openInvoices.amountDue).toEqualMoney('3062.05');
        expect(summary.openInvoices.invoices).toBe(2);
        expect(summary.openInvoices.creditCards).toBe(2);
        expect(summary.openInvoices.nextDueDate).toBe('2026-10-07');

        // As despesas da Visão geral e o total do relatório por categoria vêm da mesma fonte.
        const byCategory = await world.ok('reports.byCategory', { profileId, period: '2026-10' });
        expect(byCategory.total.amount).toEqualMoney('4117.95');
    });

    it('mês sem nada: zeros, variação zero e nenhum vencimento', async () => {
        const { world, profileId } = setup();
        const summary = await world.ok('reports.monthSummary', { profileId, period: '2026-10' });
        expect(summary.expenses).toEqualMoney('0');
        expect(summary.expenseVariation.change).toEqual({ kind: 'ratio', ratio: 0 });
        expect(summary.openInvoices).toEqual({ amountDue: { amount: 0, currency: 'BRL' }, invoices: 0, creditCards: 0, nextDueDate: null });
    });

    it('perfil inexistente é NOT_FOUND', async () => {
        const { world } = setup();
        const error = await world.failure('reports.monthSummary', { profileId: world.ids.random(), period: '2026-10' });
        expect(error.code).toBe('NOT_FOUND');
    });
});

describe('Visão geral — evolução do saldo (reports.balanceEvolution)', () => {
    it('lê os fechamentos dos extratos, repete o anterior em mês sem movimento e soma só contas do total', async () => {
        const { world, profileId, accountId, base } = setup();
        const outside = world.account(profileId, { openingBalance: 500, considerBalance: false });
        const late = world.account(profileId, { openingBalance: 50 });
        const account = { kind: 'account', accountId } as const;
        await world.create(base, { source: account, value: 100, dueDate: '2026-07-10', paymentDate: '2026-07-10' });
        await world.create(base, { source: account, value: 200, dueDate: '2026-09-10' });
        await world.create(base, { source: { kind: 'account', accountId: outside }, value: 70, dueDate: '2026-08-10', paymentDate: '2026-08-10' });
        await world.create(base, { source: { kind: 'account', accountId: late }, type: 'income', value: 25, dueDate: '2026-10-01', paymentDate: '2026-10-01' });

        const evolution = await world.ok('reports.balanceEvolution', { profileId, period: '2026-10' });

        // Conta principal: 1000 até jun; 900 de jul em diante; previsto 700 a partir de set.
        // Conta que só movimentou em outubro: 50 até set, 75 em out. A conta fora do total não soma.
        expect(evolution.points.map((point) => point.period)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
        const expected = [['1050', '1050'], ['1050', '1050'], ['950', '950'], ['950', '950'], ['950', '750'], ['975', '775']];
        evolution.points.forEach((point, index) => {
            expect(point.closing.consolidated).toEqualMoney(expected[index]?.[0] ?? '');
            expect(point.closing.projected).toEqualMoney(expected[index]?.[1] ?? '');
        });
    });

    it('começa a janela depois do último extrato: usa o fechamento anterior à janela', async () => {
        const { world, profileId, accountId, base } = setup();
        await world.create(base, { source: { kind: 'account', accountId }, value: 400, dueDate: '2026-01-10', paymentDate: '2026-01-10' });

        const evolution = await world.ok('reports.balanceEvolution', { profileId, period: '2026-10', months: 3 });
        expect(evolution.points.map((point) => point.period)).toEqual(['2026-08', '2026-09', '2026-10']);
        for (const point of evolution.points) {
            expect(point.closing.consolidated).toEqualMoney('600');
        }
    });

    it('conta excluída sai da série', async () => {
        const { world, profileId, base } = setup();
        const doomed = world.account(profileId, { openingBalance: 300 });
        await world.create(base, { source: { kind: 'account', accountId: doomed }, value: 10, dueDate: '2026-10-01', paymentDate: '2026-10-01' });
        await world.ok('accounts.delete', { id: doomed });

        const evolution = await world.ok('reports.balanceEvolution', { profileId, period: '2026-10', months: 1 });
        expect(evolution.points[0]?.closing.consolidated).toEqualMoney('1000');
    });

    it('recusa série vazia ou longa demais', async () => {
        const { world, profileId } = setup();
        expect((await world.failure('reports.balanceEvolution', { profileId, period: '2026-10', months: 0 })).code).toBe('VALIDATION_FAILED');
        expect((await world.failure('reports.balanceEvolution', { profileId, period: '2026-10', months: 25 })).code).toBe('VALIDATION_FAILED');
    });
});
