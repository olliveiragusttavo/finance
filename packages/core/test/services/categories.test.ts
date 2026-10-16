import { describe, expect, it } from 'vitest';
import { TestWorld } from '../support/TestWorld.ts';

/**
 * @return Um perfil com conta e a categoria Alimentação com Mercado e Restaurantes, criadas
 * pelas rotas reais.
 */
async function setup(): Promise<{
    world: TestWorld;
    profileId: string;
    accountId: string;
    categoryId: string;
    market: string;
    restaurants: string;
}> {
    const world = new TestWorld('2026-03-15');
    const profileId = world.profile();
    const accountId = world.account(profileId, { openingBalance: 1000 });
    const category = await world.ok('categories.create', { profileId, name: 'Alimentação' });
    const market = await world.ok('subCategories.create', { categoryId: category.id, name: 'Mercado' });
    const restaurants = await world.ok('subCategories.create', { categoryId: category.id, name: 'Restaurantes' });
    return { world, profileId, accountId, categoryId: category.id, market: market.id, restaurants: restaurants.id };
}

describe('cadastro de categorias (desktop-mvp-plan Fase 1.4)', () => {
    it('a árvore traz as subcategorias por nome e quantos lançamentos cada uma tem', async () => {
        const { world, profileId, accountId, market } = await setup();
        await world.create({ profileId, subCategoryId: market }, { source: { kind: 'account', accountId } });
        await world.create({ profileId, subCategoryId: market }, { source: { kind: 'account', accountId } });
        await world.ok('categories.create', { profileId, name: 'Moradia' });

        const tree = await world.ok('categories.tree', { profileId });

        expect(tree.map((category) => category.name)).toEqual(['Alimentação', 'Moradia']);
        expect(tree[0]?.subCategories.map(({ name, transactionCount }) => ({ name, transactionCount }))).toEqual([
            { name: 'Mercado', transactionCount: 2 },
            { name: 'Restaurantes', transactionCount: 0 },
        ]);
    });

    it('nome duplicado sem diferenciar maiúsculas, inclusive com acento, é CONFLICT e não erro de SQL', async () => {
        const { world, profileId, categoryId } = await setup();
        const category = await world.failure('categories.create', { profileId, name: 'ALIMENTAÇÃO' });
        expect(category).toMatchObject({ code: 'CONFLICT', details: { entity: 'category', field: 'name' } });

        const sub = await world.failure('subCategories.create', { categoryId, name: ' mercado ' });
        expect(sub).toMatchObject({ code: 'CONFLICT', details: { entity: 'subCategory' } });

        // O mesmo nome em outra categoria ou em outro perfil é legítimo.
        const other = await world.ok('categories.create', { profileId, name: 'Casa' });
        expect((await world.ok('subCategories.create', { categoryId: other.id, name: 'Mercado' })).name).toBe('Mercado');
        expect((await world.ok('categories.create', { profileId: world.profile(), name: 'Alimentação' })).name).toBe('Alimentação');
    });

    it('renomear para o próprio nome em outra caixa não conflita consigo mesmo', async () => {
        const { world, categoryId, market } = await setup();
        expect((await world.ok('categories.update', { id: categoryId, name: 'ALIMENTAÇÃO' })).name).toBe('ALIMENTAÇÃO');
        expect((await world.ok('subCategories.update', { id: market, name: 'mercado' })).name).toBe('mercado');
        const error = await world.failure('subCategories.update', { id: market, name: 'Restaurantes' });
        expect(error.code).toBe('CONFLICT');
    });
});

describe('excluir subcategoria em uso (mockup DesktopCadastros)', () => {
    it('sem destino, recusa e diz quantos lançamentos há; com destino, move e exclui', async () => {
        const { world, profileId, accountId, market, restaurants } = await setup();
        const transaction = await world.create({ profileId, subCategoryId: restaurants }, { source: { kind: 'account', accountId }, paymentDate: '2026-03-10' });
        const before = world.statementRow(accountId, '2026-03');

        const refused = await world.failure('subCategories.delete', { id: restaurants });
        expect(refused.details).toMatchObject({ rule: 'sub-category-in-use', field: 'moveTo', transactions: 1 });

        await world.ok('subCategories.delete', { id: restaurants, moveTo: market });

        expect((await world.ok('transactions.get', { id: transaction.id })).subCategoryId).toBe(market);
        // Categoria não afeta saldo: mover não muda extrato nenhum.
        expect(world.statementRow(accountId, '2026-03')).toEqual(before);
        const tree = await world.ok('categories.tree', { profileId });
        expect(tree[0]?.subCategories.map(({ name, transactionCount }) => ({ name, transactionCount }))).toEqual([{ name: 'Mercado', transactionCount: 1 }]);

        const reuse = await world.failure('transactions.create', {
            profileId, subCategoryId: restaurants, source: { kind: 'account', accountId }, type: 'expense', name: 'X', value: 1, dueDate: '2026-03-10',
        });
        expect(reuse.code).toBe('NOT_FOUND');
    });

    it('subcategoria sem lançamentos é excluída sem destino', async () => {
        const { world, profileId, restaurants } = await setup();
        await world.ok('subCategories.delete', { id: restaurants });
        expect((await world.ok('categories.tree', { profileId }))[0]?.subCategories).toHaveLength(1);
    });

    it('recusa destino de outro perfil e destino que também vai ser excluído', async () => {
        const { world, profileId, accountId, categoryId, market } = await setup();
        await world.create({ profileId, subCategoryId: market }, { source: { kind: 'account', accountId } });
        const foreign = world.subCategory(world.profile());

        const outside = await world.failure('subCategories.delete', { id: market, moveTo: foreign });
        expect(outside.details).toMatchObject({ rule: 'reference-outside-profile', field: 'moveTo' });

        const itself = await world.failure('subCategories.delete', { id: market, moveTo: market });
        expect(itself.details['rule']).toBe('move-target-deleted');

        const sibling = await world.failure('categories.delete', { id: categoryId, moveTo: market });
        expect(sibling.details['rule']).toBe('move-target-deleted');
    });

    it('excluir categoria move os lançamentos de todas as subcategorias e apaga as subcategorias junto', async () => {
        const { world, profileId, accountId, categoryId, market, restaurants } = await setup();
        const other = await world.ok('categories.create', { profileId, name: 'Outros' });
        const target = await world.ok('subCategories.create', { categoryId: other.id, name: 'Geral' });
        await world.create({ profileId, subCategoryId: market }, { source: { kind: 'account', accountId } });
        await world.create({ profileId, subCategoryId: restaurants }, { source: { kind: 'account', accountId } });

        expect((await world.failure('categories.delete', { id: categoryId })).details).toMatchObject({ rule: 'sub-category-in-use', transactions: 2 });
        await world.ok('categories.delete', { id: categoryId, moveTo: target.id });

        const tree = await world.ok('categories.tree', { profileId });
        expect(tree.map((category) => category.name)).toEqual(['Outros']);
        expect(tree[0]?.subCategories[0]?.transactionCount).toBe(2);
        expect(world.database.get('SELECT count(*) AS n FROM transaction_sub_categories WHERE category_id = :categoryId AND deleted_at IS NULL', { categoryId })).toEqual({ n: 0 });
    });
});
