import { toNoteResponse, type NoteResponse } from '../dto/notes/NoteResponse.ts';
import { createNoteRequest, listNotesRequest, noteIdRequest, rewriteNoteRequest } from '../requests/noteRequests.ts';
import type { NoteService } from '../services/note/NoteService.ts';
import { handle, type CoreResult, type UnexpectedErrorListener } from './CoreResult.ts';

/** Rotas das anotações do perfil. */
export class NoteController {
    /**
     * @param notes Anotações.
     * @param onUnexpected Destino do log de falhas inesperadas.
     */
    public constructor(
        private readonly notes: NoteService,
        private readonly onUnexpected: UnexpectedErrorListener,
    ) {}

    /**
     * @param raw Entrada com o perfil.
     * @return As anotações do perfil, da mais recente para a mais antiga.
     */
    public list(raw: unknown): Promise<CoreResult<readonly NoteResponse[]>> {
        return handle(listNotesRequest, raw, ({ profileId }) => this.notes.list(profileId).map(toNoteResponse), this.onUnexpected);
    }

    /**
     * @param raw Entrada com o perfil e o texto.
     * @return A anotação criada.
     */
    public create(raw: unknown): Promise<CoreResult<NoteResponse>> {
        return handle(createNoteRequest, raw, (command) => toNoteResponse(this.notes.create(command)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com a anotação e o novo texto.
     * @return A anotação reescrita.
     */
    public rewrite(raw: unknown): Promise<CoreResult<NoteResponse>> {
        return handle(rewriteNoteRequest, raw, (command) => toNoteResponse(this.notes.rewrite(command)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com a anotação.
     * @return `null` em caso de sucesso.
     */
    public delete(raw: unknown): Promise<CoreResult<null>> {
        return handle(noteIdRequest, raw, ({ id }) => {
            this.notes.delete(id);
            return null;
        }, this.onUnexpected);
    }
}
