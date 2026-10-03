import { InvalidValueError } from '../shared/errors.ts';
import type { AccountId, CreditCardId, ProfileId } from '../shared/ids.ts';
import type { Money } from '../shared/Money.ts';
import { requireName } from '../shared/names.ts';
import type { BillingCycle } from './BillingCycle.ts';

/** Campos que o usuário edita no cadastro do cartão. */
export interface CreditCardContent {
    /** Conta que quita as faturas; recebe as faturas pagas e as em aberto no previsto. */
    readonly accountId: AccountId;
    readonly name: string;
    readonly limit: Money;
    readonly billingCycle: BillingCycle;
}

/** Dados de um cartão de crédito, já validados e tipados. */
export interface CreditCardProps extends CreditCardContent {
    readonly id: CreditCardId;
    readonly profileId: ProfileId;
    /**
     * Regra de negócio (Cartões): desativado, o cartão some das escolhas de lançamentos
     * novos, mas faturas e relatórios continuam (desktop-mvp-plan §5.1).
     */
    readonly disabled: boolean;
}

/**
 * Cartão de crédito, quitado por uma conta do mesmo perfil (database-design §4.5). No
 * núcleo de saldos ele importa pelo ciclo de faturamento — que decide a fatura de cada
 * compra e o mês do vencimento — e pela conta que paga.
 */
export class CreditCard implements CreditCardProps {
    public readonly id: CreditCardId;
    public readonly profileId: ProfileId;
    public readonly accountId: AccountId;
    public readonly name: string;
    public readonly limit: Money;
    public readonly billingCycle: BillingCycle;
    public readonly disabled: boolean;

    /**
     * @param props Dados do cartão; privado e congelado pelos mesmos motivos das demais
     * entidades: um ponto de criação e nenhuma alteração por fora.
     */
    private constructor(props: CreditCardProps) {
        this.id = props.id;
        this.profileId = props.profileId;
        this.accountId = props.accountId;
        this.name = props.name;
        this.limit = props.limit;
        this.billingCycle = props.billingCycle;
        this.disabled = props.disabled;
        Object.freeze(this);
    }

    /**
     * Cadastra um cartão novo, ativo. Que a conta pagadora seja do mesmo perfil e esteja
     * ativa relaciona duas linhas, e por isso é verificado no Service (database-design §3.10).
     *
     * @param id Id gerado pela aplicação (database-design §3.5).
     * @param profileId Perfil dono do cartão.
     * @param content Dados digitados no cadastro; o ciclo já chega validado em 1–31.
     * @return O cartão, com o nome aparado.
     * @throws {InvalidValueError} Quando o nome é inválido ou o limite é negativo.
     */
    public static create(id: CreditCardId, profileId: ProfileId, content: CreditCardContent): CreditCard {
        return new CreditCard({ ...CreditCard.validated(content), id, profileId, disabled: false });
    }

    /**
     * @param props Dados lidos do banco pelo Repository.
     * @return O cartão.
     */
    public static restore(props: CreditCardProps): CreditCard {
        return new CreditCard(props);
    }

    /**
     * Edita os dados do usuário.
     * Regra de negócio (Cartão de crédito): mudar o dia de fechamento **não** move
     * lançamentos existentes — o `invoice_id` gravado é a verdade e a sugestão de fatura
     * nunca é recalculada (database-design §4.7). Por isso editar o ciclo não toca nas
     * faturas; só o mês do vencimento das faturas em aberto muda no previsto.
     *
     * @param content Novo conteúdo completo do cadastro.
     * @return Um novo cartão com os dados trocados.
     * @throws {InvalidValueError} Quando o nome é inválido ou o limite é negativo.
     */
    public revise(content: CreditCardContent): CreditCard {
        return new CreditCard({ ...CreditCard.validated(content), id: this.id, profileId: this.profileId, disabled: this.disabled });
    }

    /**
     * @return Um novo cartão desativado; faturas e lançamentos ficam intactos.
     */
    public disable(): CreditCard {
        return new CreditCard({ ...this.props(), disabled: true });
    }

    /**
     * @return Um novo cartão ativo de novo.
     */
    public enable(): CreditCard {
        return new CreditCard({ ...this.props(), disabled: false });
    }

    /**
     * @param other Conteúdo a comparar.
     * @return `true` quando a conta pagadora ou o ciclo mudam — os dois decidem em que conta
     * e em que mês as faturas pesam no saldo (database-design §4.7), então a mudança obriga a
     * recalcular as contas envolvidas.
     */
    public affectsBalancesWhenRevisedTo(other: CreditCardContent): boolean {
        return this.accountId !== other.accountId
            || this.billingCycle.closingDay !== other.billingCycle.closingDay
            || this.billingCycle.dueDay !== other.billingCycle.dueDay;
    }

    /**
     * Ponto único dos invariantes do conteúdo, usado por `create` e `revise`.
     *
     * @param content Dados a validar.
     * @return Só os campos do conteúdo, copiados um a um para que campos a mais de um comando
     * não vazem para a entidade, com o nome aparado.
     * @throws {InvalidValueError} Quando o nome é inválido ou o limite é negativo.
     */
    private static validated(content: CreditCardContent): CreditCardContent {
        if (content.limit.isNegative()) {
            throw new InvalidValueError('limit', `o limite não pode ser negativo: ${content.limit.toString()}`);
        }
        return {
            accountId: content.accountId,
            name: requireName(content.name),
            limit: content.limit,
            billingCycle: content.billingCycle,
        };
    }

    /**
     * @return Os dados atuais do cartão, copiados campo a campo.
     */
    private props(): CreditCardProps {
        return {
            id: this.id,
            profileId: this.profileId,
            accountId: this.accountId,
            name: this.name,
            limit: this.limit,
            billingCycle: this.billingCycle,
            disabled: this.disabled,
        };
    }
}
