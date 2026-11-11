import type { CategoryBranchResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { categoryTransactionCount, describeCategoryDeletion, filterCategories, formatCategoryCount, moveTargets, transactionsToMove } from '../src/viewModels/categoryView.ts';
import { readNameForm } from '../src/forms/nameForm.ts';
import { emptyProfileForm, PROFILE_FIELDS, readProfileForm } from '../src/forms/profileForm.ts';

describe('nome de categoria e perfil', () => {
    it('nome de categoria: aparado, obrigatório e com o limite do núcleo', () => {
        expect(readNameForm('  Moradia ', 'o nome da categoria')).toEqual({ ok: true, name: 'Moradia' });
        expect(readNameForm('   ', 'o nome da categoria')).toEqual({ ok: false, error: 'Informe o nome da categoria.' });
        expect(readNameForm('a'.repeat(46), 'o nome da subcategoria')).toEqual({ ok: false, error: 'Use no máximo 45 caracteres.' });
    });

    it('perfil: monta o profiles.create, com o nome aparado, e aponta o nome em branco', () => {
        expect(readProfileForm({ name: ' Estúdio ', type: 'business', currency: 'USD' })).toEqual({ ok: true, content: { name: 'Estúdio', type: 'business', currency: 'USD' } });
        expect(readProfileForm(emptyProfileForm())).toEqual({ ok: false, errors: { name: 'Informe o nome do perfil.' } });
        expect([...PROFILE_FIELDS].sort()).toEqual(Object.keys(emptyProfileForm()).sort());
    });
});

describe('mover lançamentos ao excluir categoria', () => {
    const tree: readonly CategoryBranchResponse[] = [
        {
            id: 'food',
            profileId: 'p',
            name: 'Alimentação',
            subCategories: [
                { id: 'market', categoryId: 'food', name: 'Mercado', transactionCount: 3 },
                { id: 'delivery', categoryId: 'food', name: 'Delivery', transactionCount: 2 },
            ],
        },
        { id: 'home', profileId: 'p', name: 'Moradia', subCategories: [{ id: 'rent', categoryId: 'home', name: 'Aluguel', transactionCount: 0 }] },
        { id: 'empty', profileId: 'p', name: 'Vazia', subCategories: [] },
    ];
    const [food] = tree;
    if (food === undefined) {
        throw new Error('cenário sem categoria');
    }
    const [market] = food.subCategories;
    if (market === undefined) {
        throw new Error('cenário sem subcategoria');
    }

    it('subcategoria: move só os lançamentos dela, para qualquer outra subcategoria', () => {
        const target = { kind: 'subCategory', category: food, subCategory: market } as const;
        expect(transactionsToMove(target)).toBe(3);
        expect(moveTargets(tree, target).map((group) => [group.categoryName, group.subCategories.map((sub) => sub.name)])).toEqual([
            ['Alimentação', ['Delivery']],
            ['Moradia', ['Aluguel']],
        ]);
    });

    it('Regra de negócio (Categorias): categoria soma as subcategorias e não oferece nenhuma delas como destino', () => {
        const target = { kind: 'category', category: food } as const;
        expect(transactionsToMove(target)).toBe(5);
        expect(moveTargets(tree, target).map((group) => group.categoryName)).toEqual(['Moradia']);
    });

    it('a frase da exclusão diz o que some junto e que os lançamentos são movidos, não apagados', () => {
        expect(describeCategoryDeletion({ kind: 'category', category: food }, 5)).toBe('As 2 subcategorias dela também serão excluídas. Os lançamentos não são apagados: eles passam para a subcategoria escolhida.');
        expect(describeCategoryDeletion({ kind: 'subCategory', category: food, subCategory: market }, 0)).toBe('Não há lançamentos nesta subcategoria.');
    });
});

describe('busca e contagens de categorias (desktop-mvp-plan Fase 13.12)', () => {
    const home = 'b7c4a1e2-1111-4c3d-9e8f-000000000001';
    const other = 'b7c4a1e2-1111-4c3d-9e8f-000000000002';
    const tree: readonly CategoryBranchResponse[] = [
        {
            id: home,
            profileId: 'p',
            name: 'Moradia',
            subCategories: [
                { id: 'rent', categoryId: home, name: 'Aluguel', transactionCount: 4 },
                { id: 'power', categoryId: home, name: 'Energia', transactionCount: 2 },
            ],
        },
        { id: other, profileId: 'p', name: 'Outros', subCategories: [{ id: 'uber', categoryId: other, name: 'Uber', transactionCount: 1 }] },
    ];

    it('a busca acha a categoria pelo nome dela ou pelo de uma subcategoria, sem diferenciar maiúsculas nem acentos', () => {
        expect(filterCategories(tree, '').map((branch) => branch.name)).toEqual(['Moradia', 'Outros']);
        expect(filterCategories(tree, 'UBER').map((branch) => branch.name)).toEqual(['Outros']);
        expect(filterCategories(tree, 'moradía').map((branch) => branch.name)).toEqual(['Moradia']);
        expect(filterCategories(tree, 'xyz')).toEqual([]);
    });

    it('conta as categorias mostradas e os lançamentos pela soma das subcategorias', () => {
        expect(formatCategoryCount(tree)).toBe('2 categorias · 3 subcategorias');
        expect(formatCategoryCount(filterCategories(tree, 'uber'))).toBe('1 categoria · 1 subcategoria');
        expect(formatCategoryCount([])).toBe('0 categorias · 0 subcategorias');
        expect(tree.map(categoryTransactionCount)).toEqual([6, 1]);
    });
});
