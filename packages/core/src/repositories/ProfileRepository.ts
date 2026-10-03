import type { Profile } from '../domain/profile/Profile.ts';
import type { ProfileId } from '../domain/shared/ids.ts';

/** Acesso aos perfis. */
export interface ProfileRepository {
    /**
     * @param id Perfil procurado.
     * @return O perfil vivo, ou `null` quando não existe ou foi excluído.
     */
    findById(id: ProfileId): Profile | null;

    /**
     * @return Os perfis vivos, por nome — a lista do seletor de perfil.
     */
    list(): readonly Profile[];

    /**
     * Insere o perfil novo ou regrava os dados do usuário de um existente. Um único método
     * porque o perfil não tem cache derivado: tudo nele é dado do usuário.
     *
     * @param profile Perfil a gravar.
     * @return void
     */
    save(profile: Profile): void;

    /**
     * @param id Perfil consultado.
     * @return `true` quando o perfil tem ao menos uma transação viva; é o que torna a troca
     * de moeda insegura, porque os valores lançados ficariam com a unidade errada.
     */
    hasTransactions(id: ProfileId): boolean;
}
