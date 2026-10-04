import { Note } from '../../domain/note/Note.ts';
import { NotFoundError } from '../../domain/shared/errors.ts';
import { NoteId, type ProfileId } from '../../domain/shared/ids.ts';
import type { IdGenerator } from '../../ports/IdGenerator.ts';
import type { NoteRepository } from '../../repositories/NoteRepository.ts';
import type { ProfileService } from '../profile/ProfileService.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import type { CreateNoteCommand, RewriteNoteCommand } from './NoteCommands.ts';

/**
 * Anotações do perfil (database-design §4.3; mockup `DesktopAnotacoes`). Uma lista simples:
 * sem vínculo com lançamento, sem regra entre linhas — o Service só garante que o perfil
 * existe e que a escrita passa pela unidade de trabalho, como toda escrita do núcleo.
 */
export class NoteService {
    /**
     * @param unitOfWork Leitura, conferência e escrita numa transação só.
     * @param ids Gera o UUID v4 das anotações novas.
     * @param profiles Confere que o perfil existe.
     * @param notes Anotações.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly ids: IdGenerator,
        private readonly profiles: ProfileService,
        private readonly notes: NoteRepository,
    ) {}

    /**
     * @param profileId Perfil consultado.
     * @return As anotações do perfil, da editada mais recentemente para a mais antiga.
     * @throws {NotFoundError} Quando o perfil não existe.
     */
    public list(profileId: ProfileId): readonly Note[] {
        return this.unitOfWork.run(() => {
            this.profiles.require(profileId);
            return this.notes.listByProfile(profileId);
        });
    }

    /**
     * @param command Perfil e texto.
     * @return A anotação gravada.
     * @throws {NotFoundError} Quando o perfil não existe.
     * @throws {InvalidValueError} Quando o texto está vazio.
     */
    public create(command: CreateNoteCommand): Note {
        return this.unitOfWork.run(() => {
            this.profiles.require(command.profileId);
            const note = Note.create({ id: NoteId(this.ids.random()), profileId: command.profileId, text: command.text });
            this.notes.save(note);
            return this.require(note.id);
        });
    }

    /**
     * @param command Anotação e novo texto completo.
     * @return A anotação reescrita.
     * @throws {NotFoundError} Quando a anotação não existe.
     * @throws {InvalidValueError} Quando o texto está vazio.
     */
    public rewrite(command: RewriteNoteCommand): Note {
        return this.unitOfWork.run(() => {
            const rewritten = this.require(command.id).rewrite(command.text);
            this.notes.save(rewritten);
            return this.require(rewritten.id);
        });
    }

    /**
     * @param id Anotação a excluir.
     * @return void
     * @throws {NotFoundError} Quando a anotação não existe.
     */
    public delete(id: NoteId): void {
        this.unitOfWork.run(() => {
            this.notes.softDelete(this.require(id).id);
        });
    }

    /**
     * @param id Anotação procurada.
     * @return A anotação viva.
     * @throws {NotFoundError} Quando não existe.
     */
    private require(id: NoteId): Note {
        const note = this.notes.findById(id);
        if (note === null) {
            throw new NotFoundError('Note', id);
        }
        return note;
    }
}
