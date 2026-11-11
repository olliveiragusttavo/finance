import type { CategoryBranchResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { filterCategories } from '@finance/client';
import { openCategory, parseCategoriesSearch } from '../src/renderer/src/categories/categoriesSearch.ts';
import { parseNotesSearch } from '../src/renderer/src/notes/notesSearch.ts';

describe('lista e detalhe de categorias (desktop-mvp-plan Fase 13.12)', () => {
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

    it('a URL só aceita um id de categoria; o resto é descartado', () => {
        expect(parseCategoriesSearch({ category: home })).toEqual({ category: home });
        expect(parseCategoriesSearch({ category: 'moradia' })).toEqual({});
        expect(parseCategoriesSearch({})).toEqual({});
    });

    it('abre a categoria da URL mesmo fora da busca; sem ela, ou excluída, a primeira da lista', () => {
        const visible = filterCategories(tree, 'uber');
        expect(openCategory(tree, visible, { category: home })?.name).toBe('Moradia');
        expect(openCategory(tree, visible, {})?.name).toBe('Outros');
        expect(openCategory(tree, tree, { category: 'b7c4a1e2-1111-4c3d-9e8f-00000000dead' })?.name).toBe('Moradia');
        expect(openCategory(tree, [], {})).toBeNull();
    });
});

describe('anotação aberta na URL (mockup DesktopAnotacoes)', () => {
    it('a anotação pedida pela URL vem do `note` (a Visão geral leva a ela, Fase 13.2); pedido vazio é descartado', () => {
        expect(parseNotesSearch({ note: 'n1', period: '2026-10' })).toEqual({ note: 'n1' });
        expect(parseNotesSearch({ note: '' })).toEqual({});
        expect(parseNotesSearch({ note: 42 })).toEqual({});
        expect(parseNotesSearch({})).toEqual({});
    });
});
