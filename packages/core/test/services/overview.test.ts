import { describe, expect, it } from 'vitest';
import { buildSpendingSummary, TOP_CATEGORIES, type CategorySpending } from '../../src/domain/overview/SpendingSummary.ts';
import { Currency } from '../../src/domain/shared/Currency.ts';
import { CategoryId } from '../../src/domain/shared/ids.ts';
import { Money, YearMonth, type CoreOutput } from '../../src/index.ts';
import { TestWorld } from '../support/TestWorld.ts';

/** Ids do cenário da Visão geral. */
interface Scene {
    readonly world: TestWorld;
    readonly profileId: string;
    readonly creditCardId: string;
    readonly crossfitId: string;
    readonly incomingId: string;
}

/**
 * Cenário de 27/10/2026, numa conta corrente (Inter) com um cartão (fecha dia 5 e vence
 * dia 15, então a fatura de cada competência vence no próprio mês) e uma carteira:
 * - julho: despesa paga de R$ 1.000,00; agosto: despesa de R$ 50,00 vencida em 01/08 e nunca paga;
 * - cartão: compra de R$ 120,00 na fatura de setembro (vence 15/09), paga **com atraso** em 02/10;
 *   compra de R$ 300,00 na fatura de outubro (vence 15/10), em aberto; compra de R$ 40,00 na de
 *   novembro (vence 15/11);
 * - outubro: aluguel pago de R$ 800,00 e conta de R$ 200,00 em aberto para 30/10 (Moradia);
 *   crossfit de R$ 150,00 vencido em 11/10 (Saúde); salário pago de R$ 5.000,00; cashback de
 *   R$ 6,00 vencido em 10/10; transferência paga de R$ 1.000,00 de outro perfil e outra de
 *   R$ 300,00, em aberto, para 20/10; transferência interna de R$ 100,00 para a carteira, em
 *   aberto, para 28/10;
 * - novembro: despesa de R$ 90,00 para 05/11, fora do painel do mês.
 *
 * @return O cenário.
 */
async function scene(): Promise<Scene> {
    const world = new TestWorld('2026-10-27');
    const profileId = world.profile();
    const inter = world.account(profileId, { name: 'Inter' });
    const wallet = world.account(profileId, { name: 'Carteira' });
    const creditCardId = world.creditCard(profileId, inter, 5, 15);
    const other = world.profile();
    const otherAccount = world.account(other, { name: 'Empresa' });
    const otherSub = world.subCategory(other);
    const housing = world.namedSubCategory(profileId, 'Moradia', 'Aluguel').subCategoryId;
    const health = world.namedSubCategory(profileId, 'Saúde', 'Academia').subCategoryId;
    const food = world.namedSubCategory(profileId, 'Alimentação', 'Mercado').subCategoryId;
    const salary = world.namedSubCategory(profileId, 'Renda', 'Salário').subCategoryId;
    const account = { kind: 'account', accountId: inter } as const;
    /**
     * @param invoicePeriod Competência da fatura em que a compra entra.
     * @return A origem da compra no cartão.
     */
    const card = (invoicePeriod: string) => ({ kind: 'creditCard', creditCardId, invoicePeriod }) as const;
    await world.create({ profileId, subCategoryId: housing }, { source: account, value: 1000, dueDate: '2026-07-10', paymentDate: '2026-07-10' });
    await world.create({ profileId, subCategoryId: housing }, { source: account, name: 'Antiga', value: 50, dueDate: '2026-08-01' });
    await world.create({ profileId, subCategoryId: food }, { source: card('2026-09'), value: 120, dueDate: '2026-08-10' });
    await world.payInvoice(creditCardId, '2026-09', '2026-10-02');
    await world.create({ profileId, subCategoryId: food }, { source: card('2026-10'), value: 300, dueDate: '2026-09-10' });
    await world.create({ profileId, subCategoryId: food }, { source: card('2026-11'), value: 40, dueDate: '2026-10-20' });
    await world.create({ profileId, subCategoryId: housing }, { source: account, name: 'Aluguel', value: 800, dueDate: '2026-10-05', paymentDate: '2026-10-05' });
    await world.create({ profileId, subCategoryId: housing }, { source: account, name: 'Energia', value: 200, dueDate: '2026-10-30' });
    const crossfit = await world.create({ profileId, subCategoryId: health }, { source: account, name: 'Crossfit', value: 150, dueDate: '2026-10-11' });
    await world.create({ profileId, subCategoryId: salary }, { source: account, type: 'income', name: 'Salário', value: 5000, dueDate: '2026-10-05', paymentDate: '2026-10-05' });
    await world.create({ profileId, subCategoryId: salary }, { source: account, type: 'income', name: 'Cashback', value: 6, dueDate: '2026-10-10' });
    const otherSource = { kind: 'account', accountId: otherAccount } as const;
    await world.create({ profileId: other, subCategoryId: otherSub }, { source: otherSource, type: 'transference', name: 'Pró-labore', value: 1000, dueDate: '2026-10-06', paymentDate: '2026-10-06', destinationAccountId: inter });
    const incoming = await world.create({ profileId: other, subCategoryId: otherSub }, { source: otherSource, type: 'transference', name: 'Distribuição', value: 300, dueDate: '2026-10-20', destinationAccountId: inter });
    await world.create({ profileId, subCategoryId: housing }, { source: account, type: 'transference', name: 'Reserva', value: 100, dueDate: '2026-10-28', destinationAccountId: wallet });
    await world.create({ profileId, subCategoryId: housing }, { source: account, name: 'Novembro', value: 90, dueDate: '2026-11-05' });
    return { world, profileId, creditCardId, crossfitId: crossfit.id, incomingId: incoming.id };
}

