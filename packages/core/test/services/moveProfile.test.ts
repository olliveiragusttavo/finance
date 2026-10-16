import type { CoreInput, CoreOutput } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { TestWorld } from '../support/TestWorld.ts';

/**
 * Transação como a rota a devolve (DTO), e não a entidade de domínio de mesmo nome: o teste
 * confere o que a tela recebe depois de mover o lançamento de perfil.
 */
type Transaction = CoreOutput<'transactions.get'>;

/**
 * Dois perfis na mesma moeda, cada um com uma conta, um cartão e uma subcategoria: o pessoal com
 * 1000 e a empresa com 200. Hoje é 15/10/2026.
 *
 * @return O mundo, os perfis, as contas, os cartões e as subcategorias de cada perfil.
 */
function setup(): {
    world: TestWorld;
    personal: string;
    business: string;
    personalAccount: string;
    businessAccount: string;
    personalCard: string;
    businessCard: string;
    personalSub: string;
    businessSub: string;
} {
    const world = new TestWorld('2026-10-15');
    const personal = world.profile();
    const business = world.profile({ type: 'business' });
    const personalAccount = world.account(personal, { openingBalance: 1000 });
    const businessAccount = world.account(business, { openingBalance: 200 });
    return {
        world,
        personal,
        business,
        personalAccount,
        businessAccount,
        personalCard: world.creditCard(personal, personalAccount, 28, 10),
        businessCard: world.creditCard(business, businessAccount, 28, 10),
        personalSub: world.subCategory(personal),
        businessSub: world.subCategory(business),
    };
}

/**
 * @param world Núcleo do teste.
 * @return Os desvios entre o saldo em cache e o recálculo — vazio quando a mudança recalculou as
 * contas dos dois perfis.
 */
async function drifts(world: TestWorld): Promise<readonly unknown[]> {
    return (await world.ok('integrity.verifyBalances', {})).drifts;
}

/**
 * @param world Núcleo do teste.
 * @param first Uma ocorrência da série.
 * @return As ocorrências vivas da série, pela ordem do número.
 */
async function series(world: TestWorld, first: Transaction): Promise<readonly Transaction[]> {
    if (first.recurrenceId === null) {
        throw new Error('o lançamento não é de uma série');
    }
    return world.ok('recurrences.occurrences', { recurrenceId: first.recurrenceId });
}

