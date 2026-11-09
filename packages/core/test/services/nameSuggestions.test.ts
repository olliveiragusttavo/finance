import { describe, expect, it } from 'vitest';
import { nameSuggestionKey } from '../../src/domain/transaction/NameSuggestion.ts';
import { TestWorld } from '../support/TestWorld.ts';

describe('sugestões do campo "Nome" do lançamento', () => {
    it('um item por nome e tipo, com a categoria e a origem do lançamento mais recente, sem diferenciar maiúsculas', async () => {
        const world = new TestWorld();
        const profileId = world.profile();
        const accountId = world.account(profileId);
        const creditCardId = world.creditCard(profileId, accountId, 1, 8);
        const groceries = world.subCategory(profileId);
        const salary = world.subCategory(profileId);
        const base = { profileId, subCategoryId: groceries };
        await world.create(base, { name: 'Mercado', source: { kind: 'account', accountId } });
        // O cadastro mais recente decide: a compra passou para o cartão.
        await world.create(base, { name: 'mercado ', source: { kind: 'creditCard', creditCardId } });
        await world.create({ profileId, subCategoryId: salary }, { name: 'Pix', type: 'income', source: { kind: 'account', accountId } });
        await world.create(base, { name: 'Pix', source: { kind: 'account', accountId } });

        expect(await world.ok('transactions.nameSuggestions', { profileId })).toEqual([
            { name: 'Pix', type: 'expense', subCategoryId: groceries, source: { kind: 'account', accountId }, uses: 1 },
            { name: 'Pix', type: 'income', subCategoryId: salary, source: { kind: 'account', accountId }, uses: 1 },
            { name: 'mercado', type: 'expense', subCategoryId: groceries, source: { kind: 'creditCard', creditCardId }, uses: 2 },
        ]);
    });

    it('a parcela futura de uma série não passa à frente do lançamento cadastrado depois', async () => {
        const world = new TestWorld();
        const profileId = world.profile();
        const accountId = world.account(profileId);
        const otherAccountId = world.account(profileId, { name: 'Itaú' });
        const subCategoryId = world.subCategory(profileId);
        await world.create({ profileId, subCategoryId }, { name: 'Academia', source: { kind: 'account', accountId }, repeat: { kind: 'installments', frequency: 'monthly', installments: 12, valueType: 'perInstallment' } });
        await world.create({ profileId, subCategoryId }, { name: 'Academia', dueDate: '2026-03-01', source: { kind: 'account', accountId: otherAccountId } });

        const [suggestion] = await world.ok('transactions.nameSuggestions', { profileId });
        expect(suggestion).toMatchObject({ name: 'Academia', source: { kind: 'account', accountId: otherAccountId }, uses: 13 });
    });

    it('só nomes do perfil: excluídos e lançamentos de outro perfil ficam de fora', async () => {
        const world = new TestWorld();
        const profileId = world.profile();
        const accountId = world.account(profileId);
        const subCategoryId = world.subCategory(profileId);
        const other = world.profile();
        await world.create({ profileId: other, subCategoryId: world.subCategory(other) }, { name: 'Aluguel', source: { kind: 'account', accountId: world.account(other) } });
        const deleted = await world.create({ profileId, subCategoryId }, { name: 'Farmácia', source: { kind: 'account', accountId } });
        await world.ok('transactions.delete', { id: deleted.id });

        expect(await world.ok('transactions.nameSuggestions', { profileId })).toEqual([]);
        expect((await world.failure('transactions.nameSuggestions', { profileId: world.ids.random() })).code).toBe('NOT_FOUND');
    });

    it('junta grafias que diferem só no acento e na maiúscula, com a origem do cadastro mais recente', async () => {
        const world = new TestWorld();
        const profileId = world.profile();
        const accountId = world.account(profileId);
        const creditCardId = world.creditCard(profileId, accountId, 1, 8);
        const subCategoryId = world.subCategory(profileId);
        const base = { profileId, subCategoryId };
        // O `lower()` do SQLite deixaria "PÃO DE AÇÚCAR" e "Pão de Açúcar" em grupos diferentes.
        await world.create(base, { name: 'PÃO DE AÇÚCAR', source: { kind: 'account', accountId } });
        await world.create(base, { name: 'Pao de Acucar', source: { kind: 'account', accountId } });
        // O cadastro mais recente decide a grafia e a origem.
        await world.create(base, { name: 'Pão de Açúcar', source: { kind: 'creditCard', creditCardId } });

        expect(await world.ok('transactions.nameSuggestions', { profileId })).toEqual([
            { name: 'Pão de Açúcar', type: 'expense', subCategoryId, source: { kind: 'creditCard', creditCardId }, uses: 3 },
        ]);
    });
});

describe('nameSuggestionKey', () => {
    it('ignora acento, maiúscula e espaços nas pontas', () => {
        expect(nameSuggestionKey('  AÇAÍ ')).toBe(nameSuggestionKey('acai'));
        expect(nameSuggestionKey('Pão de Açúcar')).toBe('pao de acucar');
    });
});
