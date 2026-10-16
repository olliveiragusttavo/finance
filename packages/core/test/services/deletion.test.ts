import { describe, expect, it } from 'vitest';
import type { CoreOutput } from '../../src/index.ts';
import { TestWorld } from '../support/TestWorld.ts';

/**
 * @param world Mundo do teste.
 * @param table Tabela conferida.
 * @return Quantas linhas da tabela têm soft delete — lido direto do banco, sem passar pelo
 * código testado, para conferir que a exclusão apagou exatamente o que o alerta contou.
 */
function deletedRows(world: TestWorld, table: string): number {
    const row = world.database.get(`SELECT count(*) AS n FROM ${table} WHERE deleted_at IS NOT NULL`);
    return typeof row?.['n'] === 'number' ? row['n'] : -1;
}

/**
 * @param transaction Compra lançada num cartão.
 * @return O id da fatura em que ela caiu.
 */
function invoiceOf(transaction: CoreOutput<'transactions.create'>): string {
    if (transaction.container.kind !== 'invoice') {
        throw new Error('compra no cartão deveria cair numa fatura');
    }
    return transaction.container.invoiceId;
}

/**
 * O cenário da Fase 1.2: a conta A transfere para B, recebe de B e paga um cartão em cuja
 * fatura B fez um pagamento parcial. Excluir A precisa devolver a B o saldo que B teria sem
 * nenhuma dessas interações.
 *
 * @return O mundo, o perfil, as contas e o cartão do cenário.
 */
async function accountScenario(): Promise<{ world: TestWorld; profileId: string; a: string; b: string; bystander: string; creditCardId: string }> {
    const world = new TestWorld('2026-03-15');
    const profileId = world.profile();
    const base = { profileId, subCategoryId: world.subCategory(profileId) };
    const a = world.account(profileId, { openingBalance: 1000, name: 'Conta A' });
    const b = world.account(profileId, { openingBalance: 500, name: 'Conta B' });
    const bystander = world.account(profileId, { openingBalance: 70, name: 'Conta C' });
    const creditCardId = world.creditCard(profileId, a, 10, 17);

    await world.create(base, { source: { kind: 'account', accountId: b }, value: 50, dueDate: '2026-03-02', paymentDate: '2026-03-02' });
    await world.create(base, { source: { kind: 'account', accountId: bystander }, value: 20, dueDate: '2026-03-02', paymentDate: '2026-03-02' });
    await world.create(base, { source: { kind: 'account', accountId: a }, type: 'transference', destinationAccountId: b, value: 200, dueDate: '2026-03-05', paymentDate: '2026-03-05' });
    await world.create(base, { source: { kind: 'account', accountId: b }, type: 'transference', destinationAccountId: a, value: 30, dueDate: '2026-03-06', paymentDate: '2026-03-06' });
    const purchase = await world.create(base, { source: { kind: 'creditCard', creditCardId }, value: 300, dueDate: '2026-02-05' });
    await world.create(base, {
        source: { kind: 'creditCard', creditCardId, invoicePeriod: '2026-02' },
        type: 'transference',
        destinationAccountId: b,
        value: -80,
        dueDate: '2026-02-20',
        paymentDate: '2026-02-20',
    });
    await world.ok('invoices.pay', { invoiceId: invoiceOf(purchase), paymentDate: '2026-03-01' });
    return { world, profileId, a, b, bystander, creditCardId };
}

/**
 * Cartão pago por A com a fatura de fevereiro paga num extrato de A e, depois, a conta
 * pagadora trocada para B: a fatura paga continua pesando em A, que não é mais a pagadora.
 * É o cenário em que a exclusão precisa refazer uma conta além da pagadora atual.
 *
 * @return O mundo, as contas e o cartão do cenário.
 */
