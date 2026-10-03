import type { Category } from '../domain/category/Category.ts';
import type { SubCategory } from '../domain/category/SubCategory.ts';
import type { CategoryId, ProfileId, SubCategoryId } from '../domain/shared/ids.ts';

/**
 * Acesso às categorias e subcategorias. Toda leitura considera só linhas vivas, e uma
 * subcategoria só está viva se a categoria dela também estiver: uma subcategoria de
 * categoria excluída não classifica mais nada.
 */
export interface CategoryRepository {
    /**
     * @param id Categoria procurada.
     * @return A categoria viva, ou `null`.
     */
    findCategory(id: CategoryId): Category | null;

    /**
     * @param id Subcategoria procurada.
     * @return A subcategoria viva de categoria viva, com o perfil dono, ou `null`.
     */
    findSubCategory(id: SubCategoryId): SubCategory | null;

    /**
     * @param profileId Perfil dono.
     * @return As categorias vivas do perfil, por nome.
     */
    listCategories(profileId: ProfileId): readonly Category[];

    /**
     * @param profileId Perfil dono.
     * @return As subcategorias vivas das categorias vivas do perfil, por nome.
     */
    listSubCategories(profileId: ProfileId): readonly SubCategory[];

    /**
     * @param profileId Perfil dono.
     * @return Quantas transações vivas apontam para cada subcategoria do perfil; subcategoria
     * sem lançamento fica fora do mapa.
     */
    transactionCounts(profileId: ProfileId): ReadonlyMap<SubCategoryId, number>;

    /**
     * Insere a categoria nova ou regrava o nome de uma existente.
     *
     * @param category Categoria a gravar.
     * @return void
     */
    saveCategory(category: Category): void;

    /**
     * Insere a subcategoria nova ou regrava o nome de uma existente.
     *
     * @param subCategory Subcategoria a gravar.
     * @return void
     */
    saveSubCategory(subCategory: SubCategory): void;

    /**
     * Soft delete da categoria e das subcategorias dela. A propagação é explícita porque o
     * cascade do banco não dispara num `UPDATE` (database-design §3.6).
     *
     * @param id Categoria a excluir.
     * @return void
     */
    softDeleteCategory(id: CategoryId): void;

    /**
     * @param id Subcategoria a excluir.
     * @return void
     */
    softDeleteSubCategory(id: SubCategoryId): void;

    /**
     * Reclassifica as transações vivas de uma subcategoria.
     *
     * @param from Subcategoria de origem.
     * @param to Subcategoria que passa a classificar as transações.
     * @return Quantas transações foram movidas.
     */
    moveTransactions(from: SubCategoryId, to: SubCategoryId): number;
}
