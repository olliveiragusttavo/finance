import { InvalidValueError } from '../shared/errors.ts';
import type { NoteId, ProfileId } from '../shared/ids.ts';

/** Dados de uma anotação, já validados e tipados. */
export interface NoteProps {
    readonly id: NoteId;
    readonly profileId: ProfileId;
    /** Texto livre, sem limite de tamanho (database-design §4.3). */
    readonly text: string;
}

/**
 * Observação ou lembrete de um perfil — deliberadamente uma lista simples, sem ligação com
 * lançamento ou conta (database-design §4.3). O texto é livre; a primeira linha serve de
 * título nas listas (decisão de interface 9 dos mockups), e por isso não há campo de título
 * à parte que pudesse discordar do texto.
 */
export class Note implements NoteProps {
    public readonly id: NoteId;
    public readonly profileId: ProfileId;
    public readonly text: string;

    /**
     * @param props Dados da anotação; privado e congelado como as demais entidades.
     */
    private constructor(props: NoteProps) {
        this.id = props.id;
        this.profileId = props.profileId;
        this.text = props.text;
        Object.freeze(this);
    }

    /**
     * @param props Dados da anotação, com id já gerado pela aplicação.
     * @return A anotação, com o texto aparado nas pontas.
     * @throws {InvalidValueError} Quando o texto está vazio.
     */
    public static create(props: NoteProps): Note {
        return new Note({ ...props, text: Note.requireText(props.text) });
    }

    /**
     * @param props Dados lidos do banco pelo Repository.
     * @return A anotação.
     */
    public static restore(props: NoteProps): Note {
        return new Note(props);
    }

    /**
     * @param text Novo texto completo, como o usuário deixou no editor.
     * @return Uma nova anotação com o texto trocado.
     * @throws {InvalidValueError} Quando o texto está vazio.
     */
    public rewrite(text: string): Note {
        return new Note({ id: this.id, profileId: this.profileId, text: Note.requireText(text) });
    }

    /**
     * Apara as pontas porque linhas em branco no começo empurrariam o título para uma linha
     * vazia na lista; um texto só de espaços seria uma anotação invisível.
     *
     * @param raw Texto como o usuário digitou.
     * @return O texto aparado.
     * @throws {InvalidValueError} Quando sobra texto vazio.
     */
    private static requireText(raw: string): string {
        const text = raw.trim();
        if (text.length === 0) {
            throw new InvalidValueError('text', 'a anotação não pode ficar vazia');
        }
        return text;
    }
}
