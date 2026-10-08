import { InvalidValueError } from '../shared/errors.ts';
import type { GoalId, ProfileId } from '../shared/ids.ts';
import type { LocalDate } from '../shared/LocalDate.ts';
import type { Money } from '../shared/Money.ts';
import { requireName } from '../shared/names.ts';

/** Campos que o usuário edita numa meta. */
export interface GoalContent {
    readonly name: string;
    /** Valor-alvo, na moeda do perfil; sempre maior que zero. */
    readonly target: Money;
    /** Data até a qual o valor deve estar guardado; `null` numa meta sem prazo (reserva de emergência). */
    readonly targetDate: LocalDate | null;
}

/** Dados de uma meta, já validados e tipados. */
export interface GoalProps extends GoalContent {
    readonly id: GoalId;
    readonly profileId: ProfileId;
}

/**
 * Objetivo de guardar um valor, de um perfil (database-design §4.11; mockup `DesktopMetas`).
 * Regra de negócio (Metas): a meta é um alvo de **economia** — um valor que se quer juntar —,
 * alimentado pelas receitas e transferências vinculadas a ela; o progresso não é coluna, é
 * sempre a soma dessas transações (`GoalProgress`). A entidade guarda só o alvo.
 */
export class Goal implements GoalProps {
    public readonly id: GoalId;
    public readonly profileId: ProfileId;
    public readonly name: string;
    public readonly target: Money;
    public readonly targetDate: LocalDate | null;

    /**
     * @param props Dados da meta; privado e congelado para que toda criação e edição passe
     * pelos invariantes de `create` e `revise`.
     */
    private constructor(props: GoalProps) {
        this.id = props.id;
        this.profileId = props.profileId;
        this.name = props.name;
        this.target = props.target;
        this.targetDate = props.targetDate;
        Object.freeze(this);
    }

    /**
     * @param props Dados da meta, com id já gerado pela aplicação.
     * @return A meta, com o nome aparado.
     * @throws {InvalidValueError} Quando o nome está vazio ou passa de 45 caracteres, ou o
     * valor-alvo não é maior que zero.
     */
    public static create(props: GoalProps): Goal {
        return new Goal(Goal.validated(props));
    }

    /**
     * Reconstitui uma meta persistida sem revalidar. A linha passou por `create` ou `revise` ao
     * ser gravada; revalidar a cada leitura faria uma linha antiga — gravada por outra versão do
     * app ou recebida pela sincronização, antes de uma regra mais estrita — derrubar a lista de
     * metas inteira, em vez de só ser recusada quando o usuário a editar.
     *
     * @param props Dados lidos do banco pelo Repository.
     * @return A meta.
     */
    public static restore(props: GoalProps): Goal {
        return new Goal(props);
    }

    /**
     * @param content Novo conteúdo completo da meta.
     * @return Uma nova meta com o conteúdo trocado; as transações vinculadas continuam
     * vinculadas, porque o vínculo é pelo id.
     * @throws {InvalidValueError} Quando o nome ou o valor-alvo é inválido.
     */
    public revise(content: GoalContent): Goal {
        return new Goal(Goal.validated({ ...content, id: this.id, profileId: this.profileId }));
    }

    /**
     * Ponto único dos invariantes da linha.
     * Regra de negócio (Metas): o valor-alvo é maior que zero — com alvo zero ou negativo não
     * há o que juntar, e o percentual dividiria por zero.
     *
     * @param props Dados a validar.
     * @return Os mesmos dados, com o nome aparado.
     * @throws {InvalidValueError} Quando o nome ou o valor-alvo é inválido.
     */
    private static validated(props: GoalProps): GoalProps {
        const name = requireName(props.name);
        const target = props.target.rounded();
        if (target.isZero() || target.isNegative()) {
            throw new InvalidValueError('value', `o valor-alvo precisa ser maior que zero: ${props.target.amount}`);
        }
        return { ...props, name, target };
    }
}
