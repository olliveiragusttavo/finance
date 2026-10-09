import { describe, expect, it } from 'vitest';
import {
    parseCategoryReportSearch,
    selectionFromSearch,
    transactionsSearchFor,
    withComparison,
    withSelection,
} from '../src/renderer/src/reports/categoryReportSearch.ts';

const FOOD = '11111111-1111-4111-8111-111111111111';
const MARKET = '22222222-2222-4222-8222-222222222222';

describe('relatório por categoria na URL (desktop-mvp-plan Fase 11)', () => {
    it('descarta cada parâmetro inválido sozinho e deixa a comparação padrão fora da URL', () => {
        expect(parseCategoryReportSearch({ comparison: 'sameMonthLastYear', category: FOOD, period: '2026-10' })).toEqual({ comparison: 'sameMonthLastYear', category: FOOD });
        expect(parseCategoryReportSearch({ comparison: 'semestre', subCategory: MARKET })).toEqual({ subCategory: MARKET });
        expect(parseCategoryReportSearch({ comparison: 'previousMonth', category: 'não-é-id' })).toEqual({});
    });

    it('com categoria e subcategoria na URL, abre a subcategoria', () => {
        expect(selectionFromSearch({})).toEqual({ kind: 'all' });
        expect(selectionFromSearch({ category: FOOD })).toEqual({ kind: 'category', categoryId: FOOD });
        expect(selectionFromSearch({ category: FOOD, subCategory: MARKET })).toEqual({ kind: 'subCategory', subCategoryId: MARKET });
    });

    it('trocar de nível substitui os dois ids e preserva o mês e a comparação', () => {
        const current = { period: '2026-10', comparison: 'lastThreeMonthsAverage', category: FOOD };
        expect(withSelection(current, { kind: 'subCategory', subCategoryId: MARKET })).toEqual({ period: '2026-10', comparison: 'lastThreeMonthsAverage', category: undefined, subCategory: MARKET });
        expect(withSelection(current, { kind: 'all' })).toEqual({ period: '2026-10', comparison: 'lastThreeMonthsAverage', category: undefined, subCategory: undefined });
    });

    it('trocar a comparação mantém o nível aberto e tira a padrão da URL', () => {
        const current = { period: '2026-10', subCategory: MARKET, comparison: 'sameMonthLastYear' };
        expect(withComparison(current, 'lastThreeMonthsAverage')).toEqual({ period: '2026-10', subCategory: MARKET, comparison: 'lastThreeMonthsAverage' });
        expect(withComparison(current, 'previousMonth')).toEqual({ period: '2026-10', subCategory: MARKET, comparison: undefined });
    });

    it('"Abrir em Transações" leva o nível aberto como filtro de Transações', () => {
        expect(transactionsSearchFor({ kind: 'category', categoryId: FOOD })).toEqual({ category: FOOD });
        expect(transactionsSearchFor({ kind: 'subCategory', subCategoryId: MARKET })).toEqual({ subCategory: MARKET });
    });
});
