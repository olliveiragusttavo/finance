import type { GoalProgressResponse } from '@finance/core';
import { z } from 'zod';

/*
 * Meta aberta na tela Metas (mockup `DesktopMetas`; desktop-mvp-plan Fase 9.3). Fica na URL como
 * *search param* `goal`, como a conta aberta em Contas, para que voltar no histórico devolva a
 * meta que estava aberta.
 */

/** Parâmetros de busca próprios da tela Metas. */
export interface GoalsSearch {
    /** Meta aberta; ausente abre a primeira da lista. */
    readonly goal?: string;
}

/** Ids do núcleo são UUIDs; outro texto nunca é uma meta. */
const goalSchema = z.uuid();

/**
 * Valida a busca da URL. Um id malformado (URL editada) é descartado em vez de derrubar a rota.
 *
 * @param search Busca crua, como o roteador a leu.
 * @return Só a meta, quando o id tem o formato certo.
 */
export function parseGoalsSearch(search: Readonly<Record<string, unknown>>): GoalsSearch {
    const parsed = goalSchema.safeParse(search['goal']);
    return parsed.success ? { goal: parsed.data } : {};
}

/**
 * Meta cujo detalhe a tela mostra. A da URL pode não existir mais — excluída aqui mesmo, ou de
 * outro perfil depois da troca —, e então vale a primeira.
 *
 * @param goals Metas do perfil.
 * @param search Busca já validada.
 * @return A meta da URL, ou a primeira da lista; `null` quando o perfil não tem meta.
 */
export function openGoal(goals: readonly GoalProgressResponse[], search: GoalsSearch): GoalProgressResponse | null {
    return goals.find((goal) => goal.id === search.goal) ?? goals[0] ?? null;
}