describe('Regra de negócio (Mover para outro perfil, database-design §4.13): lançamento avulso', () => {
    it('a despesa paga sai do saldo do perfil de origem e entra no do destino, com a subcategoria e as tags de lá', async () => {
        const { world, personal, business, personalAccount, businessAccount, personalSub, businessSub } = setup();
        const tag = await world.ok('tags.create', { profileId: business, name: 'Obra' });
        const created = await world.create({ profileId: personal, subCategoryId: personalSub }, {
            source: { kind: 'account', accountId: personalAccount },
            value: 300,
            dueDate: '2026-10-05',
            paymentDate: '2026-10-05',
        });
        expect(world.accountRow(personalAccount).balance).toEqualMoney('700');

        const moved = await world.edit(created, {
            profileId: business,
            source: { kind: 'account', accountId: businessAccount },
            subCategoryId: businessSub,
            tagIds: [tag.id],
        });

        expect(moved.profileId).toBe(business);
        expect(moved.tagIds).toEqual([tag.id]);
        expect(world.accountRow(personalAccount).balance).toEqualMoney('1000');
        expect(world.accountRow(businessAccount).balance).toEqualMoney('-100');
        expect((await world.ok('transactions.listByPeriod', { profileId: personal, period: '2026-10' })).map((item) => item.id)).not.toContain(created.id);
        expect((await world.ok('transactions.listByPeriod', { profileId: business, period: '2026-10' })).map((item) => item.id)).toContain(created.id);
        expect(await drifts(world)).toEqual([]);
    });

    it('a compra no cartão vai para a fatura do cartão do outro perfil', async () => {
        const { world, personal, business, personalCard, businessCard, personalSub, businessSub } = setup();
        const created = await world.create({ profileId: personal, subCategoryId: personalSub }, {
            source: { kind: 'creditCard', creditCardId: personalCard },
            value: 250,
            dueDate: '2026-10-05',
        });

        const moved = await world.edit(created, {
            profileId: business,
            source: { kind: 'creditCard', creditCardId: businessCard, invoicePeriod: null },
            subCategoryId: businessSub,
        });

        expect(moved.container).toMatchObject({ kind: 'invoice', creditCardId: businessCard, period: '2026-10' });
        expect(world.invoiceRow(personalCard, '2026-10')?.balance).toEqualMoney('0');
        expect(world.invoiceRow(businessCard, '2026-10')?.balance).toEqualMoney('-250');
        expect(await drifts(world)).toEqual([]);
    });

    it('recusa referência que continuou no perfil de origem e não grava nada', async () => {
        const { world, personal, business, personalAccount, businessAccount, personalSub } = setup();
        const created = await world.create({ profileId: personal, subCategoryId: personalSub }, {
            source: { kind: 'account', accountId: personalAccount },
            dueDate: '2026-10-05',
        });

        const error = await world.editFailure(created, { profileId: business, source: { kind: 'account', accountId: businessAccount } });

        expect(error.details['rule']).toBe('reference-outside-profile');
        expect(error.details['field']).toBe('subCategoryId');
        expect((await world.ok('transactions.get', { id: created.id })).profileId).toBe(personal);
    });

    it('recusa mover para um perfil de outra moeda', async () => {
        const { world, personal, personalAccount, personalSub } = setup();
        const dollars = world.profile();
        await world.ok('profiles.update', { id: dollars, name: 'Viagem', currency: 'USD' });
        const dollarAccount = world.account(dollars);
        const created = await world.create({ profileId: personal, subCategoryId: personalSub }, {
            source: { kind: 'account', accountId: personalAccount },
            dueDate: '2026-10-05',
        });

        const error = await world.editFailure(created, {
            profileId: dollars,
            source: { kind: 'account', accountId: dollarAccount },
            subCategoryId: world.subCategory(dollars),
        });

        expect(error.details['rule']).toBe('transaction-move-currency-mismatch');
        expect(error.details['field']).toBe('profileId');
    });

    it('a transferência para o perfil de destino vira transferência interna dele', async () => {
        const { world, personal, business, personalAccount, businessAccount, personalSub, businessSub } = setup();
        const savings = world.account(business, { openingBalance: 0 });
        const created = await world.create({ profileId: personal, subCategoryId: personalSub }, {
            source: { kind: 'account', accountId: personalAccount },
            type: 'transference',
            value: 100,
            dueDate: '2026-10-05',
            paymentDate: '2026-10-05',
            destinationAccountId: businessAccount,
        });

        await world.edit(created, { profileId: business, source: { kind: 'account', accountId: savings }, subCategoryId: businessSub });

        expect(world.accountRow(personalAccount).balance).toEqualMoney('1000');
        expect(world.accountRow(savings).balance).toEqualMoney('-100');
        expect(world.accountRow(businessAccount).balance).toEqualMoney('300');
        expect(await drifts(world)).toEqual([]);
    });
});

