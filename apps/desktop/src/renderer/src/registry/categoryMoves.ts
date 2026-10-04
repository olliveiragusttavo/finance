import type { CategoryBranchResponse, SubCategoryResponse } from '@finance/core';

/** O que vai ser excluído: uma categoria inteira ou uma subcategoria. */
export type CategoryDeletionTarget =
    | { readonly kind: 'category'; readonly category: CategoryBranchResponse }
    | { readonly kind: 'subCategory'; readonly category: CategoryBranchResponse; readonly subCategory: SubCategoryResponse & { readonly transactionCount: number } };

/** Grupo de destinos da lista "mover para", com o nome da categoria como rótulo. */
export interface MoveTargetGroup {
    readonly categoryId: string;
    readonly categoryName: string;
    readonly subCategories: readonly SubCategoryResponse[];
}

/**
 * @param target Categoria ou subcategoria a excluir.
 * @return Quantos lançamentos a exclusão precisa mover; numa categoria, a soma das
 * subcategorias, porque todas somem juntas.
 */
export function transactionsToMove(target: CategoryDeletionTarget): number {
    if (target.kind === 'subCategory') {
        return target.subCategory.transactionCount;
    }
    return target.category.subCategories.reduce((total, subCategory) => total + subCategory.transactionCount, 0);
}

/**
 * Destinos possíveis dos lançamentos de uma exclusão. Regra de negócio (Categorias,
 * desktop-mvp-plan Fase 1.4): excluir subcategoria em uso exige mover os lançamentos antes, e
 * o destino não pode ser uma das subcategorias que somem junto — a própria subcategoria, ou
 * qualquer uma da categoria excluída. A lista já sai sem elas, para que o núcleo nunca precise
 * recusar a escolha (`move-target-deleted`).
 *
 * @param tree Árvore de categorias do perfil.
 * @param target Categoria ou subcategoria a excluir.
 * @return As subcategorias que sobrevivem, agrupadas por categoria; grupos vazios saem.
 */
export function moveTargets(tree: readonly CategoryBranchResponse[], target: CategoryDeletionTarget): readonly MoveTargetGroup[] {
    return tree
        .filter((branch) => target.kind === 'subCategory' || branch.id !== target.category.id)
        .map((branch) => ({
            categoryId: branch.id,
            categoryName: branch.name,
            subCategories: branch.subCategories.filter((subCategory) => target.kind === 'category' || subCategory.id !== target.subCategory.id),
        }))
        .filter((group) => group.subCategories.length > 0);
}