/**
 * Resumo de um item em aberto, para comparar a lista com `toEqual` sem repetir os ids.
 *
 * @param item Item da rota.
 * @return Nome, vencimento, sentido, valor e se pode ser marcado como pago.
 */
function line(item: CoreOutput<'overview.pending'>['overdue'][number]): readonly unknown[] {
    return [item.name, item.dueDate, item.direction, item.amount.amount, item.kind === 'transaction' ? item.canMarkPaid : 'fatura'];
}

describe('Visão geral (mockup DesktopVisaoGeral2)', () => {
    it('Regra de negócio (Visão geral): gastos pelo regime de caixa, com a compra no cartão no mês do vencimento da fatura', async () => {
        const s = await scene();
        const spending = await s.world.ok('overview.spending', { profileId: s.profileId, period: '2026-10' });
        // A fatura de setembro foi paga em outubro, mas os R$ 120,00 contam em setembro, o mês do vencimento.
        expect(spending.months.map((month) => [month.period, month.expenses.amount])).toEqual([
            ['2026-05', 0],
            ['2026-06', 0],
            ['2026-07', 1000],
            ['2026-08', 50],
            ['2026-09', 120],
            ['2026-10', 1450],
        ]);
        // A média começa em julho, o primeiro mês com gasto da janela.
        expect(spending.average?.amount).toBe(655);
        expect(spending.expenses.amount).toBe(1450);
        expect(spending.categories.map((category) => [category.name, category.amount.amount])).toEqual([
            ['Moradia', 1000],
            ['Alimentação', 300],
            ['Saúde', 150],
        ]);
        expect(spending.others).toEqual({ count: 0, amount: { amount: 0, currency: 'BRL' } });
    });

    it('Regra de negócio (Visão geral): entradas são as receitas e as transferências de outro perfil, sem as internas', async () => {
        const s = await scene();
        const spending = await s.world.ok('overview.spending', { profileId: s.profileId, period: '2026-10' });
        // 5.000 + 6 de receitas e 1.000 + 300 vindos do outro perfil; a reserva de R$ 100,00 para a carteira não é entrada.
        expect(spending.income.amount).toBe(6306);
    });

    it('Regra de negócio (Visão geral): atrasado é o que venceu antes de hoje, de qualquer mês, e a fatura entra inteira', async () => {
        const s = await scene();
        const pending = await s.world.ok('overview.pending', { profileId: s.profileId });
        expect(pending.today).toBe('2026-10-27');
        expect(pending.until).toBe('2026-10-31');
        expect(pending.overdue.map(line)).toEqual([
            ['Antiga', '2026-08-01', 'out', 50, true],
            ['Cashback', '2026-10-10', 'in', 6, true],
            ['Crossfit', '2026-10-11', 'out', 150, true],
            ['Cartão', '2026-10-15', 'out', 300, 'fatura'],
            // Transferência de outro perfil: só para ver, quem a paga é a origem.
            ['Distribuição', '2026-10-20', 'in', 300, false],
        ]);
        expect(pending.overdueTotals.toPay.amount).toBe(500);
        expect(pending.overdueTotals.toReceive.amount).toBe(306);
        // A transferência interna aparece, mas não é a pagar nem a receber; novembro fica fora.
        expect(pending.upcoming.map(line)).toEqual([
            ['Reserva', '2026-10-28', 'transfer', 100, true],
            ['Energia', '2026-10-30', 'out', 200, true],
        ]);
        expect(pending.upcomingTotals.toPay.amount).toBe(200);
        expect(pending.upcomingTotals.toReceive.amount).toBe(0);
        const invoice = pending.overdue.find((item) => item.kind === 'invoice');
        expect(invoice?.kind === 'invoice' && [invoice.creditCardId, invoice.period, invoice.where]).toEqual([s.creditCardId, '2026-10', 'Inter']);
        expect(pending.overdue.find((item) => item.id === s.incomingId)?.where).toBe('Empresa → Inter');
    });

    it('Regra de negócio (Visão geral): marcar como pago tira do selo, e desmarcar devolve', async () => {
        const s = await scene();
        await s.world.ok('transactions.setPaid', { id: s.crossfitId, paid: true });
        const paid = await s.world.ok('overview.pending', { profileId: s.profileId });
        expect(paid.overdue.map((item) => item.name)).not.toContain('Crossfit');
        expect(paid.overdueTotals.toPay.amount).toBe(350);
        await s.world.ok('transactions.setPaid', { id: s.crossfitId, paid: false });
        const undone = await s.world.ok('overview.pending', { profileId: s.profileId });
        expect(undone.overdue.map((item) => item.name)).toContain('Crossfit');
    });

    it('Regra de negócio (Visão geral): a próxima fatura de cada cartão é a primeira em aberto que vence de hoje em diante', async () => {
        const s = await scene();
        const next = await s.world.ok('overview.nextInvoices', { profileId: s.profileId });
        // A de outubro venceu e está no selo de atrasados; a de setembro está paga.
        expect(next.invoices.map((invoice) => [invoice.creditCardId, invoice.period, invoice.dueDate, invoice.amount.amount])).toEqual([[s.creditCardId, '2026-11', '2026-11-15', 40]]);
    });

    it('perfil sem movimento: sem média, sem categorias e sem itens em aberto', async () => {
        const world = new TestWorld('2026-10-27');
        const profileId = world.profile();
        world.account(profileId);
        const spending = await world.ok('overview.spending', { profileId, period: '2026-10' });
        expect(spending.average).toBeNull();
        expect(spending.categories).toEqual([]);
        const pending = await world.ok('overview.pending', { profileId });
        expect([pending.overdue, pending.upcoming]).toEqual([[], []]);
        expect((await world.ok('overview.nextInvoices', { profileId })).invoices).toEqual([]);
    });

    it('Regra de negócio (Visão geral): as maiores categorias pelo nome, as demais em "outras", sem as zeradas ou negativas', () => {
        const currency = Currency.of('BRL');
        /**
         * @param name Nome da categoria, também a base do id.
         * @param amount Despesas da categoria no mês.
         * @param index Posição, para um id único.
         * @return A categoria com o gasto.
         */
        const category = (name: string, amount: number, index: number): CategorySpending => ({
            categoryId: CategoryId(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`),
            name,
            amount: Money.of(amount, currency),
        });
        const summary = buildSpendingSummary({
            period: YearMonth.of(2026, 10),
            expensesByMonth: [],
            income: Money.zero(currency),
            categories: [10, 70, 20, 50, 0, 40, 60, -5, 30].map((amount, index) => category(`C${String(amount)}`, amount, index)),
            currency,
        });
        expect(summary.categories).toHaveLength(TOP_CATEGORIES);
        expect(summary.categories.map((entry) => entry.name)).toEqual(['C70', 'C60', 'C50', 'C40', 'C30']);
        expect([summary.others.count, summary.others.amount.amount]).toEqual([2, 30]);
    });
});
