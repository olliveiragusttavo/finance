import type { CoreOutput } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { TestWorld } from '../support/TestWorld.ts';

/**
 * Hoje é 08/10/2026. Um perfil com a conta corrente (R$ 5.000,00), a conta de investimento
 * Tesouro, uma subcategoria e a meta por lançamentos "Viagem" (R$ 1.000,00), criados pelas rotas
 * reais.
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
    const savings = await world.ok('accounts.create', { profileId, name: 'Tesouro', type: 'investment', openingBalance: 0 });
    const base = { profileId, subCategoryId: world.subCategory(profileId) };
    const goal = await world.ok('goals.create', { profileId, name: 'Viagem', value: 1000 });
    return { world, profileId, checking: { kind: 'account', accountId }, savingsId: savings.id, base, goalId: goal.id };
}

/**
 * @param world Núcleo do teste.
 * @param profileId Perfil consultado.
 * @return A primeira meta da lista de outubro, como a tela a recebe.
 */
async function firstGoal(world: TestWorld, profileId: string): Promise<CoreOutput<'goals.list'>[number]> {
    const [goal] = await world.ok('goals.list', { profileId, period: '2026-10' });
    if (goal === undefined) {
        throw new Error('meta não encontrada');
    }
    return goal;
}

describe('Regra de negócio (Metas, desktop-mvp-plan Fase 13.4): arquivar uma meta', () => {
    it('arquiva e reativa sem mexer nos vínculos nem no progresso; editar não desarquiva', async () => {
        const { world, profileId, checking, savingsId, base, goalId } = await setup();
        await world.create(base, { source: checking, type: 'transference', destinationAccountId: savingsId, value: 400, dueDate: '2026-10-02', paymentDate: '2026-10-02', goalId });

        expect((await world.ok('goals.archive', { id: goalId })).archived).toBe(true);
        expect(await firstGoal(world, profileId)).toMatchObject({ archived: true, linkedCount: 1, saved: { amount: 400 } });
        await world.ok('goals.update', { id: goalId, name: 'Viagem a Floripa', value: 1000, targetDate: null, funding: { kind: 'transactions' } });
        expect((await firstGoal(world, profileId)).archived).toBe(true);

        expect((await world.ok('goals.unarchive', { id: goalId })).archived).toBe(false);
        expect(await firstGoal(world, profileId)).toMatchObject({ archived: false, linkedCount: 1, saved: { amount: 400 } });
    });

    it('as opções do campo "Meta" dizem quais foram atingidas e quais estão arquivadas', async () => {
        const { world, profileId, checking, savingsId, base, goalId } = await setup();
        const house = await world.ok('goals.create', { profileId, name: 'Casa', value: 50000 });
        await world.create(base, { source: checking, type: 'transference', destinationAccountId: savingsId, value: 1000, dueDate: '2026-10-02', paymentDate: '2026-10-02', goalId });
        await world.ok('goals.archive', { id: house.id });

        expect(await world.ok('goals.options', { profileId })).toEqual([
            { id: house.id, name: 'Casa', reached: false, archived: true },
            { id: goalId, name: 'Viagem', reached: true, archived: false },
        ]);
    });

    it('a meta arquivada recusa lançamentos novos, mas o lançamento já vinculado continua editável', async () => {
        const { world, checking, savingsId, base, goalId } = await setup();
        const linked = await world.create(base, { source: checking, type: 'transference', destinationAccountId: savingsId, name: 'Aporte', value: 100, dueDate: '2026-10-02', goalId });
        const loose = await world.create(base, { source: checking, type: 'income', name: 'Bônus', value: 50, dueDate: '2026-10-03' });
        await world.ok('goals.archive', { id: goalId });

        const created = await world.failure('transactions.create', { ...base, source: checking, type: 'income', name: 'Freela', value: 100, dueDate: '2026-10-05', goalId });
        expect(created.details).toMatchObject({ rule: 'goal-archived', field: 'goalId' });
        const moved = await world.failure('transactions.update', { ...(await world.editInput(loose.id)), goalId });
        expect(moved.details['rule']).toBe('goal-archived');

        const edited = await world.ok('transactions.update', { ...(await world.editInput(linked.id)), name: 'Aporte de outubro' });
        expect([edited.name, edited.goalId]).toEqual(['Aporte de outubro', goalId]);
    });
});
