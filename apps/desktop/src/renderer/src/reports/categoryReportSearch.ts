import { ALL_CATEGORIES, type CategorySelection, type ComparisonMode } from '@finance/client';
import { COMPARISON_MODES } from '@finance/core';
import { z } from 'zod';
import type { TransactionsSearch } from '../transactions/transactionsSearch.ts';

/*
 * Estado do relatório por categoria na URL (mockup `DesktopRelCategoria`; desktop-mvp-plan
 * Fase 11): a comparação escolhida e o nível aberto no drill-down. Ficam na URL, e não num
 * estado do React, para que "Voltar" suba um nível do drill-down e devolva a comparação, como o
 * mês de referência e os filtros de Transações.
 */

/** Parâmetros de busca próprios do relatório por categoria. */
export interface CategoryReportSearch {
    /** Ausente vale o mês anterior, a primeira opção do mockup e a padrão do núcleo. */
    readonly comparison?: ComparisonMode;
    readonly category?: string;
    readonly subCategory?: string;
}

/** A comparação que a tela abre sem nada na URL. */
export const DEFAULT_COMPARISON: ComparisonMode = 'previousMonth';

/** Os parâmetros que o drill-down escreve; trocar de nível substitui os dois de uma vez. */
const SELECTION_KEYS = ['category', 'subCategory'] as const satisfies readonly (keyof CategoryReportSearch)[];

const idSchema = z.uuid();
const comparisonSchema = z.enum(COMPARISON_MODES);

/**
 * Valida a busca da URL. Cada parâmetro inválido é descartado sozinho, como em Transações: um
 * link com uma comparação desconhecida ainda abre o nível do drill-down.
 *
 * @param search Busca crua, como o roteador a leu.
 * @return Só os parâmetros com formato válido; a comparação padrão fica fora, para a URL limpa.
 */
export function parseCategoryReportSearch(search: Readonly<Record<string, unknown>>): CategoryReportSearch {
    const comparison = comparisonSchema.safeParse(search['comparison']);
    const category = idSchema.safeParse(search['category']);
    const subCategory = idSchema.safeParse(search['subCategory']);
    return {
        ...(comparison.success && comparison.data !== DEFAULT_COMPARISON ? { comparison: comparison.data } : {}),
        ...(category.success ? { category: category.data } : {}),
        ...(subCategory.success ? { subCategory: subCategory.data } : {}),
    };
}

/**
 * @param search Busca já validada.
 * @return O nível do drill-down. Com os dois ids, vale a subcategoria, o mais específico — a
 * categoria dela sai do relatório.
 */
export function selectionFromSearch(search: CategoryReportSearch): CategorySelection {
    if (search.subCategory !== undefined) {
        return { kind: 'subCategory', subCategoryId: search.subCategory };
    }
    return search.category === undefined ? ALL_CATEGORIES : { kind: 'category', categoryId: search.category };
}

/**
 * Troca o nível do drill-down na busca atual sem tocar no resto (o mês e a comparação).
 *
 * @param current Busca atual inteira.
 * @param selection Nível a abrir.
 * @return A busca com o nível substituído; na raiz, os dois ids saem da URL.
 */
export function withSelection(current: Readonly<Record<string, unknown>>, selection: CategorySelection): Record<string, unknown> {
    const next: Record<string, unknown> = { ...current };
    for (const key of SELECTION_KEYS) {
        next[key] = undefined;
    }
    if (selection.kind === 'category') {
        next['category'] = selection.categoryId;
    } else if (selection.kind === 'subCategory') {
        next['subCategory'] = selection.subCategoryId;
    }
    return next;
}

/**
 * @param current Busca atual inteira.
 * @param comparison Comparação escolhida.
 * @return A busca com a comparação; a padrão sai da URL. O nível do drill-down continua: a
 * comparação muda os números, não a categoria que se está olhando.
 */
export function withComparison(current: Readonly<Record<string, unknown>>, comparison: ComparisonMode): Record<string, unknown> {
    return { ...current, comparison: comparison === DEFAULT_COMPARISON ? undefined : comparison };
}

/**
 * Filtros com que "Abrir em Transações →" leva o nível aberto para a tela de Transações. O mês
 * vai junto pelo *search param* `period`, que o shell preserva.
 *
 * @param selection Categoria ou subcategoria aberta.
 * @return Os parâmetros de busca de Transações.
 */
export function transactionsSearchFor(selection: Exclude<CategorySelection, { readonly kind: 'all' }>): TransactionsSearch {
    return selection.kind === 'category' ? { category: selection.categoryId } : { subCategory: selection.subCategoryId };
}
