import type { GoalId, PartnerId, ProfileId, SubCategoryId } from '../domain/shared/ids.ts';

/**
 * Descobre o perfil dono das referências que uma transação aponta. Existe porque a chave
 * estrangeira só garante que a linha existe, não que ela é do **mesmo** perfil — e
 * perfis pessoal e empresarial precisam ficar estritamente separados
 * (database-design §3.8). Cobre os vocabulários que ainda não têm Repository próprio.
 */
export interface ReferenceRepository {
    /**
     * @param id Subcategoria referenciada.
     * @return O perfil dono, via categoria; `null` quando a subcategoria ou a categoria não
     * existe ou foi excluída.
     */
    subCategoryOwner(id: SubCategoryId): ProfileId | null;

    /**
     * @param id Sócio referenciado.
     * @return O perfil dono, ou `null` quando o sócio não existe ou foi excluído.
     */
    partnerOwner(id: PartnerId): ProfileId | null;

    /**
     * @param id Meta referenciada.
     * @return O perfil dono, ou `null` quando a meta não existe ou foi excluída.
     */
    goalOwner(id: GoalId): ProfileId | null;
}
