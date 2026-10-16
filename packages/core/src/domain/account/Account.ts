import { BalancePair } from '../balance/BalancePair.ts';
import { Currency } from '../shared/Currency.ts';
import type { AccountId, ProfileId } from '../shared/ids.ts';
import type { Money } from '../shared/Money.ts';
import { requireName } from '../shared/names.ts';

/** Tipo da conta (database-design §4.4). */
export type AccountType = 'checking' | 'investment';

export const ACCOUNT_TYPES: readonly AccountType[] = ['checking', 'investment'];

/** Campos que o usuário edita no cadastro da conta. */
export interface AccountContent {
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
}

/** Dados de uma conta, já validados e tipados. */
export interface AccountProps extends AccountContent {
    readonly id: AccountId;
    readonly profileId: ProfileId;
    /**
     * Regra de negócio (Contas): desativada, a conta some das escolhas de lançamentos novos
     * mas continua em extratos, saldos e relatórios (desktop-mvp-plan §5.1).
     */
    readonly disabled: boolean;
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
    public readonly disabled: boolean;
    public readonly balances: BalancePair;

    /**
     * @param props Dados da conta; privado para que instâncias venham só de `create`,
     * `restore` ou de transformações imutáveis, e congelado para que nenhuma camada altere o
     * cache por fora.
     */
    private constructor(props: AccountProps) {
        this.id = props.id;
        this.profileId = props.profileId;
        this.name = props.name;
        this.type = props.type;
        this.currencyLabel = props.currencyLabel;
        this.considerBalance = props.considerBalance;
        this.openingBalance = props.openingBalance;
        this.disabled = props.disabled;
        this.balances = props.balances;
        Object.freeze(this);
    }

    /**
     * Cadastra uma conta nova, ativa. O cache nasce igual ao saldo inicial porque uma conta
     * sem extrato mostra o próprio saldo inicial (database-design §4.4).
     *
     * @param id Id gerado pela aplicação (database-design §3.5).
     * @param profileId Perfil dono da conta.
     * @param content Dados digitados no cadastro.
     * @return A conta, com nome e rótulo de moeda normalizados.
     * @throws {InvalidValueError} Quando o nome ou o código da moeda é inválido.
     */
    public static create(id: AccountId, profileId: ProfileId, content: AccountContent): Account {
        const valid = Account.validated(content);
        return new Account({
            ...valid,
            id,
            profileId,
            disabled: false,
            balances: BalancePair.same(valid.openingBalance.rounded()),
        });
    }

    /**
     * @param props Dados lidos do banco pelo Repository.
     * @return A conta.
     */
    public static restore(props: AccountProps): Account {
        return new Account(props);
    }

    /**
     * Edita os dados do usuário. O cache de saldo é mantido como está: se o saldo inicial
     * mudou, quem edita precisa pedir o recálculo da cadeia inteira, que é a única rotina
     * que escreve saldos (backend-design §3.3).
     *
     * @param content Novo conteúdo completo do cadastro.
     * @return Uma nova conta com os dados trocados.
     * @throws {InvalidValueError} Quando o nome ou o código da moeda é inválido.
     */
    public revise(content: AccountContent): Account {
        return new Account({ ...this.props(), ...Account.validated(content) });
    }

    /**
     * Regra de negócio (Contas): desativar não apaga nada nem muda saldo nenhum
     * (desktop-mvp-plan §5.1) — por isso é a ação padrão no lugar de excluir.
     *
     * @return Uma nova conta desativada.
     */
    public disable(): Account {
        return new Account({ ...this.props(), disabled: true });
    }

    /**
     * @return Uma nova conta ativa de novo.
     */
    public enable(): Account {
        return new Account({ ...this.props(), disabled: false });
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
        return new Account({ ...this.props(), balances });
    }

    /**
     * @param other Conteúdo a comparar.
     * @return `true` quando o saldo inicial difere do desta conta — o que obriga a recalcular
     * todos os extratos, já que todos dependem dele (database-design §4.4).
     */
    public openingBalanceDiffersFrom(other: AccountContent): boolean {
        return !this.openingBalance.equals(other.openingBalance);
    }

    /**
     * Ponto único dos invariantes do conteúdo, usado por `create` e `revise`.
     *
     * @param content Dados a validar.
     * @return Só os campos do conteúdo, copiados um a um — um comando com campos a mais (o id
     * de uma edição) não pode sobrescrever identidade por spread —, com nome aparado e rótulo
     * de moeda em maiúsculas.
     * @throws {InvalidValueError} Quando o nome ou o código da moeda é inválido.
     */
    private static validated(content: AccountContent): AccountContent {
        return {
            type: content.type,
            considerBalance: content.considerBalance,
            openingBalance: content.openingBalance,
            name: requireName(content.name),
            // O rótulo não é unidade, mas tem o mesmo domínio do `ck_accounts_currency`;
            // `Currency.of` é o único validador de código ISO do núcleo.
            currencyLabel: Currency.of(content.currencyLabel).code,
        };
    }

    /**
     * Cópia explícita dos campos, pelo mesmo motivo de `Invoice.with`: o spread de uma
     * classe perde o protótipo.
     *
     * @return Os dados atuais da conta.
     */
    private props(): AccountProps {
        return {
            id: this.id,
            profileId: this.profileId,
            name: this.name,
            type: this.type,
            currencyLabel: this.currencyLabel,
            considerBalance: this.considerBalance,
            openingBalance: this.openingBalance,
            disabled: this.disabled,
            balances: this.balances,
        };
    }
}
