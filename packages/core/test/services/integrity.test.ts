import { describe, expect, it } from 'vitest';
import { TestWorld } from '../support/TestWorld.ts';

/** O mundo do cenário e os ids que os testes corrompem ou conferem. */
interface Scenario {
    readonly world: TestWorld;
    readonly accountId: string;
    readonly creditCardId: string;
    readonly base: { readonly profileId: string; readonly subCategoryId: string };
}

/**
 * Um mês com o que alimenta todos os caches de saldo: transação de conta paga e em aberto,
 * compra no cartão e a fatura paga pela conta — extrato, fatura e cache da conta.
 *
 * @return O mundo já coerente, como o deixam os Services.
 */
async function scenario(): Promise<Scenario> {
    const world = new TestWorld('2026-03-15');
    const profileId = world.profile();
    const accountId = world.account(profileId, { openingBalance: 1000 });
    const creditCardId = world.creditCard(profileId, accountId, 10, 17);
    const base = { profileId, subCategoryId: world.subCategory(profileId) };
    await world.create(base, { source: { kind: 'account', accountId }, type: 'income', value: 5000, dueDate: '2026-02-05', paymentDate: '2026-02-05' });
    await world.create(base, { source: { kind: 'account', accountId }, value: 300, dueDate: '2026-03-20' });
    const purchase = await world.create(base, { source: { kind: 'creditCard', creditCardId }, value: 450, dueDate: '2026-02-20' });
    if (purchase.container.kind !== 'invoice') {
        throw new Error('compra no cartão deveria cair numa fatura');
    }
    await world.ok('invoices.pay', { invoiceId: purchase.container.invoiceId, paymentDate: '2026-03-17' });
    return { world, accountId, creditCardId, base };
}

describe('verificação de integridade na abertura (database-design §3.7)', () => {
    it('banco gravado pelos Services não tem desvio', async () => {
        const { world } = await scenario();

        const report = await world.ok('integrity.verifyBalances', {});

        expect(report).toEqual({ checkedAccounts: 1, drifts: [] });
    });

    it('acusa o saldo de extrato adulterado e não o corrige em silêncio', async () => {
        const { world, accountId } = await scenario();
        world.database.run(
            `UPDATE bank_statements SET closing_balance = closing_balance + 10 WHERE account_id = :accountId AND year = 2026 AND month = 2`,
            { accountId },
        );

        const report = await world.ok('integrity.verifyBalances', {});

        // O fechamento de fevereiro é a única coluna gravada errada; o recálculo o refaz a
        // partir das transações e a abertura de março, que já estava certa, não diverge.
        expect(report.drifts).toEqual([expect.objectContaining({
            accountId,
            subject: 'statement',
            period: '2026-02',
            field: 'closingConsolidated',
            cached: { amount: 6010, currency: 'BRL' },
            recalculated: { amount: 6000, currency: 'BRL' },
        })]);
        expect(world.statementRow(accountId, '2026-02')?.closing).toEqualMoney('6010');
    });

    it('acusa o total de fatura adulterado', async () => {
        const { world, accountId, creditCardId } = await scenario();
        world.database.run(`UPDATE invoices SET balance = -1 WHERE credit_card_id = :creditCardId`, { creditCardId });

        const report = await world.ok('integrity.verifyBalances', {});

        expect(report.drifts).toEqual([expect.objectContaining({
            accountId,
            subject: 'invoice',
            field: 'total',
            cached: { amount: -1, currency: 'BRL' },
            recalculated: { amount: -450, currency: 'BRL' },
        })]);
        expect(world.invoiceRow(creditCardId, '2026-03')?.balance).toEqualMoney('-1');
    });

    it('acusa o mês com movimento que ficou sem extrato', async () => {
        const { world, accountId } = await scenario();
        world.database.run(
            `UPDATE bank_statements SET deleted_at = '2026-03-15 12:00:00' WHERE account_id = :accountId AND year = 2026 AND month = 3`,
            { accountId },
        );

        const report = await world.ok('integrity.verifyBalances', {});

        expect(report.drifts).toContainEqual(expect.objectContaining({ subject: 'statement', period: '2026-03', field: 'closingProjected', cached: null }));
        expect(world.statementRow(accountId, '2026-03')).toBeUndefined();
    });

    it('acusa o cache da conta adulterado mesmo com os extratos certos', async () => {
        const { world, accountId } = await scenario();
        world.database.run(`UPDATE accounts SET balance = balance + 10 WHERE id = :accountId`, { accountId });

        const report = await world.ok('integrity.verifyBalances', {});

        // Só o lado consolidado foi adulterado; o previsto continua no fechamento de março.
        expect(report.drifts).toEqual([expect.objectContaining({
            accountId,
            subject: 'account',
            field: 'consolidated',
            cached: { amount: 5560, currency: 'BRL' },
            recalculated: { amount: 5550, currency: 'BRL' },
        })]);
    });

    it('o extrato adulterado do mês corrente não arrasta a conta que exibe o valor certo', async () => {
        const { world, accountId } = await scenario();
        world.database.run(
            `UPDATE bank_statements SET closing_balance = closing_balance + 10 WHERE account_id = :accountId AND year = 2026 AND month = 3`,
            { accountId },
        );

        const report = await world.ok('integrity.verifyBalances', {});

        expect(report.drifts).toEqual([expect.objectContaining({ subject: 'statement', period: '2026-03', field: 'closingConsolidated' })]);
    });

    it('a virada do mês não é desvio: o cache da conta ainda aponta o mês anterior', async () => {
        const { world, accountId, base } = await scenario();
        await world.create(base, { source: { kind: 'account', accountId }, type: 'income', value: 50, dueDate: '2026-04-02', paymentDate: '2026-04-02' });
        world.clock.set('2026-04-10');

        const report = await world.ok('integrity.verifyBalances', {});

        expect(report.drifts).toEqual([]);
    });
});
