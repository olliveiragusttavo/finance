import type { Currency } from '../shared/Currency.ts';
import { InvalidValueError } from '../shared/errors.ts';
import { Money } from '../shared/Money.ts';

/**
 * Os dois saldos que todo saldo de conta e de extrato tem, sempre lado a lado.
 * Regra de negócio (Saldos): **consolidado** soma só transações pagas e faturas pagas — o
 * que já aconteceu; **previsto** soma todas as transações vivas e as faturas em aberto no
 * mês do vencimento — o que vai acontecer se nada mudar (database-design §3.7). Os dois
 * seguem a mesma cadeia e a mesma rotina; existem como par para que nenhum código consiga
 * atualizar um e esquecer o outro.
 */
export class BalancePair {
    /**
     * @param consolidated Saldo do que já foi pago.
     * @param projected Saldo de tudo que está lançado.
     */
    private constructor(public readonly consolidated: Money, public readonly projected: Money) {
        Object.freeze(this);
    }

    /**
     * @param consolidated Saldo consolidado.
     * @param projected Saldo previsto; precisa estar na mesma moeda do consolidado.
     * @return O par.
     * @throws {InvalidValueError} Quando as moedas diferem: os dois lados são o mesmo saldo
     * visto por filtros diferentes, então precisam estar na mesma unidade.
     */
    public static of(consolidated: Money, projected: Money): BalancePair {
        if (!consolidated.currency.equals(projected.currency)) {
            throw new InvalidValueError('currency', `par de saldos com moedas diferentes: ${consolidated.currency.code} e ${projected.currency.code}`);
        }
        return new BalancePair(consolidated, projected);
    }

    /**
     * Par com o mesmo valor nos dois lados. Existe porque o ponto de partida da cadeia — o
     * `opening_balance` da conta — é um fato único, que vale para consolidado e previsto.
     *
     * @param value Valor dos dois saldos.
     * @return O par.
     */
    public static same(value: Money): BalancePair {
        return new BalancePair(value, value);
    }

    /**
     * @param currency Moeda do perfil.
     * @return O par zerado; ponto de partida de um movimento mensal.
     */
    public static zero(currency: Currency): BalancePair {
        return BalancePair.same(Money.zero(currency));
    }

    /**
     * @param other Par a somar, lado a lado.
     * @return A soma, sem arredondamento intermediário.
     */
    public add(other: BalancePair): BalancePair {
        return new BalancePair(this.consolidated.add(other.consolidated), this.projected.add(other.projected));
    }

    /**
     * Soma um efeito ao previsto e, se ele já aconteceu, também ao consolidado. É a forma
     * direta da regra de negócio dos dois saldos.
     *
     * @param effect Efeito no saldo da conta.
     * @param settled `true` quando o efeito já aconteceu (transação paga, fatura paga).
     * @return O par com o efeito aplicado.
     */
    public plusEffect(effect: Money, settled: boolean): BalancePair {
        return new BalancePair(settled ? this.consolidated.add(effect) : this.consolidated, this.projected.add(effect));
    }

    /**
     * @return O par arredondado na precisão da moeda; chamado só na fronteira de persistência.
     */
    public rounded(): BalancePair {
        return new BalancePair(this.consolidated.rounded(), this.projected.rounded());
    }

    /**
     * @param other Par a comparar.
     * @return `true` quando os dois lados são iguais dentro do epsilon da moeda.
     */
    public equals(other: BalancePair): boolean {
        return this.consolidated.equals(other.consolidated) && this.projected.equals(other.projected);
    }
}
