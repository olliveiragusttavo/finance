import { describe, expect, it } from 'vitest';
import { TestWorld } from '../support/TestWorld.ts';

/**
 * @return Um perfil com conta, subcategoria e as tags "viagem" e "reembolsável", criadas
 * pelas rotas reais.
 */
async function setup(): Promise<{
    world: TestWorld;
    profileId: string;
    accountId: string;
    base: { readonly profileId: string; readonly subCategoryId: string };
    trip: string;
    refundable: string;
}> {
    const world = new TestWorld('2026-03-15');
    const profileId = world.profile();
    const accountId = world.account(profileId, { openingBalance: 1000 });
    const base = { profileId, subCategoryId: world.subCategory(profileId) };
    const trip = await world.ok('tags.create', { profileId, name: 'viagem' });
    const refundable = await world.ok('tags.create', { profileId, name: 'reembolsável' });
    return { world, profileId, accountId, base, trip: trip.id, refundable: refundable.id };
}

describe('cadastro de tags (mockup DesktopTags)', () => {
    it('lista por nome com o uso de cada tag; tag sem lançamento vem zerada', async () => {
        const { world, profileId } = await setup();
        const list = await world.ok('tags.list', { profileId });
        expect(list.map(({ name, transactionCount, total, lastUsedOn }) => ({ name, transactionCount, total: total.amount, lastUsedOn }))).toEqual([
            { name: 'reembolsável', transactionCount: 0, total: 0, lastUsedOn: null },
            { name: 'viagem', transactionCount: 0, total: 0, lastUsedOn: null },
        ]);
    });

    it('Regra de negócio (Tags): o total soma os valores em módulo de qualquer tipo, sem encargos; o último uso é o maior vencimento', async () => {
        const { world, profileId, accountId, base, trip } = await setup();
        const source = { kind: 'account', accountId } as const;
        await world.create(base, { source, type: 'expense', value: 300, charges: 7, dueDate: '2026-02-10', tagIds: [trip] });
        await world.create(base, { source, type: 'income', value: 120.5, dueDate: '2026-03-12', tagIds: [trip] });
        // Estorno: valor negativo também pesa em módulo.
        await world.create(base, { source, type: 'expense', value: -50, dueDate: '2026-01-05', tagIds: [trip] });
        await world.create(base, { source, value: 999 });

        const [, tripUsage] = await world.ok('tags.list', { profileId });
        expect(tripUsage).toMatchObject({ name: 'viagem', transactionCount: 3, total: { amount: 470.5, currency: 'BRL' }, lastUsedOn: '2026-03-12' });
    });

    it('transação excluída deixa de pesar na tag', async () => {
        const { world, profileId, accountId, base, trip } = await setup();
        const tagged = await world.create(base, { source: { kind: 'account', accountId }, tagIds: [trip] });
        await world.ok('transactions.delete', { id: tagged.id });
        const list = await world.ok('tags.list', { profileId });
        expect(list.find((tag) => tag.id === trip)?.transactionCount).toBe(0);
    });

    it('nome duplicado sem diferenciar maiúsculas, inclusive com acento, é CONFLICT; renomear para a própria caixa não conflita', async () => {
        const { world, profileId, refundable } = await setup();
        expect(await world.failure('tags.create', { profileId, name: ' REEMBOLSÁVEL ' })).toMatchObject({ code: 'CONFLICT', details: { entity: 'tag', field: 'name' } });
        expect((await world.ok('tags.update', { id: refundable, name: 'Reembolsável' })).name).toBe('Reembolsável');
        expect((await world.failure('tags.update', { id: refundable, name: 'Viagem' })).code).toBe('CONFLICT');
        // Outro perfil tem o próprio vocabulário.
        expect((await world.ok('tags.create', { profileId: world.profile(), name: 'viagem' })).name).toBe('viagem');
    });

    it('nome em branco ou com mais de 45 caracteres é recusado na validação', async () => {
        const { world, profileId } = await setup();
        expect((await world.failure('tags.create', { profileId, name: '   ' })).code).toBe('VALIDATION_FAILED');
        expect((await world.failure('tags.create', { profileId, name: 'a'.repeat(46) })).code).toBe('VALIDATION_FAILED');
    });

    it('Regra de negócio (Tags): excluir tira a tag dos lançamentos, que continuam existindo com as outras tags', async () => {
        const { world, profileId, accountId, base, trip, refundable } = await setup();
        const tagged = await world.create(base, { source: { kind: 'account', accountId }, tagIds: [trip, refundable] });

        await world.ok('tags.delete', { id: trip });

        expect((await world.ok('transactions.get', { id: tagged.id })).tagIds).toEqual([refundable]);
        expect((await world.ok('tags.list', { profileId })).map((tag) => tag.name)).toEqual(['reembolsável']);
        expect((await world.failure('tags.update', { id: trip, name: 'outra' })).code).toBe('NOT_FOUND');
        // O nome volta a ficar livre.
        expect((await world.ok('tags.create', { profileId, name: 'viagem' })).name).toBe('viagem');
    });
});

