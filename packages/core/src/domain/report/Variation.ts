import type { Money } from '../shared/Money.ts';

/**
 * Como a variação percentual é exibida. União discriminada porque "novo" não é um número:
 * representá-lo como `Infinity`, `0` ou `null` deixaria a tela livre para formatar errado.
 */
export type VariationChange =
    | { readonly kind: 'ratio'; readonly ratio: number }
    | { readonly kind: 'new' };

/**
 * Diferença entre o valor do período e o da base de comparação, em valor e em proporção.
 * Calculada no núcleo, e não na tela, para que desktop e celular mostrem o mesmo número e
 * a mesma regra de base zero.
 */
export class Variation {
    /**
     * @param absolute Valor do período menos o da base; positivo quando cresceu.
     * @param change Proporção da variação sobre a base, ou "novo".
     */
    private constructor(public readonly absolute: Money, public readonly change: VariationChange) {
        Object.freeze(this);
    }

    /**
     * Regra de negócio (Relatórios, R6): com base zero a variação é **"novo"**, e não ∞ nem
     * 0% — divisão por zero não vira número. Os dois lados zerados não variaram: 0%.
     * A proporção é calculada sobre o **módulo** da base, porque a base pode ser negativa
     * (estornos maiores que as compras) e dividir por ela inverteria o sinal da variação.
     * Usa os valores arredondados para que a proporção concorde com os valores exibidos.
     *
     * @param current Valor do período.
     * @param base Valor da base de comparação.
     * @return A variação.
     */
    public static between(current: Money, base: Money): Variation {
        const absolute = current.subtract(base);
        const baseAmount = base.rounded().amount;
        if (baseAmount === 0) {
            return new Variation(absolute, current.rounded().isZero() ? { kind: 'ratio', ratio: 0 } : { kind: 'new' });
        }
        return new Variation(absolute, { kind: 'ratio', ratio: absolute.rounded().amount / Math.abs(baseAmount) });
    }
}

/**
 * Proporção de uma parte sobre um todo — o "peso nas entradas" do impacto do cartão.
 * Regra de negócio (Relatórios, C3): sem receita no mês o peso é **indefinido** (`null`), e
 * não 0% nem ∞. Receita negativa (só devoluções) também é indefinida: um peso negativo não
 * significa nada para quem lê.
 *
 * @param part Valor cuja participação se mede (total das faturas).
 * @param whole Base da proporção (receitas do mês).
 * @return A proporção (0,322 para 32,2%), ou `null` quando a base não é positiva.
 */
export function shareOf(part: Money, whole: Money): number | null {
    const wholeAmount = whole.rounded().amount;
    return wholeAmount > 0 ? part.rounded().amount / wholeAmount : null;
}
