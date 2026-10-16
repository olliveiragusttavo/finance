import { describe, expect, it } from 'vitest';
import { TestWorld } from '../support/TestWorld.ts';

/**
 * Perfil com duas contas e um cartão em cada: o Roxinho (fecha 3, vence 10) pago pela Nubank e o
 * Azul (fecha 25, vence 5) pago pelo Itaú. Existe para que cada caso declare só as compras.
 *
 * @return O mundo e os ids semeados.
 */
function setup(): { world: TestWorld; profileId: string; nubank: string; itau: string; roxinho: string; azul: string; subCategoryId: string } {
    const world = new TestWorld('2026-03-15');
    const profileId = world.profile();
    const nubank = world.account(profileId, { openingBalance: 1000, name: 'Nubank' });
    const itau = world.account(profileId, { openingBalance: 1000, name: 'Itaú' });
    const roxinho = world.creditCard(profileId, nubank, 3, 10);
    const azul = world.creditCard(profileId, itau, 25, 5);
    return { world, profileId, nubank, itau, roxinho, azul, subCategoryId: world.subCategory(profileId) };
}

describe('faturas do perfil no mês (statements.profileInvoices)', () => {
    it('Regra de negócio (Transações): a paga conta no dia do pagamento e a em aberto no vencimento, como no extrato', async () => {
        const { world, profileId, nubank, itau, roxinho, azul, subCategoryId } = setup();
        const card = (creditCardId: string) => ({ kind: 'creditCard', creditCardId }) as const;
        await world.create({ profileId, subCategoryId }, { source: card(roxinho), value: 120, dueDate: '2026-01-20' });
        await world.create({ profileId, subCategoryId }, { source: card(roxinho), value: 200, dueDate: '2026-02-10' });
        await world.create({ profileId, subCategoryId }, { source: card(azul), value: 80, dueDate: '2026-03-01' });
        // A fatura de fevereiro (vence 10/02) foi paga com atraso, em março.
        await world.payInvoice(roxinho, '2026-02', '2026-03-02');
        // Pagamento parcial da fatura de março: o valor que falta é o líquido dele.
        await world.ok('transactions.create', {
            profileId,
            subCategoryId,
            type: 'transference',
            source: { kind: 'creditCard', creditCardId: roxinho, invoicePeriod: '2026-03' },
            destinationAccountId: nubank,
            name: 'Pagamento parcial',
            value: -50,
            dueDate: '2026-03-08',
            paymentDate: '2026-03-08',
        });

        const march = await world.ok('statements.profileInvoices', { profileId, period: '2026-03' });
        expect(march.map((invoice) => [invoice.period, invoice.status, invoice.cashDate, invoice.accountName, invoice.balance.amount])).toEqual([
            ['2026-02', 'paid', '2026-03-02', 'Nubank', -120],
            ['2026-03', 'open', '2026-03-10', 'Nubank', -150],
        ]);
        // O Azul fecha dia 25: a compra de 01/03 vence em 05/04.
        const april = await world.ok('statements.profileInvoices', { profileId, period: '2026-04' });
        expect(april.map((invoice) => [invoice.creditCardId, invoice.cashDate, invoice.accountId])).toEqual([[azul, '2026-04-05', itau]]);
        // Paga em março, a fatura de fevereiro sai de fevereiro.
        expect(await world.ok('statements.profileInvoices', { profileId, period: '2026-02' })).toEqual([]);
    });

    it('concorda com as faturas dos extratos de todas as contas', async () => {
        const { world, profileId, nubank, itau, roxinho, azul, subCategoryId } = setup();
        await world.create({ profileId, subCategoryId }, { source: { kind: 'creditCard', creditCardId: roxinho }, value: 90, dueDate: '2026-02-20' });
        await world.create({ profileId, subCategoryId }, { source: { kind: 'creditCard', creditCardId: azul }, value: 60, dueDate: '2026-02-20' });
        await world.payInvoice(azul, '2026-02', '2026-03-04');

        const listed = await world.ok('statements.profileInvoices', { profileId, period: '2026-03' });
        const statements = await Promise.all([nubank, itau].map((accountId) => world.ok('statements.get', { accountId, period: '2026-03' })));
        const fromStatements = statements.flatMap((statement) => [...statement.paidInvoices, ...statement.openInvoicesDue].map((invoice) => invoice.id));
        expect(listed.map((invoice) => invoice.id).sort()).toEqual([...fromStatements].sort());
        expect(listed).toHaveLength(2);
    });

    it('perfil inexistente é NOT_FOUND', async () => {
        const { world } = setup();
        const error = await world.failure('statements.profileInvoices', { profileId: '99999999-9999-4999-8999-999999999999', period: '2026-03' });
        expect(error.code).toBe('NOT_FOUND');
    });
});
