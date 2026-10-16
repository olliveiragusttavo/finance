import { InvalidValueError } from '../shared/errors.ts';
import type { AccountId, GoalId, ProfileId } from '../shared/ids.ts';
import type { LocalDate } from '../shared/LocalDate.ts';
import type { Money } from '../shared/Money.ts';
import { requireName } from '../shared/names.ts';

/**
 * De onde vem o progresso da meta (database-design §4.11, desktop-mvp-plan Fase 13.3):
 * - `transactions`: soma dos lançamentos vinculados pelo campo "Meta" — as transferências de
 *   retirada descontam;
 * - `account`: o saldo consolidado de hoje de uma conta de investimento; nenhum lançamento se
 *   vincula a ela, porque o depósito já é qualquer movimento da conta.
 */
export type GoalFunding = { readonly kind: 'transactions' } | { readonly kind: 'account'; readonly accountId: AccountId };

/** Campos que o usuário edita numa meta. */
export interface GoalContent {
    readonly name: string;
    readonly funding: GoalFunding;
    /** Valor-alvo, na moeda do perfil; sempre maior que zero. */
    readonly target: Money;
    /** Data até a qual o valor deve estar guardado; `null` numa meta sem prazo (reserva de emergência). */
    readonly targetDate: LocalDate | null;
}

/** Dados de uma meta, já validados e tipados. */
export interface GoalProps extends GoalContent {
    readonly id: GoalId;
    readonly profileId: ProfileId;
    /**
     * Arquivada: fora da lista padrão de Metas e das escolhas de lançamentos novos, mas com os
     * vínculos e o progresso intactos (database-design §4.11, migration `0006`). Não é conteúdo:
     * muda só por `archive`/`unarchive`, nunca pela edição.
     */
    readonly archived: boolean;
}

/**
 * Objetivo de guardar um valor, de um perfil (database-design §4.11; mockup `DesktopMetas`).
 * Regra de negócio (Metas): a meta é um alvo de **economia** — um valor que se quer juntar —,
 * alimentado pelos lançamentos vinculados a ela ou pelo saldo de uma conta de investimento
 * (`GoalFunding`); o progresso não é coluna, é sempre calculado (`GoalProgress`). A entidade
 * guarda o alvo e de onde o progresso vem.
 */
export class Goal implements GoalProps {
    public readonly id: GoalId;
    public readonly profileId: ProfileId;
    public readonly name: string;
    public readonly funding: GoalFunding;
    public readonly target: Money;
    public readonly targetDate: LocalDate | null;
    public readonly archived: boolean;

    /**
     * @param props Dados da meta; privado e congelado para que toda criação e edição passe
     * pelos invariantes de `create` e `revise`.
     */
    private constructor(props: GoalProps) {
        this.id = props.id;
        this.profileId = props.profileId;
        this.name = props.name;
        this.funding = props.funding;
        this.target = props.target;
        this.targetDate = props.targetDate;
        this.archived = props.archived;
        Object.freeze(this);
    }

    /**
     * @param props Dados da meta, com id já gerado pela aplicação; toda meta nasce ativa.
     * @return A meta, com o nome aparado.
     * @throws {InvalidValueError} Quando o nome está vazio ou passa de 45 caracteres, ou o
     * valor-alvo não é maior que zero.
     */
    public static create(props: Omit<GoalProps, 'archived'>): Goal {
        return new Goal(Goal.validated({ ...props, archived: false }));
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
     * @return `true` quando a meta recebe lançamentos pelo campo "Meta"; a vinculada a uma conta
     * não recebe (regra `goal-funded-by-account`).
     */
    public acceptsTransactions(): boolean {
        return this.funding.kind === 'transactions';
    }

    /**
     * @param content Novo conteúdo completo da meta.
     * @return Uma nova meta com o conteúdo trocado; as transações vinculadas continuam
     * vinculadas, porque o vínculo é pelo id — quem os desfaz ao trocar para a meta vinculada a
     * conta é o `GoalService`.
     * @throws {InvalidValueError} Quando o nome ou o valor-alvo é inválido.
     */
    public revise(content: GoalContent): Goal {
        return new Goal(Goal.validated({ ...content, id: this.id, profileId: this.profileId, archived: this.archived }));
    }

    /**
     * Regra de negócio (Metas, desktop-mvp-plan Fase 13.4): arquivar tira a meta de vista — da
     * lista padrão e das escolhas de lançamentos novos — sem apagar nada; é o que se faz com a
     * meta concluída ou abandonada que ainda conta uma história.
     *
     * @return A meta arquivada; já arquivada continua arquivada.
     */
    public archive(): Goal {
        return new Goal({ ...this.props(), archived: true });
    }

    /**
     * @return A meta de volta às ativas; já ativa continua ativa.
     */
    public unarchive(): Goal {
        return new Goal({ ...this.props(), archived: false });
    }

    /**
     * Cópia dos dados, para as operações que trocam só o arquivamento sem repassar pela validação
     * do conteúdo (que não muda).
     *
     * @return Os dados da meta.
     */
    private props(): GoalProps {
        return { id: this.id, profileId: this.profileId, name: this.name, funding: this.funding, target: this.target, targetDate: this.targetDate, archived: this.archived };
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
