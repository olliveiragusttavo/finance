import { GOAL_LIST_VIEWS, goalInView, goalViewOf, type GoalListView } from '@finance/client';
import type { GoalProgressResponse } from '@finance/core';
import { z } from 'zod';

/*
 * Meta aberta na tela Metas (mockup `DesktopMetas`; desktop-mvp-plan Fase 9.3). Fica na URL como
 * *search param* `goal`, como a conta aberta em Contas, para que voltar no histórico devolva a
 * meta que estava aberta. A visualização da lista (ativas, atingidas ou arquivadas,
 * desktop-mvp-plan Fase 13.4) fica em `view`.
 */

/** Parâmetros de busca próprios da tela Metas. */
export interface GoalsSearch {
    /** Meta aberta; ausente abre a primeira da lista. */
    readonly goal?: string;
    /** Visualização da lista; ausente segue a meta pedida, ou mostra as ativas. */
    readonly view?: GoalListView;
}

/** Ids do núcleo são UUIDs; outro texto nunca é uma meta. */
const goalSchema = z.uuid();

/**
 * Valida a busca da URL. Cada parâmetro malformado (URL editada) é descartado sozinho em vez de
 * derrubar a rota.
 *
 * @param search Busca crua, como o roteador a leu.
 * @return Só os parâmetros com formato válido.
 */
export function parseGoalsSearch(search: Readonly<Record<string, unknown>>): GoalsSearch {
    const goal = goalSchema.safeParse(search['goal']);
    const view = z.enum(GOAL_LIST_VIEWS).safeParse(search['view']);
    return { ...(goal.success ? { goal: goal.data } : {}), ...(view.success ? { view: view.data } : {}) };
}

/**
 * Metas da lista lateral na visualização da URL. Sem `view`, a meta pedida decide: o resumo da
 * Visão geral leva a uma meta atingida e abre a lista das atingidas, em vez de uma lista em que
 * ela não aparece.
 *
 * @param goals Metas do perfil.
 * @param search Busca já validada.
 * @return A visualização e as metas dela, por nome.
 */
export function goalListView(goals: readonly GoalProgressResponse[], search: GoalsSearch): { readonly view: GoalListView; readonly goals: readonly GoalProgressResponse[] } {
    const requested = goals.find((goal) => goal.id === search.goal);
    const view = search.view ?? (requested === undefined ? 'active' : goalViewOf(requested));
    return { view, goals: goals.filter((goal) => goalInView(goal, view)) };
}

/**
 * Meta cujo detalhe a tela mostra. A da URL pode não existir mais — excluída aqui mesmo, ou de
 * outro perfil depois da troca — ou não estar na visualização escolhida, e então vale a primeira
 * da lista.
 *
 * @param goals Metas do perfil.
 * @param search Busca já validada.
 * @return A meta da URL, ou a primeira da visualização; `null` quando ela está vazia.
 */
export function openGoal(goals: readonly GoalProgressResponse[], search: GoalsSearch): GoalProgressResponse | null {
    const visible = goalListView(goals, search).goals;
    return visible.find((goal) => goal.id === search.goal) ?? visible[0] ?? null;
}
