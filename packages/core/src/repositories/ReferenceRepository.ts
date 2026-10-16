import type { PartnerId, ProfileId } from '../domain/shared/ids.ts';

/**
 * Descobre o perfil dono das referências que uma transação aponta. Existe porque a chave
 * estrangeira só garante que a linha existe, não que ela é do **mesmo** perfil — e
 * perfis pessoal e empresarial precisam ficar estritamente separados
 * (database-design §3.8). Cobre os vocabulários que ainda não têm Repository próprio; a
 * subcategoria passou ao `CategoryRepository`, e a meta, ao `GoalRepository`.
 */
export interface ReferenceRepository {
    /**
     * @param id Sócio referenciado.
     * @return O perfil dono, ou `null` quando o sócio não existe ou foi excluído.
     */
    partnerOwner(id: PartnerId): ProfileId | null;
}
