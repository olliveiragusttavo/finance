import { describe, expect, it } from 'vitest';
import type { CoreInput } from '../../src/index.ts';
import { TestWorld } from '../support/TestWorld.ts';

/**
 * @return Um perfil pessoal com conta pagadora e subcategoria, num mundo em que "hoje" é
 * 15/10/2026 — o mês de referência do mockup `DesktopCartoes`.
 */
function setup(): { world: TestWorld; profileId: string; accountId: string; base: { profileId: string; subCategoryId: string } } {
    const world = new TestWorld('2026-10-15');
    const profileId = world.profile();
    const accountId = world.account(profileId, { openingBalance: 5000 });
    return { world, profileId, accountId, base: { profileId, subCategoryId: world.subCategory(profileId) } };
}

/**
 * Edição completa de cartão com padrões válidos.
 *
 * @param id Cartão editado.
 * @param accountId Conta pagadora.
 * @param overrides Campos que o teste quer fixar.
 * @return A entrada da rota `creditCards.update`.
 */
function edit(id: string, accountId: string, overrides: Partial<CoreInput<'creditCards.update'>> = {}): CoreInput<'creditCards.update'> {
    return { id, accountId, name: 'Cartão', limit: 10000, closingDay: 10, dueDay: 17, ...overrides };
}

describe('cadastro de cartões (desktop-mvp-plan Fase 1.3)', () => {
    it('cria ativo, com ciclo e limite na moeda do perfil', async () => {
        const { world, profileId, accountId } = setup();
        const card = await world.ok('creditCards.create', { profileId, accountId, name: 'Roxinho', limit: 8000, closingDay: 3, dueDay: 10 });
        expect(card).toMatchObject({ accountId, name: 'Roxinho', closingDay: 3, dueDay: 10, disabled: false });
        expect(card.limit).toEqualMoney('8000');
    });

    it('recusa conta pagadora de outro perfil e dia fora de 1–31', async () => {
        const { world, profileId } = setup();
        const foreign = world.account(world.profile());
        const error = await world.failure('creditCards.create', { profileId, accountId: foreign, name: 'Cartão', limit: 1, closingDay: 3, dueDay: 10 });
        expect(error.details).toMatchObject({ rule: 'reference-outside-profile', field: 'accountId' });
        const invalid = await world.failure('creditCards.create', { profileId, accountId: world.account(profileId), name: 'Cartão', limit: 1, closingDay: 32, dueDay: 10 });
        expect(invalid.code).toBe('VALIDATION_FAILED');
    });

    it('mudar o dia de fechamento não move lançamentos existentes (database-design §4.7)', async () => {
        const { world, profileId, accountId, base } = setup();
        const creditCardId = world.creditCard(profileId, accountId, 10, 17);
        const purchase = await world.create(base, { source: { kind: 'creditCard', creditCardId }, dueDate: '2026-03-05' });
        expect(purchase.container.period).toBe('2026-03');

        await world.ok('creditCards.update', edit(creditCardId, accountId, { closingDay: 3 }));

        expect((await world.ok('transactions.get', { id: purchase.id })).container.period).toBe('2026-03');
        // A sugestão de uma compra nova já usa o fechamento novo: 05/03 é depois do dia 3.
        expect((await world.ok('invoices.suggest', { creditCardId, purchaseDate: '2026-03-05' })).period).toBe('2026-04');
    });

    it('a sugestão traz o fechamento e o vencimento da fatura, mesmo antes de ela existir', async () => {
        const { world, profileId, accountId } = setup();
        const creditCardId = world.creditCard(profileId, accountId, 3, 10);
        // Compra no dia do fechamento cai na fatura seguinte (database-design §4.5).
        expect(await world.ok('invoices.suggest', { creditCardId, purchaseDate: '2026-10-03' })).toEqual({
            creditCardId,
            period: '2026-11',
            closingDate: '2026-11-03',
            dueDate: '2026-11-10',
            invoice: null,
        });
    });

    it('mudar o vencimento move a fatura em aberto para o previsto do novo mês', async () => {
        const { world, profileId, accountId, base } = setup();
        const creditCardId = world.creditCard(profileId, accountId, 10, 17);
        await world.create(base, { source: { kind: 'creditCard', creditCardId }, value: 100, dueDate: '2026-03-05' });
        expect(world.statementRow(accountId, '2026-03')?.projectedClosing).toEqualMoney('4900');

        // Vence no primeiro dia 5 depois do fechamento de 10/03: 05/04.
        await world.ok('creditCards.update', edit(creditCardId, accountId, { dueDay: 5 }));

        expect(world.statementRow(accountId, '2026-03')?.projectedClosing).toEqualMoney('5000');
        expect(world.statementRow(accountId, '2026-04')?.projectedClosing).toEqualMoney('4900');
        expect((await world.ok('integrity.verifyBalances', {})).drifts).toEqual([]);
    });

    it('trocar a conta pagadora leva a fatura em aberto para o previsto da conta nova', async () => {
        const { world, profileId, accountId, base } = setup();
        const other = world.account(profileId, { openingBalance: 100 });
        const creditCardId = world.creditCard(profileId, accountId, 10, 17);
        await world.create(base, { source: { kind: 'creditCard', creditCardId }, value: 40, dueDate: '2026-10-05' });

        await world.ok('creditCards.update', edit(creditCardId, other));

        expect(world.statementRow(accountId, '2026-10')?.projectedClosing).toEqualMoney('5000');
        expect(world.statementRow(other, '2026-10')?.projectedClosing).toEqualMoney('60');
        expect((await world.ok('integrity.verifyBalances', {})).drifts).toEqual([]);
    });

    it('cartão desativado recusa lançamento novo, mas o antigo continua editável e a fatura continua', async () => {
        const { world, profileId, accountId, base } = setup();
        const creditCardId = world.creditCard(profileId, accountId, 10, 17);
        const old = await world.create(base, { source: { kind: 'creditCard', creditCardId }, value: 100, dueDate: '2026-10-05' });
        await world.ok('creditCards.disable', { id: creditCardId });

        const error = await world.failure('transactions.create', { ...base, source: { kind: 'creditCard', creditCardId }, type: 'expense', name: 'X', value: 1, dueDate: '2026-10-05' });
        expect(error.details).toMatchObject({ rule: 'credit-card-disabled', field: 'creditCardId' });

        const edited = await world.update(base, old.id, { source: { kind: 'creditCard', creditCardId, invoicePeriod: null }, value: 120, dueDate: '2026-10-05' });
        expect(edited.value).toEqualMoney('120');
        const list = await world.ok('creditCards.list', { profileId, period: '2026-10' });
        expect(list.creditCards[0]).toMatchObject({ disabled: true });
        expect(list.creditCards[0]?.invoiceOfMonth.invoice?.amountDue).toEqualMoney('120');
    });
});

