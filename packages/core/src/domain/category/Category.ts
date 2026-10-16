import type { CategoryId, ProfileId } from '../shared/ids.ts';
import { requireName } from '../shared/names.ts';

/** Dados de uma categoria, já validados e tipados. */
export interface CategoryProps {
    readonly id: CategoryId;
    readonly profileId: ProfileId;
    readonly name: string;
}

/**
 * Nível superior da classificação de dois níveis (database-design §4.8). Pertence a um
 * perfil, e não a um vocabulário global, para que pessoal e empresarial mantenham cada um
 * as suas categorias (§3.8). Não classifica transações diretamente: elas apontam para uma
 * subcategoria.
 */
export class Category implements CategoryProps {
    public readonly id: CategoryId;
    public readonly profileId: ProfileId;
    public readonly name: string;

    /**
     * @param props Dados da categoria; privado e congelado como as demais entidades.
     */
    private constructor(props: CategoryProps) {
        this.id = props.id;
        this.profileId = props.profileId;
        this.name = props.name;
        Object.freeze(this);
    }

    /**
     * A unicidade do nome no perfil relaciona linhas e por isso é verificada no Service
     * (database-design §3.10); aqui só o invariante da própria linha.
     *
     * @param props Dados da categoria, com id já gerado pela aplicação.
     * @return A categoria, com o nome aparado.
     * @throws {InvalidValueError} Quando o nome está vazio ou passa de 45 caracteres.
     */
    public static create(props: CategoryProps): Category {
        return new Category({ ...props, name: requireName(props.name) });
    }

    /**
     * @param props Dados lidos do banco pelo Repository.
     * @return A categoria.
     */
    public static restore(props: CategoryProps): Category {
        return new Category(props);
    }

    /**
     * @param name Novo nome, como o usuário digitou.
     * @return Uma nova categoria com o nome trocado.
     * @throws {InvalidValueError} Quando o nome está vazio ou passa de 45 caracteres.
     */
    public rename(name: string): Category {
        return new Category({ id: this.id, profileId: this.profileId, name: requireName(name) });
    }
}
