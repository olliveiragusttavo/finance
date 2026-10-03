import type { Money } from '../shared/Money.ts';
import { YearMonth } from '../shared/YearMonth.ts';

/** Base de comparação do relatório por categoria (reports-design §3, R5). */
export type ComparisonMode = 'previousMonth' | 'sameMonthLastYear' | 'lastThreeMonthsAverage';

export const COMPARISON_MODES: readonly ComparisonMode[] = ['previousMonth', 'sameMonthLastYear', 'lastThreeMonthsAverage'];

/** Quantos meses a média móvel cobre. */
const AVERAGE_WINDOW = 3;

/**
 * Os meses contra os quais o mês de referência é comparado. Existe como Value Object para
 * que a aritmética de meses da comparação (virada de ano no "mesmo mês do ano anterior" e
 * na média de janeiro) e o divisor da média fiquem num lugar só, em vez de espalhados pela
 * consulta e pela tela.
 */
export class ComparisonBasis {
    /**
     * @param mode Modo pedido pela tela; volta no DTO para rotular a coluna.
     * @param periods Meses da base, do mais recente para o mais antigo.
     */
    private constructor(public readonly mode: ComparisonMode, public readonly periods: readonly YearMonth[]) {
        Object.freeze(this);
    }

    /**
     * @param reference Mês de referência do relatório.
     * @param mode Modo de comparação escolhido na tela.
     * @return A base com os meses que a formam.
     * @throws {InvalidValueError} Quando algum mês da base sai da faixa de anos do schema.
     */
    public static of(reference: YearMonth, mode: ComparisonMode): ComparisonBasis {
        switch (mode) {
            case 'previousMonth':
                return new ComparisonBasis(mode, [reference.previous()]);
            case 'sameMonthLastYear':
                return new ComparisonBasis(mode, [YearMonth.of(reference.year - 1, reference.month)]);
            case 'lastThreeMonthsAverage': {
                const periods: YearMonth[] = [];
                let period = reference;
                for (let i = 0; i < AVERAGE_WINDOW; i++) {
                    period = period.previous();
                    periods.push(period);
                }
                return new ComparisonBasis(mode, periods);
            }
        }
    }

    /**
     * Valor da base: a média simples dos meses que a formam (um só mês nos dois primeiros
     * modos).
     * Regra de negócio (Relatórios, R5): a média dos 3 meses anteriores conta **mês sem
     * lançamento como zero** — divide sempre por 3. Dividir só pelos meses com movimento
     * faria um gasto esporádico parecer recorrente.
     *
     * @param amountIn Valor de um mês da base; devolve zero quando o mês não tem lançamento.
     * @param zero Zero na moeda do perfil, ponto de partida da soma.
     * @return O valor de comparação.
     */
    public valueOf(amountIn: (period: YearMonth) => Money, zero: Money): Money {
        const sum = this.periods.reduce((total, period) => total.add(amountIn(period)), zero);
        return sum.times(1 / this.periods.length);
    }

    /**
     * @param period Mês a testar.
     * @return `true` quando o mês faz parte da base.
     */
    public includes(period: YearMonth): boolean {
        return this.periods.some((candidate) => candidate.equals(period));
    }
}

/**
 * Soma valores de mesma moeda. Existe porque somar uma lista vazia precisa de um zero na
 * moeda certa, que só o chamador conhece.
 *
 * @param values Valores a somar.
 * @param zero Zero na moeda do perfil.
 * @return A soma; `zero` quando a lista é vazia.
 */
export function sumMoney(values: readonly Money[], zero: Money): Money {
    return values.reduce((total, value) => total.add(value), zero);
}
