import type { CategoryId, ProfileId, SubCategoryId } from '../shared/ids.ts';
import { requireName } from '../shared/names.ts';

/** Dados de uma subcategoria, já validados e tipados. */
export interface SubCategoryProps {
    readonly id: SubCategoryId;
    readonly categoryId: CategoryId;
    /**
     * Perfil dono, derivado da categoria. Carregado junto porque toda referência de uma
     * transação precisa ser conferida contra o perfil dela (database-design §3.8).
     */
    readonly profileId: ProfileId;
    readonly name: string;
}

/**
 * Nível inferior da classificação: toda transação aponta para uma subcategoria
 * (database-design §4.9). O nome é único dentro da categoria, não no perfil — "Outros"
 * pode existir em Moradia e em Transporte.
 */
export class SubCategory implements SubCategoryProps {
    public readonly id: SubCategoryId;
    public readonly categoryId: CategoryId;
    public readonly profileId: ProfileId;
    public readonly name: string;

    /**
     * @param props Dados da subcategoria; privado e congelado como as demais entidades.
     */
    private constructor(props: SubCategoryProps) {
        this.id = props.id;
        this.categoryId = props.categoryId;
        this.profileId = props.profileId;
        this.name = props.name;
        Object.freeze(this);
    }

    /**
     * @param props Dados da subcategoria, com id já gerado pela aplicação.
     * @return A subcategoria, com o nome aparado.
     * @throws {InvalidValueError} Quando o nome está vazio ou passa de 45 caracteres.
     */
    public static create(props: SubCategoryProps): SubCategory {
        return new SubCategory({ ...props, name: requireName(props.name) });
    }

    /**
     * @param props Dados lidos do banco pelo Repository.
     * @return A subcategoria.
     */
    public static restore(props: SubCategoryProps): SubCategory {
        return new SubCategory(props);
    }

    /**
     * @param name Novo nome, como o usuário digitou.
     * @return Uma nova subcategoria com o nome trocado.
     * @throws {InvalidValueError} Quando o nome está vazio ou passa de 45 caracteres.
     */
    public rename(name: string): SubCategory {
        return new SubCategory({ id: this.id, categoryId: this.categoryId, profileId: this.profileId, name: requireName(name) });
    }
}
