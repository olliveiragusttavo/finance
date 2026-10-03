import { describe, expect, it } from 'vitest';
import { evolutionWindow } from '../../src/domain/report/BalanceEvolution.ts';
import { cardImpactWindow } from '../../src/domain/report/CardImpactReport.ts';
import { ComparisonBasis } from '../../src/domain/report/Comparison.ts';
import { expenseOutflow } from '../../src/domain/report/ReportTotals.ts';
import { shareOf, Variation } from '../../src/domain/report/Variation.ts';
import { Currency, Money, YearMonth } from '../../src/index.ts';

const BRL = Currency.of('BRL');

/**
 * @param amount Valor em reais.
 * @return O valor como `Money` em BRL, para os testes falarem em números de extrato.
 */
function brl(amount: number): Money {
    return Money.of(amount, BRL);
}

/**
 * @param periods Competências.
 * @return As competências como texto, para comparar listas de meses de uma vez.
 */
function labels(periods: readonly YearMonth[]): string[] {
    return periods.map((period) => period.toString());
}

describe('Base de comparação (R5)', () => {
    it('mês anterior e mesmo mês do ano anterior viram o ano em janeiro', () => {
        const january = YearMonth.of(2026, 1);
        expect(labels(ComparisonBasis.of(january, 'previousMonth').periods)).toEqual(['2025-12']);
        expect(labels(ComparisonBasis.of(january, 'sameMonthLastYear').periods)).toEqual(['2025-01']);
        expect(labels(ComparisonBasis.of(january, 'lastThreeMonthsAverage').periods)).toEqual(['2025-12', '2025-11', '2025-10']);
    });

    it('a média dos 3 meses conta mês sem lançamento como zero', () => {
        const basis = ComparisonBasis.of(YearMonth.of(2026, 3), 'lastThreeMonthsAverage');
        const amounts = new Map([['2026-02', brl(300)], ['2025-12', brl(150)]]);

        // (300 + 0 + 150) / 3 = 150, e não (300 + 150) / 2 = 225.
        expect(basis.valueOf((period) => amounts.get(period.toString()) ?? brl(0), brl(0))).toEqualMoney('150');
    });
});

describe('Variação (R6)', () => {
    it('proporção sobre a base', () => {
        const variation = Variation.between(brl(1142.5), brl(980.1));
        expect(variation.absolute).toEqualMoney('162.40');
        expect(variation.change.kind).toBe('ratio');
        expect(variation.change.kind === 'ratio' ? variation.change.ratio : null).toBeCloseTo(0.1657, 4);
    });

    it('base zero é "novo", não ∞ nem 0%', () => {
        expect(Variation.between(brl(50), brl(0)).change).toEqual({ kind: 'new' });
        expect(Variation.between(brl(-50), brl(0)).change).toEqual({ kind: 'new' });
    });

    it('os dois lados zerados não variaram', () => {
        expect(Variation.between(brl(0), brl(0)).change).toEqual({ kind: 'ratio', ratio: 0 });
    });

    it('base negativa (estornos maiores que compras) divide pelo módulo e mantém o sinal da variação', () => {
        const variation = Variation.between(brl(50), brl(-100));
        expect(variation.absolute).toEqualMoney('150');
        expect(variation.change).toEqual({ kind: 'ratio', ratio: 1.5 });
    });
});

describe('Peso nas entradas (C3)', () => {
    it('total ÷ receitas', () => {
        expect(shareOf(brl(3062.05), brl(9500))).toBeCloseTo(0.3223, 4);
    });

    it('sem receita, ou com receita negativa, o peso é indefinido', () => {
        expect(shareOf(brl(100), brl(0))).toBeNull();
        expect(shareOf(brl(100), brl(-20))).toBeNull();
    });
});

describe('Gasto de uma soma de despesas (R3)', () => {
    it('valor mais encargos, com estorno abatendo', () => {
        expect(expenseOutflow(brl(100), brl(2))).toEqualMoney('102');
        expect(expenseOutflow(brl(-30), brl(0))).toEqualMoney('-30');
    });
});

describe('Janelas dos relatórios', () => {
    it('impacto do cartão: 3 anteriores, referência e seguinte, virando o ano (C5)', () => {
        expect(labels(cardImpactWindow(YearMonth.of(2026, 1)))).toEqual(['2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
        expect(labels(cardImpactWindow(YearMonth.of(2026, 12)))).toEqual(['2026-09', '2026-10', '2026-11', '2026-12', '2027-01']);
    });

    it('evolução do saldo termina no mês de referência', () => {
        expect(labels(evolutionWindow(YearMonth.of(2026, 2), 4))).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
        expect(labels(evolutionWindow(YearMonth.of(2026, 2), 1))).toEqual(['2026-02']);
    });
});
