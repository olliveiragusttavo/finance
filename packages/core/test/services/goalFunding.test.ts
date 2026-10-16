import type { CoreOutput } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { TestWorld } from '../support/TestWorld.ts';

/**
 * Hoje é 08/10/2026. Um perfil com a conta corrente (R$ 5.000,00), a conta de investimento
 * Tesouro (saldo inicial R$ 500,00), uma subcategoria e a meta por lançamentos "Reserva"
 * (R$ 10.000,00, sem prazo), criados pelas rotas reais.
 *
 * @return O mundo, os ids e a base de lançamento.
 */
async function setup(): Promise<{
    world: TestWorld;
    profileId: string;
    checking: { readonly kind: 'account'; readonly accountId: string };
    savingsId: string;
    base: { readonly profileId: string; readonly subCategoryId: string };
    goalId: string;
}> {
    const world = new TestWorld('2026-10-08');
    const profileId = world.profile();
    const accountId = world.account(profileId, { openingBalance: 5000 });
    const savings = await world.ok('accounts.create', { profileId, name: 'Tesouro', type: 'investment', openingBalance: 500 });
    const base = { profileId, subCategoryId: world.subCategory(profileId) };
    const goal = await world.ok('goals.create', { profileId, name: 'Reserva', value: 10000 });
    return { world, profileId, checking: { kind: 'account', accountId }, savingsId: savings.id, base, goalId: goal.id };
}

/**
 * @param world Núcleo do teste.
 * @param profileId Perfil consultado.
 * @param period Mês de referência.
 * @param name Meta procurada.
 * @return A meta com o progresso, como a lista a devolve.
 */
async function goalNamed(world: TestWorld, profileId: string, period: string, name: string): Promise<CoreOutput<'goals.list'>[number]> {
    const found = (await world.ok('goals.list', { profileId, period })).find((goal) => goal.name === name);
    if (found === undefined) {
        throw new Error(`meta ${name} não encontrada`);
    }
    return found;
}

describe('Regra de negócio (Metas, desktop-mvp-plan Fase 13.3): retirada da meta por lançamentos', () => {
    it('a transferência de retirada desconta do guardado; a de depósito soma', async () => {
        const { world, profileId, checking, savingsId, base, goalId } = await setup();
        await world.create(base, { source: checking, type: 'transference', destinationAccountId: savingsId, value: 1000, dueDate: '2026-09-05', paymentDate: '2026-09-05', goalId });
        const withdrawal = await world.create(base, {
            source: { kind: 'account', accountId: savingsId },
            type: 'transference',
            destinationAccountId: checking.accountId,
            name: 'Conserto do carro',
            value: 300,
            dueDate: '2026-10-02',
            paymentDate: '2026-10-02',
            goalId,
            goalWithdrawal: true,
        });

        expect(withdrawal.goalWithdrawal).toBe(true);
        const goal = await goalNamed(world, profileId, '2026-10', 'Reserva');
        expect(goal.saved.amount).toBe(700);
        // Em setembro a retirada ainda não tinha acontecido.
        expect((await goalNamed(world, profileId, '2026-09', 'Reserva')).paceBase.saved.amount).toBe(1000);
        const contributions = await world.ok('goals.contributions', { id: goalId });
        expect(contributions.map(({ transaction }) => [transaction.name, transaction.goalWithdrawal])).toEqual([
            ['Lançamento', false],
            ['Conserto do carro', true],
        ]);
    });

    it('recusa a receita marcada como retirada: só a transferência retira', async () => {
        const { world, checking, base, goalId } = await setup();
        const error = await world.failure('transactions.create', { ...base, source: checking, type: 'income', name: 'Bônus', value: 100, dueDate: '2026-10-05', goalId, goalWithdrawal: true });
        expect(error.details['rule']).toBe('goal-withdrawal-requires-transfer');
    });

    it('sem meta, a marca de retirada é descartada', async () => {
        const { world, checking, savingsId, base } = await setup();
        const created = await world.create(base, { source: checking, type: 'transference', destinationAccountId: savingsId, value: 100, dueDate: '2026-10-05', goalWithdrawal: true });
        expect(created.goalWithdrawal).toBe(false);
    });

    it('a série de retirada copia a marca para as ocorrências', async () => {
        const { world, checking, savingsId, base, goalId } = await setup();
        const first = await world.create(base, {
            source: { kind: 'account', accountId: savingsId },
            type: 'transference',
            destinationAccountId: checking.accountId,
            name: 'Mesada da reserva',
            value: 50,
            dueDate: '2026-10-05',
            goalId,
            goalWithdrawal: true,
            repeat: { kind: 'installments', frequency: 'monthly', installments: 3, valueType: 'perInstallment' },
        });
        const occurrences = await world.ok('recurrences.occurrences', { recurrenceId: first.recurrenceId ?? '' });
        expect(occurrences.map((occurrence) => occurrence.goalWithdrawal)).toEqual([true, true, true]);
    });
});

