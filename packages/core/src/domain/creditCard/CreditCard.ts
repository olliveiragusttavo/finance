import type { AccountId, CreditCardId, ProfileId } from '../shared/ids.ts';
import type { Money } from '../shared/Money.ts';
import type { BillingCycle } from './BillingCycle.ts';

/** Dados de um cartão de crédito, já validados e tipados. */
export interface CreditCardProps {
    readonly id: CreditCardId;
    readonly profileId: ProfileId;
    /** Conta que quita as faturas; recebe as faturas pagas e as em aberto no previsto. */
    readonly accountId: AccountId;
    readonly name: string;
    readonly limit: Money;
    readonly billingCycle: BillingCycle;
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
        Object.freeze(this);
    }

    /**
     * @param props Dados lidos do banco pelo Repository.
     * @return O cartão.
     */
    public static restore(props: CreditCardProps): CreditCard {
        return new CreditCard(props);
    }
}