describe('lista de cartões e próximas faturas (mockup DesktopCartoes)', () => {
    it('mostra a fatura do mês com datas, o limite usado e os totais do mês', async () => {
        const { world, profileId, accountId, base } = setup();
        const roxinho = await world.ok('creditCards.create', { profileId, accountId, name: 'Roxinho', limit: 8000, closingDay: 3, dueDay: 10 });
        const click = await world.ok('creditCards.create', { profileId, accountId, name: 'Click', limit: 3000, closingDay: 3, dueDay: 10 });
        await world.create(base, { source: { kind: 'creditCard', creditCardId: roxinho.id }, value: 2000, dueDate: '2026-10-01' });
        await world.create(base, { source: { kind: 'creditCard', creditCardId: roxinho.id }, value: 400, dueDate: '2026-10-20' });
        const clickPurchase = await world.create(base, { source: { kind: 'creditCard', creditCardId: click.id }, value: 600, dueDate: '2026-10-01' });
        if (clickPurchase.container.kind !== 'invoice') {
            throw new Error('compra no cartão deveria cair numa fatura');
        }
        await world.ok('invoices.pay', { invoiceId: clickPurchase.container.invoiceId, paymentDate: '2026-10-07' });

        const list = await world.ok('creditCards.list', { profileId, period: '2026-10' });

        expect(list.creditCards.map((card) => card.name)).toEqual(['Click', 'Roxinho']);
        const card = list.creditCards.find((entry) => entry.id === roxinho.id);
        expect(card?.invoiceOfMonth).toMatchObject({ period: '2026-10', closingDate: '2026-10-03', dueDate: '2026-10-10' });
        expect(card?.invoiceOfMonth.invoice?.status).toBe('open');
        // A fatura futura de novembro também ocupa limite.
        expect(card?.limitUsed).toEqualMoney('2400');
        expect(list.creditCards.find((entry) => entry.id === click.id)?.limitUsed).toEqualMoney('0');
        expect(list.openTotal).toEqualMoney('2000');
        expect(list.total).toEqualMoney('2600');
    });

    it('próximas faturas: o mês pedido sempre, mesmo vazio, e as faturas que existem depois dele', async () => {
        const { world, profileId, accountId, base } = setup();
        const creditCardId = world.creditCard(profileId, accountId, 3, 10);
        await world.create(base, { source: { kind: 'creditCard', creditCardId }, value: 100, dueDate: '2026-10-01' });
        await world.create(base, { source: { kind: 'creditCard', creditCardId }, value: 50, dueDate: '2026-12-01' });

        const fromOctober = await world.ok('invoices.listByCard', { creditCardId, from: '2026-10' });
        expect(fromOctober.map((cycle) => cycle.period)).toEqual(['2026-10', '2026-12']);

        const fromNovember = await world.ok('invoices.listByCard', { creditCardId, from: '2026-11' });
        expect(fromNovember[0]).toMatchObject({ period: '2026-11', closingDate: '2026-11-03', dueDate: '2026-11-10', invoice: null });
        expect(fromNovember.map((cycle) => cycle.period)).toEqual(['2026-11', '2026-12']);
    });

    it('pagamento parcial já é coberto por transactions.create: transferência negativa na fatura (database-design §4.7)', async () => {
        const { world, profileId, accountId, base } = setup();
        const creditCardId = world.creditCard(profileId, accountId, 3, 10);
        await world.create(base, { source: { kind: 'creditCard', creditCardId }, value: 1000, dueDate: '2026-10-01' });
        await world.create(base, {
            source: { kind: 'creditCard', creditCardId, invoicePeriod: '2026-10' },
            type: 'transference',
            destinationAccountId: accountId,
            value: -300,
            dueDate: '2026-10-05',
            paymentDate: '2026-10-05',
        });
        const list = await world.ok('creditCards.list', { profileId, period: '2026-10' });
        expect(list.creditCards[0]?.invoiceOfMonth.invoice?.amountDue).toEqualMoney('700');
        expect(world.statementRow(accountId, '2026-10')?.closing).toEqualMoney('4700');
    });
});
