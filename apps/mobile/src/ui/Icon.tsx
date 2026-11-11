import type { ColorTokenName } from '@finance/tokens';
import type { ReactNode } from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import { useThemeColor } from '../theme/ThemeRoot.tsx';

/** Os ícones dos mockups do celular, pelo papel que têm na tela. */
export type IconName = 'home' | 'transactions' | 'accounts' | 'cards' | 'more' | 'search' | 'filter' | 'theme' | 'close' | 'check' | 'plus';

/**
 * Desenho de cada ícone, copiado dos SVGs dos mockups (traço de 1.8 numa grade de 24), para que
 * o celular mostre o mesmo desenho aprovado; o retângulo do cartão vira caminho porque o `x`/`y`
 * do `Rect` está obsoleto no `react-native-svg`. `Record` sobre a união: um nome novo sem desenho
 * quebra a compilação em vez de aparecer vazio.
 *
 * @param stroke Cor do traço (e do preenchimento, onde o mockup usa `currentColor`).
 * @return Os elementos SVG do ícone.
 */
const SHAPES: Readonly<Record<IconName, (stroke: string) => ReactNode>> = {
    home: () => <Path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
    transactions: () => <Path d="M4 6h16M4 12h16M4 18h10" />,
    accounts: () => <Path d="M3 10l9-6 9 6M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18" />,
    cards: () => <Path d="M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18" />,
    more: (stroke) => (
        <>
            <Circle cx="5" cy="12" r="1.5" fill={stroke} />
            <Circle cx="12" cy="12" r="1.5" fill={stroke} />
            <Circle cx="19" cy="12" r="1.5" fill={stroke} />
        </>
    ),
    search: () => (
        <>
            <Circle cx="11" cy="11" r="7" />
            <Path d="M20 20l-4-4" />
        </>
    ),
    filter: () => <Path d="M4 5h16l-6 8v5l-4 2v-7z" />,
    theme: (stroke) => (
        <>
            <Circle cx="12" cy="12" r="8" />
            <Path d="M12 4a8 8 0 0 0 0 16z" fill={stroke} />
        </>
    ),
    close: () => <Path d="M6 6l12 12M18 6L6 18" />,
    check: () => <Path d="M5 12l5 5 9-10" />,
    // O "+" dos mockups é texto; como ícone, fica do mesmo tamanho e traço dos outros botões redondos.
    plus: () => <Path d="M12 5v14M5 12h14" />,
};

/**
 * Ícone dos mockups. Sempre decorativo (escondido do leitor de tela): quem o usa dá o nome
 * acessível ao botão, como os mockups fazem com `aria-label` e `aria-hidden` no SVG.
 *
 * @param props.name Qual ícone.
 * @param props.size Lado em px; 22 na barra inferior e 18 nos botões do cabeçalho, como nos mockups.
 * @param props.tone Token da cor do traço; `ink` por padrão.
 * @return O SVG.
 */
export function Icon({ name, size = 18, tone = 'ink' }: { readonly name: IconName; readonly size?: number; readonly tone?: ColorTokenName }): ReactNode {
    const stroke = useThemeColor(tone);
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" accessible={false} importantForAccessibility="no-hide-descendants">
            {SHAPES[name](stroke)}
        </Svg>
    );
}
