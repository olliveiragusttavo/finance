import type { CategoryBranchResponse, CoreError } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { categoryTransactionCount, filterCategories, formatCategoryCount, openCategory, parseCategoriesSearch } from '../src/renderer/src/categories/categoriesSearch.ts';
import { moveTargets, transactionsToMove } from '../src/renderer/src/categories/categoryMoves.ts';
import { placeCoreError } from '../src/renderer/src/lib/coreErrorField.ts';
import { readNameForm } from '../src/renderer/src/lib/nameForm.ts';
import { filterNotes, noteTitle, readNoteForm } from '../src/renderer/src/notes/noteForm.ts';
import { parseNotesSearch } from '../src/renderer/src/notes/notesSearch.ts';
import { emptyProfileForm, PROFILE_FIELDS, readProfileForm } from '../src/renderer/src/profiles/profileForm.ts';

/**
 * @param code Código do erro.
 * @param details Detalhes do erro.
 * @return Um erro como atravessa a fronteira do núcleo.
 */
function coreError(code: CoreError['code'], details: CoreError['details']): CoreError {
    return { code, message: 'técnico', details };
}

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

describe('recusa do núcleo no formulário', () => {
    it('conflito de nome vai para baixo do campo do nome', () => {
        const placed = placeCoreError(coreError('CONFLICT', { entity: 'category', field: 'name', name: 'Moradia' }), { name: 'name' });
        expect(placed).toEqual({ field: 'name', message: 'Já existe uma categoria com o nome "Moradia". Escolha outro nome.' });
    });

    it('Regra de negócio (Perfis, §5): moeda travada vai para baixo do campo da moeda', () => {
        const placed = placeCoreError(coreError('BUSINESS_RULE_VIOLATION', { rule: 'profile-currency-locked', field: 'currency' }), { currency: 'currency' });
        expect(placed).toEqual({ field: 'currency', message: 'A moeda do perfil não pode mudar depois que há lançamentos.' });
    });

    it('campo que o formulário não tem, ou erro sem campo, vai para o aviso geral', () => {
        expect(placeCoreError(coreError('NOT_FOUND', { entity: 'Account' }), { name: 'name' }).field).toBeNull();
        expect(placeCoreError(coreError('BUSINESS_RULE_VIOLATION', { rule: 'account-disabled', field: 'accountId' }), { name: 'name' }).field).toBeNull();
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
});

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

    it('a busca acha a categoria pelo nome dela ou pelo de uma subcategoria, sem diferenciar maiúsculas nem acentos', () => {
        expect(filterCategories(tree, '').map((branch) => branch.name)).toEqual(['Moradia', 'Outros']);
        expect(filterCategories(tree, 'UBER').map((branch) => branch.name)).toEqual(['Outros']);
        expect(filterCategories(tree, 'moradía').map((branch) => branch.name)).toEqual(['Moradia']);
        expect(filterCategories(tree, 'xyz')).toEqual([]);
    });

    it('abre a categoria da URL mesmo fora da busca; sem ela, ou excluída, a primeira da lista', () => {
        const visible = filterCategories(tree, 'uber');
        expect(openCategory(tree, visible, { category: home })?.name).toBe('Moradia');
        expect(openCategory(tree, visible, {})?.name).toBe('Outros');
        expect(openCategory(tree, tree, { category: 'b7c4a1e2-1111-4c3d-9e8f-00000000dead' })?.name).toBe('Moradia');
        expect(openCategory(tree, [], {})).toBeNull();
    });

    it('conta as categorias mostradas e os lançamentos pela soma das subcategorias', () => {
        expect(formatCategoryCount(tree)).toBe('2 categorias · 3 subcategorias');
        expect(formatCategoryCount(filterCategories(tree, 'uber'))).toBe('1 categoria · 1 subcategoria');
        expect(formatCategoryCount([])).toBe('0 categorias · 0 subcategorias');
        expect(tree.map(categoryTransactionCount)).toEqual([6, 1]);
    });
});

describe('anotações (mockup DesktopAnotacoes)', () => {
    /**
     * @param id Id da anotação.
     * @param text Texto.
     * @return Uma anotação como `notes.list` a devolve.
     */
    const note = (id: string, text: string): { readonly id: string; readonly profileId: string; readonly text: string } => ({ id, profileId: 'p', text });
    const notes = [note('a', 'IPTU 2027\nCota única vence em fevereiro.'), note('b', 'Reembolsos pendentes\nConferir a tag reembolsável.')];

    it('o editor exige texto, aparado como o núcleo grava; não há limite de tamanho', () => {
        expect(readNoteForm('  \n Lembrete \n')).toEqual({ ok: true, text: 'Lembrete' });
        expect(readNoteForm(' \n ')).toEqual({ ok: false, error: 'Escreva a anotação antes de salvar.' });
        expect(readNoteForm('a'.repeat(20_000)).ok).toBe(true);
    });

    it('a busca procura no texto inteiro, sem diferenciar maiúsculas nem acentos', () => {
        expect(filterNotes(notes, 'fevereiro').map((found) => found.id)).toEqual(['a']);
        expect(filterNotes(notes, 'REEMBOLSAVEL').map((found) => found.id)).toEqual(['b']);
        expect(filterNotes(notes, '  ')).toEqual(notes);
        expect(filterNotes(notes, 'aluguel')).toEqual([]);
    });

    it('o título é a primeira linha', () => {
        expect(notes.map(noteTitle)).toEqual(['IPTU 2027', 'Reembolsos pendentes']);
    });

    it('a anotação pedida pela URL vem do `note` (a Visão geral leva a ela, Fase 13.2); pedido vazio é descartado', () => {
        expect(parseNotesSearch({ note: 'n1', period: '2026-10' })).toEqual({ note: 'n1' });
        expect(parseNotesSearch({ note: '' })).toEqual({});
        expect(parseNotesSearch({ note: 42 })).toEqual({});
        expect(parseNotesSearch({})).toEqual({});
    });
});
