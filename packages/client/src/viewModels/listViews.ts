/*
 * Modos de visualização das listas laterais (desktop-mvp-plan Fase 13.4): Metas mostra por padrão
 * só as ativas, e as atingidas e as arquivadas ficam a um clique; Contas e Cartões mostram as
 * ativas ou as desativadas. Mora no `client` para que o celular filtre igual.
 */

/** Visualização de Metas. */
export type GoalListView = 'active' | 'reached' | 'archived';

/** Visualização de Contas e Cartões. */
export type RegistryListView = 'active' | 'disabled';

/** As visualizações de Metas, na ordem do seletor. */
export const GOAL_LIST_VIEWS: readonly GoalListView[] = ['active', 'reached', 'archived'];

/** As visualizações de Contas e Cartões, na ordem do seletor. */
export const REGISTRY_LIST_VIEWS: readonly RegistryListView[] = ['active', 'disabled'];

/** Rótulo de cada visualização de Metas. */
const GOAL_VIEW_LABELS: Readonly<Record<GoalListView, string>> = { active: 'Ativas', reached: 'Atingidas', archived: 'Arquivadas' };

/**
 * @param view Visualização de Metas.
 * @return O rótulo do seletor.
 */
export function formatGoalListView(view: GoalListView): string {
    return GOAL_VIEW_LABELS[view];
}

/**
 * @param view Visualização de Contas ou Cartões.
 * @param gender Gênero do cadastro: "Ativas/Desativadas" (contas) ou "Ativos/Desativados" (cartões).
 * @return O rótulo do seletor.
 */
export function formatRegistryListView(view: RegistryListView, gender: 'feminine' | 'masculine'): string {
    const suffix = gender === 'feminine' ? 'as' : 'os';
    return view === 'active' ? `Ativ${suffix}` : `Desativad${suffix}`;
}

/**
 * Regra de negócio (Metas, desktop-mvp-plan Fase 13.4): ativa é a que ainda se persegue — nem
 * atingida nem arquivada. A meta atingida e arquivada aparece nas duas visualizações (decisão do
 * usuário): quem procura o que já alcançou não precisa lembrar se a arquivou.
 *
 * @param goal Estados da meta.
 * @param view Visualização escolhida.
 * @return Se a meta aparece na visualização.
 */
export function goalInView(goal: { readonly reached: boolean; readonly archived: boolean }, view: GoalListView): boolean {
    switch (view) {
        case 'active':
            return !goal.reached && !goal.archived;
        case 'reached':
            return goal.reached;
        case 'archived':
            return goal.archived;
    }
}

/**
 * Visualização em que uma meta pedida pela URL aparece, quando a tela não tem uma escolhida: um
 * link para a meta arquivada (ou atingida) abre a lista em que ela está, em vez de uma lista
 * em que ela não aparece.
 *
 * @param goal Estados da meta pedida.
 * @return A visualização que a mostra; a arquivada vence a atingida.
 */
export function goalViewOf(goal: { readonly reached: boolean; readonly archived: boolean }): GoalListView {
    return goal.archived ? 'archived' : goal.reached ? 'reached' : 'active';
}

/**
 * @param item Conta ou cartão.
 * @param view Visualização escolhida.
 * @return Se o cadastro aparece na visualização.
 */
export function registryInView(item: { readonly disabled: boolean }, view: RegistryListView): boolean {
    return view === 'disabled' ? item.disabled : !item.disabled;
}

/**
 * @param item Conta ou cartão pedido pela URL.
 * @return A visualização que o mostra.
 */
export function registryViewOf(item: { readonly disabled: boolean }): RegistryListView {
    return item.disabled ? 'disabled' : 'active';
}

/** Uma meta como escolha do campo "Meta" do lançamento. */
export interface GoalChoice {
    readonly id: string;
    /** Nome; a arquivada leva "(arquivada)". */
    readonly label: string;
    /** Grupo do seletor. */
    readonly group: 'Ativas' | 'Atingidas';
}

/**
 * Escolhas do campo "Meta" do lançamento (desktop-mvp-plan Fase 13.4): as atingidas num grupo à
 * parte, depois das ativas, porque raramente se guarda mais numa meta já alcançada.
 * Regra de negócio (Metas): a arquivada não é escolha de lançamento novo; só aparece na edição do
 * lançamento que já está vinculado a ela, marcada, para que o campo não fique em branco.
 *
 * @param options Metas do perfil, como `goals.options` as devolve (por nome).
 * @param currentGoalId Meta do lançamento em edição; `''` ou `null` sem meta.
 * @return As escolhas, as ativas antes das atingidas, cada grupo por nome.
 */
export function goalChoices(
    options: readonly { readonly id: string; readonly name: string; readonly reached: boolean; readonly archived: boolean }[],
    currentGoalId: string | null,
): readonly GoalChoice[] {
    const offered = options.filter((goal) => !goal.archived || goal.id === currentGoalId);
    /**
     * Regra de negócio (Metas, desktop-mvp-plan Fase 13.4): a arquivada só aparece na edição do
     * lançamento já vinculado a ela, e o sufixo "(arquivada)" explica por que ela está ali; as
     * atingidas vão para um grupo à parte.
     *
     * @param goal Meta já filtrada como oferecível ao lançamento.
     * @return A escolha com o rótulo e o grupo ("Ativas" ou "Atingidas") da meta.
     */
    const choice = (goal: (typeof options)[number]): GoalChoice => ({ id: goal.id, label: goal.archived ? `${goal.name} (arquivada)` : goal.name, group: goal.reached ? 'Atingidas' : 'Ativas' });
    return [...offered.filter((goal) => !goal.reached).map(choice), ...offered.filter((goal) => goal.reached).map(choice)];
}
