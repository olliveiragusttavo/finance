import { matchesAllTerms } from '@finance/client';
import type { CategoryBranchResponse } from '@finance/core';
import { z } from 'zod';

/*
 * Categoria aberta na tela Categorias (desktop-mvp-plan Fase 13.12). Fica na URL como *search
 * param* `category`, e não num estado do React, pelo mesmo motivo de Contas e Cartões: voltar no
 * histórico devolve a categoria que estava aberta, e a categoria criada abre pela navegação.
 */

/** Parâmetros de busca próprios da tela Categorias. */
export interface CategoriesSearch {
    /** Categoria aberta; ausente abre a primeira da lista. */
    readonly category?: string;
}

/** Ids do núcleo são UUIDs; outro texto nunca é uma categoria. */
const categorySchema = z.uuid();

/**
 * Valida a busca da URL. O parâmetro malformado (URL editada) é descartado em vez de derrubar a
 * rota: a tela abre a primeira categoria.
 *
 * @param search Busca crua, como o roteador a leu.
 * @return A categoria pedida, quando o parâmetro tem formato válido.
 */
export function parseCategoriesSearch(search: Readonly<Record<string, unknown>>): CategoriesSearch {
    const category = categorySchema.safeParse(search['category']);
    return category.success ? { category: category.data } : {};
}

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
 * Categoria cujo detalhe a tela mostra. A da URL vale mesmo fora da busca, para que digitar não
 * troque o detalhe aberto; quando ela não existe mais — excluída aqui, ou pedida em outro perfil
 * —, vale a primeira da lista, e a tela nunca fica num detalhe de "não encontrada".
 *
 * @param tree Árvore de categorias do perfil.
 * @param visible Categorias da lista, já filtradas pela busca.
 * @param search Busca já validada.
 * @return A categoria da URL, ou a primeira da lista; `null` quando a lista está vazia.
 */
export function openCategory(tree: readonly CategoryBranchResponse[], visible: readonly CategoryBranchResponse[], search: CategoriesSearch): CategoryBranchResponse | null {
    return tree.find((branch) => branch.id === search.category) ?? visible[0] ?? null;
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