async function payerChangedScenario(): Promise<{ world: TestWorld; a: string; b: string; creditCardId: string }> {
    const world = new TestWorld('2026-03-15');
    const profileId = world.profile();
    const base = { profileId, subCategoryId: world.subCategory(profileId) };
    const a = world.account(profileId, { openingBalance: 1000, name: 'Conta A' });
    const b = world.account(profileId, { openingBalance: 500, name: 'Conta B' });
    const creditCardId = world.creditCard(profileId, a, 10, 17);
    const purchase = await world.create(base, { source: { kind: 'creditCard', creditCardId }, value: 300, dueDate: '2026-02-05' });
    await world.ok('invoices.pay', { invoiceId: invoiceOf(purchase), paymentDate: '2026-03-01' });
    await world.ok('creditCards.update', { id: creditCardId, accountId: b, name: 'Cartão', limit: 10000, closingDay: 10, dueDay: 17 });
    return { world, a, b, creditCardId };
}

describe('excluir conta em cadeia (desktop-mvp-plan §5.1)', () => {
    it('o alerta conta cada item e nomeia só as outras contas cujo saldo muda', async () => {
        const { world, a, b } = await accountScenario();

        const impact = await world.ok('accounts.deletionImpact', { id: a });

        expect(impact).toMatchObject({
            accountId: a,
            transactions: 1,
            creditCards: 1,
            invoices: 1,
            cardTransactions: 2,
            incomingTransfers: 1,
            affectedAccounts: [{ id: b, name: 'Conta B' }],
        });
        expect(impact.statements).toBeGreaterThan(0);
        // O alerta não grava nada.
        expect(deletedRows(world, 'transactions')).toBe(0);
    });

    it('apaga exatamente o que o alerta contou e devolve o saldo da outra conta', async () => {
        const { world, profileId, a, b, bystander } = await accountScenario();
        // B: 500 − 50 + 200 (de A) − 30 (para A) − 80 (parcial no cartão de A).
        expect(world.accountRow(b).balance).toEqualMoney('540');
        const bystanderBefore = world.statementRow(bystander, '2026-03');
        const impact = await world.ok('accounts.deletionImpact', { id: a });

        await world.ok('accounts.delete', { id: a });

        expect(deletedRows(world, 'accounts')).toBe(1);
        expect(deletedRows(world, 'bank_statements')).toBe(impact.statements);
        expect(deletedRows(world, 'credit_cards')).toBe(impact.creditCards);
        expect(deletedRows(world, 'invoices')).toBe(impact.invoices);
        expect(deletedRows(world, 'transactions')).toBe(impact.transactions + impact.cardTransactions + impact.incomingTransfers);

        expect(world.accountRow(b).balance).toEqualMoney('450');
        expect(world.statementRow(b, '2026-03')?.closing).toEqualMoney('450');
        expect(world.statementRow(bystander, '2026-03')).toEqual(bystanderBefore);
        expect((await world.ok('integrity.verifyBalances', {})).drifts).toEqual([]);

        const list = await world.ok('accounts.list', { profileId, period: '2026-03' });
        expect(list.accounts.map((account) => account.name)).toEqual(['Conta B', 'Conta C']);
        expect((await world.failure('accounts.delete', { id: a })).code).toBe('NOT_FOUND');
    });

    it('fatura de outro cartão paga num extrato da conta excluída volta a ficar em aberto', async () => {
        const world = new TestWorld('2026-03-15');
        const profileId = world.profile();
        const base = { profileId, subCategoryId: world.subCategory(profileId) };
        const a = world.account(profileId, { openingBalance: 1000, name: 'Conta A' });
        const b = world.account(profileId, { openingBalance: 500, name: 'Conta B' });
        const creditCardId = world.creditCard(profileId, a, 10, 17);
        const purchase = await world.create(base, { source: { kind: 'creditCard', creditCardId }, value: 300, dueDate: '2026-02-05' });
        await world.ok('invoices.pay', { invoiceId: invoiceOf(purchase), paymentDate: '2026-03-01' });
        // O cartão passa a ser pago por B depois do pagamento: a fatura paga continua no extrato de A.
        await world.ok('creditCards.update', { id: creditCardId, accountId: b, name: 'Cartão', limit: 10000, closingDay: 10, dueDay: 17 });

        const impact = await world.ok('accounts.deletionImpact', { id: a });
        expect(impact).toMatchObject({ creditCards: 0, invoices: 0, affectedAccounts: [{ id: b, name: 'Conta B' }] });

        await world.ok('accounts.delete', { id: a });

        expect(world.invoiceRow(creditCardId, '2026-02')?.paidIn).toBeNull();
        // Em aberto, a fatura de fevereiro (vence 17/02) pesa no previsto de B desde fevereiro.
        expect(world.statementRow(b, '2026-02')?.projectedClosing).toEqualMoney('200');
        expect((await world.ok('integrity.verifyBalances', {})).drifts).toEqual([]);
    });

    it('excluir a pagadora atual refaz a conta em que a fatura do cartão dela foi paga', async () => {
        const { world, a, b } = await payerChangedScenario();
        expect(world.accountRow(a).balance).toEqualMoney('700');

        const impact = await world.ok('accounts.deletionImpact', { id: b });
        expect(impact).toMatchObject({ creditCards: 1, invoices: 1, affectedAccounts: [{ id: a, name: 'Conta A' }] });

        await world.ok('accounts.delete', { id: b });

        expect(world.accountRow(a).balance).toEqualMoney('1000');
        expect(world.statementRow(a, '2026-03')?.closing).toEqualMoney('1000');
        expect((await world.ok('integrity.verifyBalances', {})).drifts).toEqual([]);
    });
});

