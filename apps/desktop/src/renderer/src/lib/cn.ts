import { colorTokenNames, fontSizesPx, radiiPx } from '@finance/tokens';
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * `tailwind-merge` configurado com as escalas dos tokens. Sem isso ele não sabe que
 * `text-13` é tamanho e `text-ink` é cor — os dois começam com `text-` — e descartaria um
 * deles ao juntar as classes de um componente com as que a tela passa por `className`.
 */
const merge = extendTailwindMerge({
    override: {
        theme: {
            color: [...colorTokenNames()],
            radius: radiiPx.map(String),
            text: fontSizesPx.map(String),
        },
    },
});

/**
 * Junta classes condicionais e resolve conflitos (a última vence), o contrato dos
 * componentes do shadcn/ui: a tela sobrescreve um estilo do componente sem `!important`.
 *
 * @param inputs Classes, condicionais e listas, no formato do `clsx`.
 * @return As classes sem conflito.
 */
export function cn(...inputs: readonly ClassValue[]): string {
    return merge(clsx(inputs));
}
