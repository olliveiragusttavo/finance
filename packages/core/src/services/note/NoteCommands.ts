import type { NoteId, ProfileId } from '../../domain/shared/ids.ts';

/** Anotação nova num perfil. */
export interface CreateNoteCommand {
    readonly profileId: ProfileId;
    readonly text: string;
}

/** Reescrever o texto de uma anotação. */
export interface RewriteNoteCommand {
    readonly id: NoteId;
    readonly text: string;
}
