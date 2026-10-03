import type { Category } from '../../domain/category/Category.ts';
import type { SubCategory } from '../../domain/category/SubCategory.ts';

/** Uma subcategoria com quantos lançamentos vivos ela classifica. */
export interface SubCategoryUsage {
    readonly subCategory: SubCategory;
    readonly transactionCount: number;
}

/** Uma categoria com as subcategorias dela, por nome. */
export interface CategoryBranch {
    readonly category: Category;
    readonly subCategories: readonly SubCategoryUsage[];
}

/**
 * A árvore categoria → subcategoria do perfil, como a tela de Cadastros mostra. Fica fora do
 * arquivo do `CategoryService` para que a camada DTO dependa só do contrato de saída.
 */
export type CategoryTree = readonly CategoryBranch[];
