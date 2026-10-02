import { BalancePair } from '../balance/BalancePair.ts';
import { bankStatementIdFor } from '../shared/DeterministicIds.ts';
import type { AccountId, BankStatementId } from '../shared/ids.ts';
import type { YearMonth } from '../shared/YearMonth.ts';

/** Dados de um extrato, já validados e tipados. */
export interface BankStatementProps {
    readonly id: BankStatementId;
    readonly accountId: AccountId;
    readonly period: YearMonth;
    /** Saldos inicial do mês: o fechamento do extrato vivo anterior, ou o saldo inicial da conta. */
    readonly opening: BalancePair;
    /** Saldos final do mês: o inicial mais o movimento do mês. */
    readonly closing: BalancePair;
}

/**
 * Extrato mensal de uma conta — o contêiner das transações da conta naquele mês, uma
 * linha por mês (database-design §4.6). Guarda os quatro saldos (inicial e final,
 * consolidado e previsto) para que navegar entre meses e gerar relatórios não precise
 * reconstruir a cadeia inteira de fechamentos; todos são cache da rotina de recálculo.
 */
export class BankStatement implements BankStatementProps {
    public readonly id: BankStatementId;
    public readonly accountId: AccountId;
    public readonly period: YearMonth;
    public readonly opening: BalancePair;
    public readonly closing: BalancePair;

    /**
     * @param props Dados do extrato; privado e congelado para que só a rotina de recálculo
     * produza saldos novos, por transformação imutável.
     */
    private constructor(props: BankStatementProps) {
        this.id = props.id;
        this.accountId = props.accountId;
        this.period = props.period;
        this.opening = props.opening;
        this.closing = props.closing;
        Object.freeze(this);
    }

    /**
     * Abre o extrato de um mês ainda sem linha. O id é o UUID v5 da chave natural
     * (conta, competência), para que dois aparelhos offline abrindo "o extrato de março"
     * derivem o mesmo id (sync-design §5.6). Os saldos nascem iguais ao inicial, sem
     * movimento, e são corrigidos pela rotina de recálculo na mesma unidade de trabalho.
     *
     * @param accountId Conta dona do extrato.
     * @param period Competência do extrato.
     * @param opening Saldo inicial conhecido no momento da abertura.
     * @return O extrato novo.
     */
    public static open(accountId: AccountId, period: YearMonth, opening: BalancePair): BankStatement {
        return new BankStatement({ id: bankStatementIdFor(accountId, period), accountId, period, opening, closing: opening });
    }

    /**
     * @param props Dados lidos do banco pelo Repository.
     * @return O extrato.
     */
    public static restore(props: BankStatementProps): BankStatement {
        return new BankStatement(props);
    }

    /**
     * Movimento do mês, derivado dos saldos persistidos. Existe para a tela de extrato
     * mostrar entradas e saídas líquidas sem refazer a soma das transações.
     *
     * @return Final menos inicial, consolidado e previsto.
     */
    public movement(): BalancePair {
        return BalancePair.of(
            this.closing.consolidated.subtract(this.opening.consolidated),
            this.closing.projected.subtract(this.opening.projected),
        );
    }

    /**
     * Devolve o extrato com os saldos reconstruídos. O fechamento é arredondado aqui, na
     * fronteira de persistência, e não antes: o movimento chega sem arredondamento
     * intermediário (database-design §3.7), e arredondar cada fechamento zera o erro de
     * float acumulado a cada mês (backend-design §3.3).
     *
     * @param opening Saldo inicial: o fechamento já arredondado do extrato anterior.
     * @param movement Movimento do mês, sem arredondamento.
     * @return Um novo extrato com os quatro saldos recalculados.
     */
    public rebalanced(opening: BalancePair, movement: BalancePair): BankStatement {
        return new BankStatement({ id: this.id, accountId: this.accountId, period: this.period, opening, closing: opening.add(movement).rounded() });
    }

    /**
     * @param other Extrato a comparar.
     * @return `true` quando os quatro saldos coincidem dentro do epsilon; usado para não
     * reescrever linhas cujo recálculo não mudou nada.
     */
    public hasSameBalancesAs(other: BankStatement): boolean {
        return this.opening.equals(other.opening) && this.closing.equals(other.closing);
    }
}
