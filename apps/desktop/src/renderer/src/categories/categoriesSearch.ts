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

