import type { ReactNode } from 'react';
import { useDevicePreferences } from '../preferences/devicePreferences.tsx';
import { ThemeRoot } from './ThemeRoot.tsx';

/**
 * O tema da preferência do aparelho, para tudo abaixo — inclusive a tela de bloqueio da
 * abertura, que aparece antes do banco e por isso não pode depender dele.
 *
 * @param props.children O app.
 * @return A árvore com o tema aplicado.
 */
export function PreferredTheme({ children }: { readonly children: ReactNode }): ReactNode {
    const { preferences } = useDevicePreferences();
    return <ThemeRoot preference={preferences.theme}>{children}</ThemeRoot>;
}