describe('tags nos lançamentos (database-design §4.14)', () => {
    it('o lançamento guarda as tags, por nome e sem repetição; sem tags é lista vazia', async () => {
        const { world, accountId, base, trip, refundable } = await setup();
        const tagged = await world.create(base, { source: { kind: 'account', accountId }, tagIds: [trip, refundable, trip] });
        expect(tagged.tagIds).toEqual([refundable, trip]);
        expect((await world.create(base, { source: { kind: 'account', accountId } })).tagIds).toEqual([]);
    });

    it('a edição substitui o conjunto, e a tag que volta revive o mesmo vínculo em vez de duplicar', async () => {
        const { world, accountId, base, trip, refundable } = await setup();
        const source = { kind: 'account', accountId } as const;
        const tagged = await world.create(base, { source, tagIds: [trip] });

        expect((await world.update(base, tagged.id, { source, tagIds: [refundable] })).tagIds).toEqual([refundable]);
        expect((await world.update(base, tagged.id, { source, tagIds: [trip, refundable] })).tagIds).toEqual([refundable, trip]);

        const links = world.database.all('SELECT tag_id, deleted_at FROM transactions_tags WHERE transaction_id = :id ORDER BY tag_id', { id: tagged.id });
        expect(links).toHaveLength(2);
        expect(links.every((link) => link['deleted_at'] === null)).toBe(true);
    });

    it('editar sem mexer nas tags não regrava o vínculo', async () => {
        const { world, accountId, base, trip } = await setup();
        const source = { kind: 'account', accountId } as const;
        const tagged = await world.create(base, { source, tagIds: [trip] });
        const before = world.database.get('SELECT updated_at FROM transactions_tags WHERE transaction_id = :id', { id: tagged.id });
        world.clock.set('2026-03-20');
        await world.update(base, tagged.id, { source, value: 150, tagIds: [trip] });
        expect(world.database.get('SELECT updated_at FROM transactions_tags WHERE transaction_id = :id', { id: tagged.id })).toEqual(before);
    });

    it('marcar como pago mantém as tags', async () => {
        const { world, accountId, base, trip } = await setup();
        const tagged = await world.create(base, { source: { kind: 'account', accountId }, tagIds: [trip] });
        expect((await world.ok('transactions.setPaid', { id: tagged.id, paid: true })).tagIds).toEqual([trip]);
    });

    it('tag de outro perfil é recusada, e tag inexistente é NOT_FOUND', async () => {
        const { world, accountId, base } = await setup();
        const foreign = await world.ok('tags.create', { profileId: world.profile(), name: 'alheia' });
        const source = { kind: 'account', accountId } as const;
        const outside = await world.failure('transactions.create', { ...base, type: 'expense', name: 'X', value: 1, dueDate: '2026-03-10', source, tagIds: [foreign.id] });
        expect(outside).toMatchObject({ code: 'BUSINESS_RULE_VIOLATION', details: { rule: 'reference-outside-profile', field: 'tagIds' } });
        const missing = await world.failure('transactions.create', {
            ...base,
            type: 'expense',
            name: 'X',
            value: 1,
            dueDate: '2026-03-10',
            source,
            tagIds: ['00000000-0000-4000-8000-0000000fffff'],
        });
        expect(missing.code).toBe('NOT_FOUND');
    });

    it('a edição completa exige as tags explícitas, para que omiti-las não apague as gravadas em silêncio', async () => {
        const { world, accountId, base, trip } = await setup();
        const source = { kind: 'account', accountId } as const;
        const tagged = await world.create(base, { source, tagIds: [trip] });
        const result = await world.core.dispatch('transactions.update', {
            id: tagged.id,
            subCategoryId: base.subCategoryId,
            source,
            type: 'expense',
            name: 'Lançamento',
            value: 100,
            charges: 0,
            description: null,
            destinationAccountId: null,
            partnerId: null,
            goalId: null,
            originCurrency: null,
            conversionRate: 1,
            dueDate: '2026-03-10',
            paymentDate: null,
        });
        expect(result.ok ? null : result.error.code).toBe('VALIDATION_FAILED');
        expect((await world.ok('transactions.get', { id: tagged.id })).tagIds).toEqual([trip]);
    });
});
