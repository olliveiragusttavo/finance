import type { CategoryBranchResponse, SubCategoryResponse } from '@finance/core';
import { matchesAllTerms } from '../format/searchText.ts';

/*
 * Categorias como as telas as mostram (desktop-mvp-plan Fases 1.4 e 13.12; mobile-mvp-plan
 * Fase 15): a busca, as contagens e a exclusão que move os lançamentos, iguais no desktop e no
 * celular.
 */

/**
 * Categorias da lista lateral que casam com a busca. A categoria entra quando o nome dela ou o
 * de alguma subcategoria casa, porque a lista só mostra categorias: buscar "uber" precisa
 * levar a "Outros", onde a subcategoria está, como o campo "Buscar categoria ou subcategoria" do
 * mockup promete.
 *
 * @param tree Árvore de categorias do perfil, na ordem do núcleo.
 * @param query Texto digitado na busca; vazio devolve a árvore inteira.
 * @return As categorias que casam, na mesma ordem.
 */
export function filterCategories(tree: readonly CategoryBranchResponse[], query: string): readonly CategoryBranchResponse[] {
    return tree.filter((branch) => matchesAllTerms(query, branch.name) || branch.subCategories.some((subCategory) => matchesAllTerms(query, subCategory.name)));
}

/**
 * Resumo sob a busca ("11 categorias · 50 subcategorias"), contado sobre a lista mostrada, para
 * que a busca diga quantas categorias achou.
 *
 * @param branches Categorias da lista.
 * @return A frase com as duas contagens, no singular quando é uma só.
 */
export function formatCategoryCount(branches: readonly CategoryBranchResponse[]): string {
    const subCategories = branches.reduce((total, branch) => total + branch.subCategories.length, 0);
    return `${plural(branches.length, 'categoria', 'categorias')} · ${plural(subCategories, 'subcategoria', 'subcategorias')}`;
}

/**
 * @param branch Categoria com as subcategorias.
 * @return Quantos lançamentos a categoria classifica em todo o período: a soma das
 * subcategorias, porque o lançamento aponta para a subcategoria.
 */
export function categoryTransactionCount(branch: CategoryBranchResponse): number {
    return branch.subCategories.reduce((total, subCategory) => total + subCategory.transactionCount, 0);
}

/**
 * @param count Quantidade.
 * @param singular Palavra para um.
 * @param pluralForm Palavra para zero ou mais de um.
 * @return A quantidade com a palavra concordando.
 */
function plural(count: number, singular: string, pluralForm: string): string {
    return `${String(count)} ${count === 1 ? singular : pluralForm}`;
}

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
    return categoryTransactionCount(target.category);
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

/**
 * @param target O que será excluído.
 * @param toMove Quantos lançamentos precisam ser movidos.
 * @return A frase sob o título: o que some junto e, havendo lançamentos, que eles serão
 * movidos em vez de apagados.
 */
export function describeCategoryDeletion(target: CategoryDeletionTarget, toMove: number): string {
    const subCategories = target.kind === 'category' ? target.category.subCategories.length : 0;
    const together =
        subCategories === 0 ? '' : subCategories === 1 ? 'A subcategoria dela também será excluída. ' : `As ${String(subCategories)} subcategorias dela também serão excluídas. `;
    if (toMove === 0) {
        return `${together}Não há lançamentos nesta ${target.kind === 'category' ? 'categoria' : 'subcategoria'}.`;
    }
    return `${together}Os lançamentos não são apagados: eles passam para a subcategoria escolhida.`;
}
