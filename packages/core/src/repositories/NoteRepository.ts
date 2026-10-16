import type { NoteId, ProfileId } from '../domain/shared/ids.ts';
import type { Note } from '../domain/note/Note.ts';

/** Acesso às anotações. Toda leitura considera só linhas vivas. */
export interface NoteRepository {
    /**
     * @param id Anotação procurada.
     * @return A anotação viva, ou `null`.
     */
    findById(id: NoteId): Note | null;

    /**
     * @param profileId Perfil dono.
     * @return As anotações vivas do perfil, da editada mais recentemente para a mais antiga.
     */
    listByProfile(profileId: ProfileId): readonly Note[];

    /**
     * Insere a anotação nova ou regrava o texto de uma existente.
     *
     * @param note Anotação a gravar.
     * @return void
     */
    save(note: Note): void;

    /**
     * @param id Anotação a excluir.
     * @return void
     */
    softDelete(id: NoteId): void;
}