describe('Regra de negócio (Mover para outro perfil, database-design §4.12): série', () => {
    it('recusa mover só uma ocorrência ou esta e as futuras: a regra é do perfil', async () => {
        const { world, personal, business, personalAccount, businessAccount, personalSub, businessSub } = setup();
        const first = await world.create({ profileId: personal, subCategoryId: personalSub }, {
            source: { kind: 'account', accountId: personalAccount },
            name: 'Aluguel',
            dueDate: '2026-10-05',
            repeat: { kind: 'fixed', frequency: 'monthly', endAt: null },
        });
        const move = { profileId: business, source: { kind: 'account', accountId: businessAccount }, subCategoryId: businessSub } as const;

        expect((await world.editFailure(first, { ...move, scope: 'single' })).details['rule']).toBe('recurrence-move-requires-all');
        expect((await world.editFailure(first, { ...move, scope: 'future' })).details['rule']).toBe('recurrence-move-requires-all');
    });

    it('em "todas", a regra e todas as ocorrências vão para o perfil de destino, inclusive a com subcategoria própria', async () => {
        const { world, personal, business, personalAccount, businessAccount, personalSub, businessSub } = setup();
        const first = await world.create({ profileId: personal, subCategoryId: personalSub }, {
            source: { kind: 'account', accountId: personalAccount },
            name: 'Curso',
            value: 100,
            dueDate: '2026-09-05',
            paymentDate: '2026-09-05',
            repeat: { kind: 'installments', frequency: 'monthly', installments: 3, valueType: 'perInstallment' },
        });
        const own = world.subCategory(personal);
        const third = (await series(world, first))[2];
        if (third === undefined) {
            throw new Error('a série não tem a 3ª parcela');
        }
        await world.edit(third, { subCategoryId: own, scope: 'single' });

        const plan = await world.ok('recurrences.planUpdate', {
            ...editInput(first),
            profileId: business,
            source: { kind: 'account', accountId: businessAccount },
            subCategoryId: businessSub,
            scope: 'all',
        });
        expect(plan.updated.map((item) => item.transaction.occurrence)).toEqual([1, 2, 3]);
        expect(plan.seriesAfter?.profileId).toBe(business);

        await world.edit(first, { profileId: business, source: { kind: 'account', accountId: businessAccount }, subCategoryId: businessSub, scope: 'all' });

        const moved = await series(world, first);
        expect(moved.map((item) => [item.profileId, item.subCategoryId])).toEqual([
            [business, businessSub],
            [business, businessSub],
            [business, businessSub],
        ]);
        expect((await world.ok('recurrences.list', { profileId: personal })).map((item) => item.id)).not.toContain(first.recurrenceId);
        expect((await world.ok('recurrences.list', { profileId: business })).map((item) => item.id)).toContain(first.recurrenceId);
        expect(world.accountRow(personalAccount).balance).toEqualMoney('1000');
        expect(world.accountRow(businessAccount).balance).toEqualMoney('100');
        expect(await drifts(world)).toEqual([]);
    });

    it('a fixa movida continua sendo complementada no perfil de destino', async () => {
        const { world, personal, business, personalAccount, businessAccount, personalSub, businessSub } = setup();
        const first = await world.create({ profileId: personal, subCategoryId: personalSub }, {
            source: { kind: 'account', accountId: personalAccount },
            name: 'Internet',
            dueDate: '2026-10-05',
            repeat: { kind: 'fixed', frequency: 'monthly', endAt: null },
        });
        await world.edit(first, { profileId: business, source: { kind: 'account', accountId: businessAccount }, subCategoryId: businessSub, scope: 'all' });

        world.clock.set('2027-03-15');
        await world.ok('recurrences.topUp', {});

        const occurrences = await series(world, first);
        expect(occurrences.length).toBeGreaterThan(12);
        expect(new Set(occurrences.map((item) => item.profileId))).toEqual(new Set([business]));
        expect(await drifts(world)).toEqual([]);
    });
});

/**
 * @param transaction Ocorrência como está.
 * @return A entrada de `transactions.update` sem mudança nenhuma, para o plano receber o mesmo
 * que a edição recebe e o teste sobrepor o perfil de destino.
 */
function editInput(transaction: Transaction): CoreInput<'transactions.update'> {
    const { container } = transaction;
    return {
        id: transaction.id,
        type: transaction.type,
        source: container.kind === 'statement' ? { kind: 'account', accountId: container.accountId } : { kind: 'creditCard', creditCardId: container.creditCardId, invoicePeriod: container.period },
        subCategoryId: transaction.subCategoryId,
        destinationAccountId: transaction.destinationAccountId,
        partnerId: transaction.partnerId,
        goalId: transaction.goalId,
        goalWithdrawal: transaction.goalWithdrawal,
        name: transaction.name,
        description: transaction.description,
        value: transaction.value.amount,
        charges: transaction.charges.amount,
        originCurrency: transaction.originCurrency,
        conversionRate: transaction.conversionRate,
        dueDate: transaction.dueDate,
        paymentDate: transaction.paymentDate,
        tagIds: [...transaction.tagIds],
    };
}
