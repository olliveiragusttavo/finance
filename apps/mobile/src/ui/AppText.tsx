import type { ReactNode } from 'react';
import { Text, type TextProps } from 'react-native';

/**
 * @param className Classes do chamador.
 * @return As classes com a fonte dos mockups e, só quando o chamador não define, o tamanho
 * (15px) e a cor (`ink`) base. Os padrões entram condicionalmente, e não como prefixo, porque no
 * NativeWind duas classes em conflito resolvem pela ordem da folha de estilos gerada, e não pela
 * ordem na string: um `text-13` do chamador perderia para o `text-15` da base.
 */
export function appTextClassName(className: string): string {
    const hasSize = /(?:^|\s)text-\d/.test(className);
    const hasColor = /(?:^|\s)text-(?!\d)[a-z]/.test(className);
    return ['font-sans', hasSize ? '' : 'text-15', hasColor ? '' : 'text-ink', className].filter((part) => part !== '').join(' ');
}

/**
 * Texto do app com a fonte e a cor base dos mockups (IBM Plex Sans, `ink`, 15px). O React Native
 * não herda fonte do pai como o CSS, então sem este componente cada `Text` precisaria repetir a
 * família e a cor, e o primeiro esquecido apareceria na fonte do sistema.
 *
 * @param props Propriedades do `Text`; `className` complementa ou substitui a base.
 * @return O texto.
 */
export function AppText({ className = '', ...props }: TextProps & { readonly className?: string }): ReactNode {
    return <Text className={appTextClassName(className)} {...props} />;
}
