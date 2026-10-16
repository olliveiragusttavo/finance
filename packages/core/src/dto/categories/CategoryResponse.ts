import type { Category } from '../../domain/category/Category.ts';
import type { SubCategory } from '../../domain/category/SubCategory.ts';
import type { CategoryTree } from '../../services/category/CategoryTree.ts';

/** Categoria serializável. */
export interface CategoryResponse {
    readonly id: string;
    readonly profileId: string;
    readonly name: string;
}

/** Subcategoria serializável. */
export interface SubCategoryResponse {
    readonly id: string;
    readonly categoryId: string;
    readonly name: string;
}

/** Subcategoria na árvore, com quantos lançamentos ela classifica ("12 lanç."). */
export interface SubCategoryUsageResponse extends SubCategoryResponse {
    readonly transactionCount: number;
}

/** Categoria na árvore, com as subcategorias. */
export interface CategoryBranchResponse extends CategoryResponse {
    readonly subCategories: readonly SubCategoryUsageResponse[];
}

/**
 * @param category Categoria do domínio.
 * @return A categoria serializável.
 */
export function toCategoryResponse(category: Category): CategoryResponse {
    return { id: category.id, profileId: category.profileId, name: category.name };
}

/**
 * @param subCategory Subcategoria do domínio.
 * @return A subcategoria serializável.
 */
export function toSubCategoryResponse(subCategory: SubCategory): SubCategoryResponse {
    return { id: subCategory.id, categoryId: subCategory.categoryId, name: subCategory.name };
}

/**
 * A contagem vai pronta porque é ela que diz à UI se a exclusão precisa pedir para onde
 * mover os lançamentos.
 *
 * @param tree Árvore montada pelo Service.
 * @return A árvore serializável, na ordem do Service.
 */
export function toCategoryTreeResponse(tree: CategoryTree): readonly CategoryBranchResponse[] {
    return tree.map(({ category, subCategories }) => ({
        ...toCategoryResponse(category),
        subCategories: subCategories.map(({ subCategory, transactionCount }) => ({ ...toSubCategoryResponse(subCategory), transactionCount })),
    }));
}