describe('Regra de negócio (Metas, desktop-mvp-plan Fase 13.3): meta vinculada a uma conta de investimento', () => {
    it('o guardado é o saldo consolidado de hoje; um mês passado mostra o saldo com que fechou', async () => {
        const { world, profileId, checking, savingsId, base } = await setup();
        await world.create(base, { source: checking, type: 'transference', destinationAccountId: savingsId, value: 1000, dueDate: '2026-09-05', paymentDate: '2026-09-05' });
        await world.create(base, { source: checking, type: 'transference', destinationAccountId: savingsId, value: 200, dueDate: '2026-10-05', paymentDate: '2026-10-05' });
        // Em aberto: ainda não está na conta.
        await world.create(base, { source: checking, type: 'transference', destinationAccountId: savingsId, value: 400, dueDate: '2026-10-20' });
        await world.ok('goals.create', { profileId, name: 'Casa', value: 20000, funding: { kind: 'account', accountId: savingsId } });

        const now = await goalNamed(world, profileId, '2026-10', 'Casa');
        expect(now.saved.amount).toBe(1700);
        expect(now.funding).toEqual({ kind: 'account', accountId: savingsId });
        expect(now.linkedCount).toBe(0);
        expect(now.pending.count).toBe(0);
        expect((await goalNamed(world, profileId, '2026-09', 'Casa')).paceBase.saved.amount).toBe(1500);
        expect(await world.ok('goals.contributions', { id: now.id })).toEqual([]);
    });

    it('não recebe lançamentos e não é opção do campo "Meta"', async () => {
        const { world, profileId, checking, savingsId, base } = await setup();
        const casa = await world.ok('goals.create', { profileId, name: 'Casa', value: 20000, funding: { kind: 'account', accountId: savingsId } });

        const error = await world.failure('transactions.create', { ...base, source: checking, type: 'income', name: 'Bônus', value: 100, dueDate: '2026-10-05', goalId: casa.id });
        expect(error.details['rule']).toBe('goal-funded-by-account');
        expect((await world.ok('goals.options', { profileId })).map((goal) => goal.name)).toEqual(['Reserva']);
    });

    it('só se vincula a uma conta de investimento do perfil', async () => {
        const { world, profileId, checking } = await setup();
        const error = await world.failure('goals.create', { profileId, name: 'Casa', value: 20000, funding: { kind: 'account', accountId: checking.accountId } });
        expect(error.details['rule']).toBe('goal-account-not-investment');
    });

    it('trocar a meta por lançamentos para vinculada a conta desfaz os vínculos, que continuam existindo', async () => {
        const { world, profileId, checking, savingsId, base, goalId } = await setup();
        const linked = await world.create(base, { source: checking, type: 'transference', destinationAccountId: savingsId, value: 1000, dueDate: '2026-09-05', paymentDate: '2026-09-05', goalId });

        await world.ok('goals.update', { id: goalId, name: 'Reserva', value: 10000, targetDate: null, funding: { kind: 'account', accountId: savingsId } });

        const transaction = await world.ok('transactions.get', { id: linked.id });
        expect([transaction.goalId, transaction.goalWithdrawal]).toEqual([null, false]);
        expect((await goalNamed(world, profileId, '2026-10', 'Reserva')).saved.amount).toBe(1500);
    });

    it('excluir a conta exclui a meta vinculada, e o alerta a conta', async () => {
        const { world, profileId, savingsId } = await setup();
        await world.ok('goals.create', { profileId, name: 'Casa', value: 20000, funding: { kind: 'account', accountId: savingsId } });

        expect((await world.ok('accounts.deletionImpact', { id: savingsId })).goals).toBe(1);
        await world.ok('accounts.delete', { id: savingsId });

        expect((await world.ok('goals.list', { profileId, period: '2026-10' })).map((goal) => goal.name)).toEqual(['Reserva']);
    });

    it('a conta de investimento que é o saldo de uma meta não vira conta corrente (database-design §4.11)', async () => {
        const { world, profileId, savingsId } = await setup();
        await world.ok('goals.create', { profileId, name: 'Casa', value: 20000, funding: { kind: 'account', accountId: savingsId } });

        const error = await world.failure('accounts.update', { id: savingsId, name: 'Tesouro', type: 'checking', currencyLabel: null, considerBalance: true, openingBalance: 500 });

        expect([error.details['rule'], error.details['field']]).toEqual(['account-type-funds-goal', 'type']);
    });

    it('a meta arquivada também prende o tipo da conta, porque pode ser reativada', async () => {
        const { world, profileId, savingsId } = await setup();
        const goal = await world.ok('goals.create', { profileId, name: 'Casa', value: 20000, funding: { kind: 'account', accountId: savingsId } });
        await world.ok('goals.archive', { id: goal.id });

        const error = await world.failure('accounts.update', { id: savingsId, name: 'Tesouro', type: 'checking', currencyLabel: null, considerBalance: true, openingBalance: 500 });

        expect(error.details['rule']).toBe('account-type-funds-goal');
    });

    it('com meta vinculada, a conta continua editável sem trocar o tipo', async () => {
        const { world, profileId, savingsId } = await setup();
        await world.ok('goals.create', { profileId, name: 'Casa', value: 20000, funding: { kind: 'account', accountId: savingsId } });

        const account = await world.ok('accounts.update', { id: savingsId, name: 'Tesouro Selic', type: 'investment', currencyLabel: null, considerBalance: true, openingBalance: 500 });

        expect(account.name).toBe('Tesouro Selic');
    });

    it('sem meta vinculada, a conta de investimento troca de tipo', async () => {
        const { world, savingsId } = await setup();
        const account = await world.ok('accounts.update', { id: savingsId, name: 'Tesouro', type: 'checking', currencyLabel: null, considerBalance: true, openingBalance: 500 });
        expect(account.type).toBe('checking');
    });
});
