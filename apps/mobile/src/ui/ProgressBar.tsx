import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * Barra de progresso dos mockups (limite usado do cartão, progresso da meta): a trilha `track` e o
 * preenchimento `accent`, ou `out` quando passou do limite. Decorativa: quem a usa mostra o
 * percentual em texto ao lado, porque a barra sozinha não é lida pelo leitor de tela.
 *
 * @param props.ratio Preenchimento entre 0 e 1; valores fora disso são cortados.
 * @param props.exceeded Pinta o preenchimento com a cor de saída (limite estourado).
 * @param props.thick Barra mais alta, para o destaque do detalhe da meta.
 * @return A barra.
 */
export function ProgressBar({ ratio, exceeded = false, thick = false }: { readonly ratio: number; readonly exceeded?: boolean; readonly thick?: boolean }): ReactNode {
    const share = Math.min(1, Math.max(0, ratio));
    return (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className={`overflow-hidden rounded-full bg-track ${thick ? 'h-2.5' : 'h-1.5'}`}>
            <View style={{ width: `${String(share * 100)}%` }} className={`h-full ${exceeded ? 'bg-out' : 'bg-accent'}`} />
        </View>
    );
}
