import { describe, expect, it } from 'vitest';
import { TestWorld } from '../support/TestWorld.ts';

/**
 * @return Um perfil com conta corrente, investimento, cartão pago pela corrente, subcategoria e
 * a meta "Viagem Floripa" (R$ 4.000,00 até 15/01/2027), criados pelas rotas reais.
 */
async function setup(): Promise<{
    world: TestWorld;
    profileId: string;
    checking: { readonly kind: 'account'; readonly accountId: string };
    savingsId: string;
    creditCardId: string;
    base: { readonly profileId: string; readonly subCategoryId: string };
    goalId: string;
}> {
    const world = new TestWorld('2026-10-08');
    const profileId = world.profile();
    const accountId = world.account(profileId, { openingBalance: 5000 });
    const savingsId = world.account(profileId, { name: 'Tesouro' });
    const creditCardId = world.creditCard(profileId, accountId, 3, 10);
    const base = { profileId, subCategoryId: world.subCategory(profileId) };
    const goal = await world.ok('goals.create', { profileId, name: 'Viagem Floripa', value: 4000, targetDate: '2027-01-15' });
    return { world, profileId, checking: { kind: 'account', accountId }, savingsId, creditCardId, base, goalId: goal.id };
}

describe('cadastro de metas (mockup DesktopMetas)', () => {
    it('cria, lista por nome com o progresso zerado e edita sem perder o vínculo', async () => {
        const { world, profileId, checking, savingsId, base, goalId } = await setup();
        await world.ok('goals.create', { profileId, name: 'Reserva de emergência', value: 30000 });
        await world.create(base, { source: checking, type: 'transference', destinationAccountId: savingsId, value: 700, dueDate: '2026-09-05', paymentDate: '2026-09-05', goalId });

        const list = await world.ok('goals.list', { profileId, period: '2026-10' });
        expect(list.map(({ name, value, targetDate, saved }) => ({ name, value: value.amount, targetDate, saved: saved.amount }))).toEqual([
            { name: 'Reserva de emergência', value: 30000, targetDate: null, saved: 0 },
            { name: 'Viagem Floripa', value: 4000, targetDate: '2027-01-15', saved: 700 },
        ]);

        const edited = await world.ok('goals.update', { id: goalId, name: 'Viagem', value: 5000, targetDate: null });
        expect(edited).toMatchObject({ name: 'Viagem', value: { amount: 5000, currency: 'BRL' }, targetDate: null });
        const [, trip] = await world.ok('goals.list', { profileId, period: '2026-10' });
        expect(trip).toMatchObject({ name: 'Viagem', saved: { amount: 700 }, linkedCount: 1 });
    });

    it('as opções do campo "Meta" trazem só id e nome, por nome, e acompanham criar, editar e excluir', async () => {
        const { world, profileId, goalId } = await setup();
        const reserve = await world.ok('goals.create', { profileId, name: 'Reserva de emergência', value: 30000 });
        expect(await world.ok('goals.options', { profileId })).toEqual([
            { id: reserve.id, name: 'Reserva de emergência' },
            { id: goalId, name: 'Viagem Floripa' },
        ]);
        await world.ok('goals.update', { id: goalId, name: 'Carro', value: 5000, targetDate: null });
        await world.ok('goals.delete', { id: reserve.id });
        expect(await world.ok('goals.options', { profileId })).toEqual([{ id: goalId, name: 'Carro' }]);
        expect((await world.failure('goals.options', { profileId: '00000000-0000-4000-8000-0000000000ff' })).code).toBe('NOT_FOUND');
    });

    it('valor-alvo zero, negativo ou nome vazio é recusado na validação', async () => {
        const { world, profileId, goalId } = await setup();
        expect((await world.failure('goals.create', { profileId, name: 'Carro', value: 0 })).code).toBe('VALIDATION_FAILED');
        expect((await world.failure('goals.create', { profileId, name: 'Carro', value: -1 })).code).toBe('VALIDATION_FAILED');
        expect((await world.failure('goals.update', { id: goalId, name: '  ', value: 100, targetDate: null })).code).toBe('VALIDATION_FAILED');
        expect((await world.failure('goals.create', { profileId, name: 'Carro', value: 100, targetDate: '2026-02-30' })).code).toBe('VALIDATION_FAILED');
    });

    it('Regra de negócio (Metas): só receitas e transferências são vinculadas, também na edição', async () => {
        const { world, checking, savingsId, base, goalId } = await setup();
        expect(await world.failure('transactions.create', { ...base, source: checking, type: 'expense', name: 'Passagem', value: 900, dueDate: '2026-10-01', goalId })).toMatchObject({
            code: 'BUSINESS_RULE_VIOLATION',
            details: { rule: 'goal-requires-saving-type', field: 'goalId' },
        });
        expect((await world.failure('transactions.create', { ...base, source: checking, type: 'investment', destinationAccountId: savingsId, name: 'CDB', value: 900, dueDate: '2026-10-01', goalId })).code).toBe(
            'BUSINESS_RULE_VIOLATION',
        );
        const income = await world.create(base, { source: checking, type: 'income', name: 'Freela', value: 300, goalId });
        expect(income.goalId).toBe(goalId);
        // Vincular a meta a uma despesa já lançada é recusado; o tipo não muda na edição, então
        // a despesa não tem como passar a alimentar a meta.
        const expense = await world.create(base, { source: checking, type: 'expense', name: 'Passagem', value: 900 });
        expect(await world.editFailure(expense, { goalId })).toMatchObject({ details: { rule: 'goal-requires-saving-type', field: 'goalId' } });
        expect(await world.editFailure(expense, { type: 'income', goalId })).toMatchObject({ details: { rule: 'transaction-type-locked', field: 'type' } });
        expect((await world.edit(income, { goalId: null })).goalId).toBeNull();
    });

    it('meta de outro perfil não é vinculada', async () => {
        const { world, base, checking } = await setup();
        const otherProfile = world.profile();
        const other = await world.ok('goals.create', { profileId: otherProfile, name: 'Carro', value: 100 });
        expect((await world.failure('transactions.create', { ...base, source: checking, type: 'income', name: 'Freela', value: 300, dueDate: '2026-10-01', goalId: other.id })).code).toBe('BUSINESS_RULE_VIOLATION');
    });

    it('Regra de negócio (Metas): o progresso soma as pagas até hoje, com o estorno descontando; as demais ficam pendentes', async () => {
        const { world, profileId, checking, savingsId, base, goalId } = await setup();
        const transfer = { source: checking, type: 'transference', destinationAccountId: savingsId, goalId } as const;
        await world.create(base, { ...transfer, value: 700, dueDate: '2026-09-05', paymentDate: '2026-09-05' });
        await world.create(base, { ...transfer, value: 700, dueDate: '2026-10-05', paymentDate: '2026-10-05' });
        await world.create(base, { source: checking, type: 'income', name: 'Devolução', value: -50, dueDate: '2026-10-06', paymentDate: '2026-10-06', goalId });
        // Em aberto e pago com data depois de hoje: ainda não contam.
        await world.create(base, { ...transfer, value: 700, dueDate: '2026-11-05' });
        await world.create(base, { ...transfer, value: 100, dueDate: '2026-10-09', paymentDate: '2026-10-09' });

        const [goal] = await world.ok('goals.list', { profileId, period: '2026-10' });
        expect(goal).toMatchObject({ saved: { amount: 1350 }, remaining: { amount: 2650 }, linkedCount: 5, pending: { count: 2, total: { amount: 800 } }, reached: false });
        expect(goal?.ratio).toBeCloseTo(0.3375, 10);
        expect(goal?.averagePerMonth?.amount).toBe(675);

        const contributions = await world.ok('goals.contributions', { id: goalId });
        expect(contributions.map(({ paidOn, transaction }) => [paidOn, transaction.value.amount])).toEqual([
            ['2026-09-05', 700],
            ['2026-10-05', 700],
            ['2026-10-06', -50],
        ]);
    });

    it('o detalhe lê só a meta aberta: as contribuições de outra meta do perfil ficam fora, e a tabela soma o progresso', async () => {
        const { world, profileId, checking, base, goalId } = await setup();
        const reserve = await world.ok('goals.create', { profileId, name: 'Reserva', value: 10000 });
        await world.create(base, { source: checking, type: 'income', name: 'Freela', value: 300, dueDate: '2026-10-01', paymentDate: '2026-10-01', goalId });
        await world.create(base, { source: checking, type: 'income', name: 'Bônus', value: 900, dueDate: '2026-10-02', paymentDate: '2026-10-02', goalId: reserve.id });
        // Em aberto: vinculada, mas fora da tabela.
        await world.create(base, { source: checking, type: 'income', name: 'Pendente', value: 50, dueDate: '2026-10-20', goalId });

        const contributions = await world.ok('goals.contributions', { id: goalId });
        expect(contributions.map(({ transaction }) => transaction.name)).toEqual(['Freela']);
        const trip = (await world.ok('goals.list', { profileId, period: '2026-10' })).find((goal) => goal.id === goalId);
        expect(contributions.reduce((total, { transaction }) => total + transaction.value.amount, 0)).toBe(trip?.saved.amount);
        expect((await world.ok('goals.contributions', { id: reserve.id })).map(({ transaction }) => transaction.name)).toEqual(['Bônus']);
    });

    it('transferência num cartão conta pelo dia em que a fatura foi paga, e volta a pendente ao reabrir', async () => {
        const { world, profileId, creditCardId, savingsId, base, goalId } = await setup();
        await world.create(base, { source: { kind: 'creditCard', creditCardId }, type: 'transference', destinationAccountId: savingsId, value: 200, dueDate: '2026-09-01', goalId });
        const before = await world.ok('goals.list', { profileId, period: '2026-10' });
        expect(before[0]?.saved.amount).toBe(0);

        const paid = await world.payInvoice(creditCardId, '2026-09', '2026-10-02');
        const [goal] = await world.ok('goals.list', { profileId, period: '2026-10' });
        expect(goal?.saved.amount).toBe(200);
        expect((await world.ok('goals.contributions', { id: goalId }))[0]?.paidOn).toBe('2026-10-02');

        await world.ok('invoices.reopen', { invoiceId: paid.id });
        expect((await world.ok('goals.list', { profileId, period: '2026-10' }))[0]?.pending.count).toBe(1);
    });

    it('transação excluída deixa de pesar na meta', async () => {
        const { world, profileId, checking, base, goalId } = await setup();
        const income = await world.create(base, { source: checking, type: 'income', value: 300, dueDate: '2026-10-01', paymentDate: '2026-10-01', goalId });
        await world.ok('transactions.delete', { id: income.id });
        expect((await world.ok('goals.list', { profileId, period: '2026-10' }))[0]).toMatchObject({ saved: { amount: 0 }, linkedCount: 0 });
    });

    it('Regra de negócio (Metas): excluir a meta tira o vínculo das transações e da série, que continuam existindo', async () => {
        const { world, profileId, checking, savingsId, base, goalId } = await setup();
        const first = await world.create(base, {
            source: checking,
            type: 'transference',
            destinationAccountId: savingsId,
            value: 700,
            dueDate: '2026-10-05',
            goalId,
            repeat: { kind: 'fixed', frequency: 'monthly', endAt: null },
        });

        await world.ok('goals.delete', { id: goalId });

        expect((await world.ok('transactions.get', { id: first.id })).goalId).toBeNull();
        const occurrences = await world.ok('recurrences.occurrences', { recurrenceId: first.recurrenceId ?? '' });
        expect(occurrences.every((occurrence) => occurrence.goalId === null)).toBe(true);
        expect(await world.ok('goals.list', { profileId, period: '2026-10' })).toEqual([]);
        expect((await world.failure('goals.contributions', { id: goalId })).code).toBe('NOT_FOUND');
        expect((await world.failure('transactions.create', { ...base, source: checking, type: 'income', name: 'Freela', value: 300, dueDate: '2026-10-01', goalId })).code).toBe('NOT_FOUND');

        // O complemento da série não traz a meta de volta.
        world.clock.set('2027-03-01');
        await world.ok('recurrences.topUp', {});
        const later = await world.ok('recurrences.occurrences', { recurrenceId: first.recurrenceId ?? '' });
        expect(later.every((occurrence) => occurrence.goalId === null)).toBe(true);
    });
});
