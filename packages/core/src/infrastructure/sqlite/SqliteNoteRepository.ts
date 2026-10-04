import { Note } from '../../domain/note/Note.ts';
import { NoteId, ProfileId } from '../../domain/shared/ids.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { Database, SqlRow } from '../../ports/Database.ts';
import type { NoteRepository } from '../../repositories/NoteRepository.ts';
import { RowReader } from './RowReader.ts';

const SELECT_NOTE = 'SELECT n.id, n.profile_id, n.note FROM notes n';

/** Implementação SQLite de `NoteRepository`. */
export class SqliteNoteRepository implements NoteRepository {
    /**
     * @param database Conexão compartilhada da unidade de trabalho.
     * @param clock Relógio que carimba `updated_at` e `deleted_at`.
     */
    public constructor(private readonly database: Database, private readonly clock: Clock) {}

    /**
     * @param id Anotação procurada.
     * @return A anotação viva, ou `null`.
     */
    public findById(id: NoteId): Note | null {
        const row = this.database.get(`${SELECT_NOTE} WHERE n.id = :id AND n.deleted_at IS NULL`, { id });
        return row === undefined ? null : this.toNote(row);
    }

    /**
     * A mais recente primeiro, porque a anotação que se acabou de escrever é a que se procura
     * de novo; empate no instante (duas gravações no mesmo segundo) cai na criação e no id,
     * para a ordem não variar entre leituras.
     *
     * @param profileId Perfil dono.
     * @return As anotações vivas do perfil.
     */
    public listByProfile(profileId: ProfileId): readonly Note[] {
        return this.database
            .all(`${SELECT_NOTE} WHERE n.profile_id = :profileId AND n.deleted_at IS NULL ORDER BY n.updated_at DESC, n.created_at DESC, n.id`, { profileId })
            .map((row) => this.toNote(row));
    }

    /**
     * @param note Anotação a gravar.
     * @return void
     */
    public save(note: Note): void {
        this.database.run(
            `INSERT INTO notes (id, profile_id, note, updated_at)
            VALUES (:id, :profileId, :text, :now)
            ON CONFLICT (id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at
            WHERE notes.deleted_at IS NULL`,
            { id: note.id, profileId: note.profileId, text: note.text, now: this.clock.now() },
        );
    }

    /**
     * @param id Anotação a excluir.
     * @return void
     */
    public softDelete(id: NoteId): void {
        this.database.run('UPDATE notes SET deleted_at = :now, updated_at = :now WHERE id = :id AND deleted_at IS NULL', { id, now: this.clock.now() });
    }

    /**
     * @param row Linha do `SELECT_NOTE`.
     * @return A anotação de domínio.
     */
    private toNote(row: SqlRow): Note {
        const reader = new RowReader('notes', row);
        return Note.restore({ id: NoteId(reader.text('id')), profileId: ProfileId(reader.text('profile_id')), text: reader.text('note') });
    }
}