describe('excluir cartão em cadeia (desktop-mvp-plan §5.1)', () => {
    it('apaga faturas e lançamentos, pagamentos parciais incluídos, e devolve o saldo das contas', async () => {
        const world = new TestWorld('2026-03-15');
        const profileId = world.profile();
        const base = { profileId, subCategoryId: world.subCategory(profileId) };
        const a = world.account(profileId, { openingBalance: 1000, name: 'Conta A' });
        const b = world.account(profileId, { openingBalance: 500, name: 'Conta B' });
        const creditCardId = world.creditCard(profileId, a, 10, 17);
        const purchase = await world.create(base, { source: { kind: 'creditCard', creditCardId }, value: 300, dueDate: '2026-02-05' });
        await world.create(base, {
            source: { kind: 'creditCard', creditCardId, invoicePeriod: '2026-02' },
            type: 'transference',
            destinationAccountId: b,
            value: -80,
            dueDate: '2026-02-20',
            paymentDate: '2026-02-20',
        });
        await world.ok('invoices.pay', { invoiceId: invoiceOf(purchase), paymentDate: '2026-03-01' });
        await world.create(base, { source: { kind: 'creditCard', creditCardId }, value: 100, dueDate: '2026-03-05' });
        expect(world.accountRow(a).balance).toEqualMoney('780');
        expect(world.accountRow(a).projected).toEqualMoney('680');

        const impact = await world.ok('creditCards.deletionImpact', { id: creditCardId });
        expect(impact).toEqual({
            creditCardId,
            invoices: 2,
            transactions: 3,
            partialPayments: 1,
            recurrences: 0,
            affectedAccounts: [{ id: a, name: 'Conta A' }, { id: b, name: 'Conta B' }],
        });

        await world.ok('creditCards.delete', { id: creditCardId });

        expect(deletedRows(world, 'invoices')).toBe(impact.invoices);
        expect(deletedRows(world, 'transactions')).toBe(impact.transactions);
        expect(world.accountRow(a)).toEqual({ balance: { amount: 1000, currency: 'BRL' }, projected: { amount: 1000, currency: 'BRL' } });
        expect(world.accountRow(b).balance).toEqualMoney('500');
        expect((await world.ok('creditCards.list', { profileId, period: '2026-03' })).creditCards).toEqual([]);
        expect((await world.ok('integrity.verifyBalances', {})).drifts).toEqual([]);
    });

    it('refaz a conta em que a fatura foi paga mesmo depois de trocada a pagadora do cartão', async () => {
        const { world, a, b, creditCardId } = await payerChangedScenario();

        const impact = await world.ok('creditCards.deletionImpact', { id: creditCardId });
        expect(impact.affectedAccounts).toEqual(expect.arrayContaining([{ id: a, name: 'Conta A' }, { id: b, name: 'Conta B' }]));

        await world.ok('creditCards.delete', { id: creditCardId });

        expect(world.accountRow(a).balance).toEqualMoney('1000');
        expect(world.statementRow(a, '2026-03')?.closing).toEqualMoney('1000');
        expect(world.accountRow(b).balance).toEqualMoney('500');
        expect((await world.ok('integrity.verifyBalances', {})).drifts).toEqual([]);
    });
});
