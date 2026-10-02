import type { Currency } from '../shared/Currency.ts';
import type { ProfileId } from '../shared/ids.ts';

/** Tipo do perfil; controla se sócios existem (database-design §4.1). */
export type ProfileType = 'personal' | 'business';

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
     * @param props Dados do perfil; o construtor é privado para que só `restore` crie
     * instâncias, e a instância é congelada para que nenhuma camada a altere por fora.
     */
    private constructor(props: ProfileProps) {
        this.id = props.id;
        this.name = props.name;
        this.type = props.type;
        this.currency = props.currency;
        Object.freeze(this);
    }

    /**
     * Reconstitui um perfil a partir de dados já persistidos. Não há `create` porque o
     * cadastro de perfis não faz parte do núcleo de lançamentos, que só lê perfis.
     *
     * @param props Dados lidos do banco pelo Repository.
     * @return O perfil.
     */
    public static restore(props: ProfileProps): Profile {
        return new Profile(props);
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
}
