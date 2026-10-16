import type { Note } from '../../domain/note/Note.ts';

/** Anotação serializável; o título da lista sai do próprio texto, na UI. */
export interface NoteResponse {
    readonly id: string;
    readonly profileId: string;
    readonly text: string;
}

/**
 * @param note Anotação do domínio.
 * @return A anotação serializável.
 */
export function toNoteResponse(note: Note): NoteResponse {
    return { id: note.id, profileId: note.profileId, text: note.text };
}
