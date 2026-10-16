import type { VariationResponse } from '@finance/core';
import { formatMoney } from './money.ts';
import { formatPercent } from './percent.ts';

/** Direção da variação: subiu, caiu ou ficou igual, no centavo exibido. */
export type VariationDirection = 'up' | 'down' | 'flat';

/** Variação pronta para a tabela do relatório. */
export interface VariationView {
    readonly direction: VariationDirection;
    /** `▲`, `▼` ou `=`: a direção não pode depender só da cor (decisão de interface 7). */
    readonly arrow: '▲' | '▼' | '=';
    /** `+R$ 162,40`, `−R$ 122,68` ou `R$ 0,00`. */
    readonly absolute: string;
    /** `+16,6%`, `−20,1%`, `0%`, ou `novo` quando a base é zero. */
    readonly percent: string;
}

const ARROWS = { up: '▲', down: '▼', flat: '=' } as const;

/**
 * Formata a variação do núcleo como o relatório mostra: seta, valor com sinal e percentual.
 * Regra de negócio (Relatórios, R6): com base zero o percentual é "novo", nunca ∞ nem 0% —
 * o núcleo já entrega `change.kind = 'new'` e aqui só se escolhe o texto
 * (reports-design §3). A direção sai do valor arredondado, para que um centavo de ruído
 * nunca mostre `▲` ao lado de `R$ 0,00`.
 *
 * @param variation Variação calculada pelo núcleo.
 * @return Seta, valor e percentual formatados; a cor (subir é ruim em despesa) fica com a tela.
 */
export function formatVariation(variation: VariationResponse): VariationView {
    const amount = variation.absolute.amount;
    const direction: VariationDirection = amount > 0 ? 'up' : amount < 0 ? 'down' : 'flat';
    return {
        direction,
        arrow: ARROWS[direction],
        absolute: formatMoney(variation.absolute, 'always'),
        percent: variation.change.kind === 'new' ? 'novo' : formatPercent(variation.change.ratio, { sign: 'always', decimals: 1 }),
    };
}
