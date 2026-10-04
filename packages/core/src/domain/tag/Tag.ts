import type { ProfileId, TagId } from '../shared/ids.ts';
import { requireName } from '../shared/names.ts';

/** Dados de uma tag, já validados e tipados. */
export interface TagProps {
    readonly id: TagId;
    readonly profileId: ProfileId;
    readonly name: string;
}

/**
 * Etiqueta livre de um perfil, aplicada a vários lançamentos — e um lançamento pode ter
 * várias (database-design §4.10). Diferente da categoria, não classifica: cruza categorias
 * ("viagem-floripa" junta hotel, restaurante e combustível). Pertence ao perfil para que
 * pessoal e empresarial mantenham vocabulários separados (§3.8).
 */
export class Tag implements TagProps {
    public readonly id: TagId;
    public readonly profileId: ProfileId;
    public readonly name: string;

    /**
     * @param props Dados da tag; privado e congelado como as demais entidades.
     */
    private constructor(props: TagProps) {
        this.id = props.id;
        this.profileId = props.profileId;
        this.name = props.name;
        Object.freeze(this);
    }

    /**
     * A unicidade do nome no perfil relaciona linhas e por isso é verificada no Service
     * (database-design §3.10); aqui só o invariante da própria linha.
     *
     * @param props Dados da tag, com id já gerado pela aplicação.
     * @return A tag, com o nome aparado.
     * @throws {InvalidValueError} Quando o nome está vazio ou passa de 45 caracteres.
     */
    public static create(props: TagProps): Tag {
        return new Tag({ ...props, name: requireName(props.name) });
    }

    /**
     * @param props Dados lidos do banco pelo Repository.
     * @return A tag.
     */
    public static restore(props: TagProps): Tag {
        return new Tag(props);
    }

    /**
     * @param name Novo nome, como o usuário digitou.
     * @return Uma nova tag com o nome trocado; os lançamentos marcados continuam marcados,
     * porque o vínculo é pelo id.
     * @throws {InvalidValueError} Quando o nome está vazio ou passa de 45 caracteres.
     */
    public rename(name: string): Tag {
        return new Tag({ id: this.id, profileId: this.profileId, name: requireName(name) });
    }
}
