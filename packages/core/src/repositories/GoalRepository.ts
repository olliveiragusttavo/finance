import type { Goal } from '../domain/goal/Goal.ts';
import type { GoalLink } from '../domain/goal/GoalProgress.ts';
import type { GoalId, ProfileId } from '../domain/shared/ids.ts';

/** Acesso às metas e às transações vinculadas a elas. Toda leitura considera só linhas vivas. */
export interface GoalRepository {
    /**
     * @param id Meta procurada.
     * @return A meta viva, ou `null`.
     */
    findById(id: GoalId): Goal | null;

    /**
     * @param profileId Perfil dono.
     * @return As metas vivas do perfil, por nome.
     */
    listByProfile(profileId: ProfileId): readonly Goal[];

    /**
     * @param profileId Perfil dono.
     * @return As transações vivas vinculadas a cada meta do perfil, pagas ou não; meta sem
     * vínculo fica fora do mapa.
     */
    linksByGoal(profileId: ProfileId): ReadonlyMap<GoalId, readonly GoalLink[]>;

    /**
     * Vínculos de uma meta só, para o detalhe não ler os de todas as metas do perfil.
     *
     * @param goalId Meta consultada.
     * @return As transações vivas vinculadas à meta, pagas ou não; vazio sem vínculo.
     */
    linksOf(goalId: GoalId): readonly GoalLink[];

    /**
     * Insere a meta nova ou regrava o conteúdo de uma existente.
     *
     * @param goal Meta a gravar.
     * @return void
     */
    save(goal: Goal): void;

    /**
     * Soft delete da meta, tirando-a das transações e dos modelos de recorrência que a
     * apontam. A propagação é explícita porque o `ON DELETE SET NULL` do banco não dispara num
     * `UPDATE` (database-design §3.6); as transações em si continuam.
     *
     * @param id Meta a excluir.
     * @return void
     */
    softDelete(id: GoalId): void;
}
