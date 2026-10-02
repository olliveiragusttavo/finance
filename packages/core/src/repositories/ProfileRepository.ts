import type { Profile } from '../domain/profile/Profile.ts';
import type { ProfileId } from '../domain/shared/ids.ts';

/** Acesso aos perfis. Só leitura: o núcleo de lançamentos não cadastra perfis. */
export interface ProfileRepository {
    /**
     * @param id Perfil procurado.
     * @return O perfil vivo, ou `null` quando não existe ou foi excluído.
     */
    findById(id: ProfileId): Profile | null;
}
