import { invoiceIdFor } from '../shared/DeterministicIds.ts';
import type { BankStatementId, CreditCardId, InvoiceId } from '../shared/ids.ts';
import type { LocalDate } from '../shared/LocalDate.ts';
import { Money } from '../shared/Money.ts';
import type { YearMonth } from '../shared/YearMonth.ts';

/**
 * Onde e quando a fatura foi paga: o extrato da conta no mês do pagamento e o dia. Carrega a
 * competência junto do id porque é ela que decide a partir de que mês o saldo da conta muda;
 * o dia não decide nada, só situa o pagamento entre os movimentos do extrato.
 */
export interface InvoicePayment {
    readonly statementId: BankStatementId;
    readonly period: YearMonth;
    /** `null` nas faturas pagas antes da migration `0003`, que não guardava o dia. */
    readonly date: LocalDate | null;
}

/** Dados de uma fatura, já validados e tipados. */
export interface InvoiceProps {
    readonly id: InvoiceId;
    readonly creditCardId: CreditCardId;
    readonly period: YearMonth;
    /** `null` enquanto a fatura está em aberto. */
    readonly payment: InvoicePayment | null;
    /**
     * Total da fatura com o **sinal do efeito na conta que a quita**: negativo quando há
     * valor a pagar (database-design §4.7). Cache da rotina de recálculo.
     */
    readonly balance: Money;
}

/**
 * Fatura mensal de um cartão — o contêiner das transações do cartão naquele mês
 * (database-design §4.7).
 * Regra de negócio (Fatura): uma fatura está **paga** ou **em aberto**, nunca paga pela
 * metade; pagamento parcial é uma transferência dentro da fatura, não um estado dela.
 */
export class Invoice implements InvoiceProps {
    public readonly id: InvoiceId;
    public readonly creditCardId: CreditCardId;
    public readonly period: YearMonth;
    public readonly payment: InvoicePayment | null;
    public readonly balance: Money;

    /**
     * @param props Dados da fatura; privado e congelado para que pagar, reabrir e recalcular
     * sejam transformações explícitas e imutáveis.
     */
    private constructor(props: InvoiceProps) {
        this.id = props.id;
        this.creditCardId = props.creditCardId;
        this.period = props.period;
        this.payment = props.payment;
        this.balance = props.balance;
        Object.freeze(this);
    }

    /**
     * Abre a fatura de um mês ainda sem linha, em aberto e zerada. O id é o UUID v5 da chave
     * natural (cartão, competência), pelo mesmo motivo do extrato (sync-design §5.6).
     *
     * @param creditCardId Cartão dono da fatura.
     * @param period Competência da fatura.
     * @param zero Zero na moeda do perfil; a fatura nasce sem transações.
     * @return A fatura nova.
     */
    public static open(creditCardId: CreditCardId, period: YearMonth, zero: Money): Invoice {
        return new Invoice({ id: invoiceIdFor(creditCardId, period), creditCardId, period, payment: null, balance: zero });
    }

    /**
     * @param props Dados lidos do banco pelo Repository.
     * @return A fatura.
     */
    public static restore(props: InvoiceProps): Invoice {
        return new Invoice(props);
    }

    /**
     * @return `true` quando a fatura está vinculada ao extrato do mês em que foi paga.
     */
    public isPaid(): boolean {
        return this.payment !== null;
    }

    /**
     * Regra de negócio (Fatura): pagar vincula a fatura ao extrato do mês do pagamento, para
     * que a movimentação do cartão entre no saldo da conta dona (database-design §4.7).
     *
     * @param payment Extrato do mês do pagamento e o dia em que ele aconteceu.
     * @return A fatura paga.
     */
    public pay(payment: InvoicePayment): Invoice {
        return this.with({ payment });
    }

    /**
     * Regra de negócio (Fatura): reabrir desfaz o pagamento — o valor sai do extrato onde
     * tinha sido pago e o saldo da conta volta como se o pagamento não tivesse acontecido
     * (database-design §4.7).
     *
     * @return A fatura em aberto.
     */
    public reopen(): Invoice {
        return this.with({ payment: null });
    }

    /**
     * @param balance Total recalculado das transações da fatura, já arredondado.
     * @return A fatura com o cache de total substituído.
     */
    public withBalance(balance: Money): Invoice {
        return this.with({ balance });
    }

    /**
     * Cópia imutável com campos trocados. Cópia explícita, e não spread da instância, porque o
     * spread de uma classe perde o protótipo e copiaria qualquer campo que viesse a existir.
     *
     * @param changes Campos que mudam.
     * @return Uma nova fatura.
     */
    private with(changes: Partial<InvoiceProps>): Invoice {
        return new Invoice({
            id: changes.id ?? this.id,
            creditCardId: changes.creditCardId ?? this.creditCardId,
            period: changes.period ?? this.period,
            payment: changes.payment === undefined ? this.payment : changes.payment,
            balance: changes.balance ?? this.balance,
        });
    }
}

/**
 * Valor a pagar de uma fatura, em módulo, como a tela mostra (database-design §4.7).
 * Regra de negócio (Fatura): fatura credora (estornos maiores que as compras) conta como
 * zero — crédito não paga outra fatura nem libera limite de outro mês. Fica no domínio
 * para que a lista de cartões e os relatórios apliquem a mesma regra.
 *
 * @param balance Total da fatura com o sinal do efeito na conta (negativo quando há o que pagar).
 * @return O valor a pagar; zero quando a fatura é credora ou está zerada.
 */
export function amountDue(balance: Money): Money {
    return balance.isNegative() ? balance.negate() : Money.zero(balance.currency);
}
