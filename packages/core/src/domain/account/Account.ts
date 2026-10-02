import type { BalancePair } from '../balance/BalancePair.ts';
import type { AccountId, ProfileId } from '../shared/ids.ts';
import type { Money } from '../shared/Money.ts';

/** Tipo da conta (database-design §4.4). */
export type AccountType = 'checking' | 'investment';

/** Dados de uma conta, já validados e tipados. */
export interface AccountProps {
    readonly id: AccountId;
    readonly profileId: ProfileId;
    readonly name: string;
    readonly type: AccountType;
    /** Moeda da conta no mundo real: só rótulo, nunca unidade (database-design §4.4). */
    readonly currencyLabel: string;
    /**
     * Regra de negócio (Contas): desligado tira a conta do total consolidado do perfil,
     * mantendo o próprio histórico — válvula de escape para contas no exterior
     * (database-design §4.4).
     */
    readonly considerBalance: boolean;
    /** Saldo anterior ao primeiro extrato: dado do usuário, não cache. */
    readonly openingBalance: Money;
    /** Cache: consolidado e previsto do fechamento do mês corrente. */
    readonly balances: BalancePair;
}

/**
 * Conta corrente ou de investimentos. Os saldos que ela carrega são um cache derivado
 * (database-design §4.4): existem para a tela inicial abrir sem consultar extrato, e só a
 * rotina de recálculo os escreve.
 */
export class Account implements AccountProps {
    public readonly id: AccountId;
    public readonly profileId: ProfileId;
    public readonly name: string;
    public readonly type: AccountType;
    public readonly currencyLabel: string;
    public readonly considerBalance: boolean;
    public readonly openingBalance: Money;
    public readonly balances: BalancePair;

    /**
     * @param props Dados da conta; privado para que instâncias venham só de `restore` ou de
     * transformações imutáveis, e congelado para que nenhuma camada altere o cache por fora.
     */
    private constructor(props: AccountProps) {
        this.id = props.id;
        this.profileId = props.profileId;
        this.name = props.name;
        this.type = props.type;
        this.currencyLabel = props.currencyLabel;
        this.considerBalance = props.considerBalance;
        this.openingBalance = props.openingBalance;
        this.balances = props.balances;
        Object.freeze(this);
    }

    /**
     * @param props Dados lidos do banco pelo Repository.
     * @return A conta.
     */
    public static restore(props: AccountProps): Account {
        return new Account(props);
    }

    /**
     * Devolve a conta com o cache de saldo substituído. Existe só para a rotina de
     * recálculo: saldos nunca são incrementados, sempre reconstruídos a partir das
     * transações (backend-design §3.3).
     *
     * @param balances Consolidado e previsto do fechamento do mês corrente, já arredondados.
     * @return Uma nova conta com o cache atualizado.
     */
    public withBalances(balances: BalancePair): Account {
        return new Account({
            id: this.id,
            profileId: this.profileId,
            name: this.name,
            type: this.type,
            currencyLabel: this.currencyLabel,
            considerBalance: this.considerBalance,
            openingBalance: this.openingBalance,
            balances,
        });
    }
}
