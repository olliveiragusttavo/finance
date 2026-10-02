import { describe, expect, it } from 'vitest';
import { Currency, Money } from '../../src/index.ts';
import { roundHalfAwayFromZero } from '../../src/domain/shared/Money.ts';

const BRL = Currency.of('BRL');

describe('Money — arredondamento meio para longe do zero (backend-design §3.3)', () => {
    it.each([
        // O caso clássico: o double guarda 1,00499999…, e Math.round(x*100)/100 erraria.
        [1.005, 2, 1.01],
        [2.345, 2, 2.35],
        [-2.345, 2, -2.35],
        [0.125, 2, 0.13],
        [-0.125, 2, -0.13],
        [1.004, 2, 1],
        [999.995, 2, 1000],
        [0.1 + 0.2, 2, 0.3],
        [1234.5, 0, 1235],
        [-1234.5, 0, -1235],
        [1.0005, 3, 1.001],
        [0, 2, 0],
        [1e-9, 2, 0],
        [-0.004, 2, 0],
    ])('arredonda %d com %d casas para %d', (value, decimals, expected) => {
        expect(roundHalfAwayFromZero(value, decimals)).toBe(expected);
    });

    it('não devolve -0 (um "-0,00" na tela é defeito visível)', () => {
        expect(Object.is(roundHalfAwayFromZero(-0.001, 2), -0)).toBe(false);
        expect(Object.is(Money.of(-0, BRL).amount, -0)).toBe(false);
    });

    it('usa a precisão da moeda: iene sem casas, dinar kuwaitiano com três', () => {
        expect(Money.of(1234.5, Currency.of('JPY')).rounded().amount).toBe(1235);
        expect(Money.of(1.2345, Currency.of('KWD')).rounded().amount).toBe(1.235);
        expect(Money.of(1.2345, BRL).rounded().amount).toBe(1.23);
    });
});

describe('Money — comparação e operações', () => {
    it('compara com epsilon de meia unidade mínima', () => {
        expect(Money.of(0.1 + 0.2, BRL).equals(Money.of(0.3, BRL))).toBe(true);
        expect(Money.of(10.004, BRL).equals(Money.of(10, BRL))).toBe(true);
        expect(Money.of(10.006, BRL).equals(Money.of(10, BRL))).toBe(false);
    });

    it('recusa operar moedas diferentes', () => {
        expect(() => Money.of(1, BRL).add(Money.of(1, Currency.of('USD')))).toThrow(/moedas diferentes/);
    });

    it('recusa valores não finitos, que contaminariam a cadeia de fechamentos', () => {
        expect(() => Money.of(Number.NaN, BRL)).toThrow();
        expect(() => Money.of(Number.POSITIVE_INFINITY, BRL)).toThrow();
    });

    it('não arredonda valores intermediários: somar mil vezes 0,1 só arredonda no fim', () => {
        let total = Money.zero(BRL);
        for (let index = 0; index < 1000; index++) {
            total = total.add(Money.of(0.1, BRL));
        }
        expect(total).toEqualMoney('100.00');
        expect(total.toString()).toBe('100.00');
    });
});
