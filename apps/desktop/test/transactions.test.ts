import { NO_TRANSACTION_FILTERS } from '@finance/client';
import { describe, expect, it } from 'vitest';
import {
    categoryFilterValue,
    containerFilterValue,
    filtersFromSearch,
    parseCategoryFilterValue,
    parseContainerFilterValue,
    parseTransactionsSearch,
    searchFromFilters,
    withFilters,
} from '../src/renderer/src/transactions/transactionsSearch.ts';

const NUBANK = '11111111-1111-4111-8111-111111111111';
const ROXINHO = '33333333-3333-4333-8333-333333333333';
const SUB_CATEGORY = '55555555-5555-4555-8555-555555555555';
const TAG = '66666666-6666-4666-8666-666666666666';

describe('filtros de Transações na URL', () => {
    it('descarta cada parâmetro inválido sozinho', () => {
        expect(parseTransactionsSearch({ q: 'mercado', account: NUBANK, card: 'x', tag: TAG, situation: 'pending', period: '2026-10' })).toEqual({
            q: 'mercado',
            account: NUBANK,
            tag: TAG,
            situation: 'pending',
        });
        expect(parseTransactionsSearch({ q: '   ', situation: 'paga', subCategory: 42 })).toEqual({});
    });

    it('vai e volta entre a URL e os filtros do view-model', () => {
        const filters = { ...NO_TRANSACTION_FILTERS, container: { kind: 'creditCard', creditCardId: ROXINHO }, category: { kind: 'subCategory', subCategoryId: SUB_CATEGORY }, tagId: TAG } as const;
        expect(searchFromFilters(filters)).toEqual({ card: ROXINHO, subCategory: SUB_CATEGORY, tag: TAG });
        expect(filtersFromSearch(searchFromFilters(filters))).toEqual(filters);
        expect(searchFromFilters(NO_TRANSACTION_FILTERS)).toEqual({});
    });

    it('um link com conta e cartão, ou categoria e subcategoria, fica com o mais específico', () => {
        const filters = filtersFromSearch({ account: NUBANK, card: ROXINHO, category: TAG, subCategory: SUB_CATEGORY });
        expect(filters.container).toEqual({ kind: 'account', accountId: NUBANK });
        expect(filters.category).toEqual({ kind: 'subCategory', subCategoryId: SUB_CATEGORY });
    });

    it('trocar os filtros preserva o mês de referência e tira os que ficaram vazios', () => {
        const next = withFilters({ period: '2026-10', q: 'velho', card: ROXINHO }, { ...NO_TRANSACTION_FILTERS, situation: 'paid' });
        expect(next).toEqual({ period: '2026-10', q: undefined, account: undefined, card: undefined, category: undefined, subCategory: undefined, tag: undefined, situation: 'paid' });
    });

    it('os campos de conta ou cartão e de categoria vão e voltam, e "Todos" é vazio', () => {
        const account = { kind: 'account', accountId: NUBANK } as const;
        const category = { kind: 'category', categoryId: SUB_CATEGORY } as const;
        expect(parseContainerFilterValue(containerFilterValue(account))).toEqual(account);
        expect(parseCategoryFilterValue(categoryFilterValue(category))).toEqual(category);
        expect(containerFilterValue(null)).toBe('');
        expect(parseContainerFilterValue('')).toBeNull();
        expect(parseContainerFilterValue('account:')).toBeNull();
        expect(parseCategoryFilterValue('outro:1')).toBeNull();
    });
});
