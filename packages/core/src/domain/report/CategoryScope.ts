import type { CategoryId, SubCategoryId } from '../shared/ids.ts';

/**
 * Nível do drill-down do relatório por categoria: a categoria inteira ou uma subcategoria.
 * União discriminada para que a lista de lançamentos nunca receba os dois filtros ao mesmo
 * tempo, nem nenhum.
 */
export type CategoryScope =
    | { readonly kind: 'category'; readonly categoryId: CategoryId }
    | { readonly kind: 'subCategory'; readonly subCategoryId: SubCategoryId };
