import { roundHalfAwayFromZero } from '@finance/core';
import { MINUS } from './money.ts';

/**
 * Percentual pt-BR a partir de uma proporção do núcleo (`0,166` → `+16,6%`). O zero
 * arredondado aparece como `0%`, sem sinal nem casa decimal, como no mockup do relatório.
 *
 * @param ratio Proporção, como o núcleo entrega (variação, peso nas entradas).
 * @param options.sign `always` para variação (`+16,6%`), `negative` para participação (`32,2%`).
 * @param options.decimals Casas decimais: uma nos relatórios, nenhuma no KPI da Visão geral (`−12%`).
 * @return O percentual formatado.
 */
export function formatPercent(ratio: number, options: { readonly sign: 'always' | 'negative'; readonly decimals: 0 | 1 }): string {
    const value = roundHalfAwayFromZero(ratio * 100, options.decimals);
    if (value === 0) {
        return '0%';
    }
    const prefix = value < 0 ? MINUS : options.sign === 'always' ? '+' : '';
    return `${prefix}${Math.abs(value).toFixed(options.decimals).replace('.', ',')}%`;
}
