import type { Currency } from '../shared/Currency.ts';
import type { ProfileId } from '../shared/ids.ts';
import { requireName } from '../shared/names.ts';

/** Tipo do perfil; controla se sócios existem (database-design §4.1). */
export type ProfileType = 'personal' | 'business';

export const PROFILE_TYPES: readonly ProfileType[] = ['personal', 'business'];

/** Dados de um perfil, já validados e tipados. */
export interface ProfileProps {
    readonly id: ProfileId;
    readonly name: string;
    readonly type: ProfileType;
    readonly currency: Currency;
}

/**
 * Raiz do tenant: tudo pertence a um perfil (database-design §3.8). No núcleo de saldos
 * ele importa por dois motivos — a moeda, que é a unidade de todo valor armazenado, e o
 * tipo, que decide se uma transação pode ter sócio pagador.
 */
export class Profile implements ProfileProps {
    public readonly id: ProfileId;
    public readonly name: string;
    public readonly type: ProfileType;
    public readonly currency: Currency;

    /**
     * @param props Dados do perfil; o construtor é privado para que instâncias venham só de
     * `create`, `restore` ou das transformações, e a instância é congelada para que nenhuma
     * camada a altere por fora.
     */
    private constructor(props: ProfileProps) {
        this.id = props.id;
        this.name = props.name;
        this.type = props.type;
        this.currency = props.currency;
        Object.freeze(this);
    }

    /**
     * Cadastra um perfil novo. A moeda já chega como `Currency`, que só existe com código
     * ISO de três letras em maiúsculas — o mesmo domínio do `ck_profiles_currency`.
     *
     * @param props Dados do perfil, com id já gerado pela aplicação (database-design §3.5).
     * @return O perfil, com o nome aparado.
     * @throws {InvalidValueError} Quando o nome está vazio ou passa de 45 caracteres.
     */
    public static create(props: ProfileProps): Profile {
        return new Profile({ ...props, name: requireName(props.name) });
    }

    /**
     * Reconstitui um perfil a partir de dados já persistidos, sem revalidar.
     *
     * @param props Dados lidos do banco pelo Repository.
     * @return O perfil.
     */
    public static restore(props: ProfileProps): Profile {
        return new Profile(props);
    }

    /**
     * @param name Novo nome, como o usuário digitou.
     * @return Um novo perfil com o nome trocado.
     * @throws {InvalidValueError} Quando o nome está vazio ou passa de 45 caracteres.
     */
    public rename(name: string): Profile {
        return new Profile({ ...this.props(), name: requireName(name) });
    }

    /**
     * Troca a moeda de relatório. Só reetiqueta: nenhum valor é convertido, porque todo
     * valor do banco **é** denominado na moeda do perfil (database-design §4.1) e não existe
     * taxa a aplicar. Quem decide se a troca ainda é segura é o Service, que enxerga os
     * lançamentos do perfil.
     *
     * @param currency Nova moeda do perfil.
     * @return Um novo perfil com a moeda trocada.
     */
    public withCurrency(currency: Currency): Profile {
        return new Profile({ ...this.props(), currency });
    }

    /**
     * Regra de negócio (Perfil): sócios só existem em perfis empresariais
     * (database-design §4.1), então só eles podem registrar quem pagou uma transação.
     *
     * @return `true` quando o perfil aceita sócios.
     */
    public acceptsPartners(): boolean {
        return this.type === 'business';
    }

    /**
     * Cópia explícita dos campos, e não spread da instância, porque o spread de uma classe
     * perde o protótipo e copiaria qualquer campo que viesse a existir.
     *
     * @return Os dados atuais do perfil.
     */
    private props(): ProfileProps {
        return { id: this.id, name: this.name, type: this.type, currency: this.currency };
    }
}
