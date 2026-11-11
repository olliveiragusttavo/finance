import { themeVariables, type ThemeName } from '@finance/tokens';
import { StatusBar } from 'expo-status-bar';
import { vars } from 'nativewind';
import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme, View } from 'react-native';

/** Tema escolhido no aparelho; `system` acompanha o sistema operacional, como no desktop. */
export type ThemePreference = 'system' | 'light' | 'dark';

/**
 * As variáveis de cada tema, montadas uma vez: trocar de tema é trocar o objeto de estilo da
 * raiz, sem recalcular nada nem re-renderizar cada tela com outra classe.
 */
const THEME_STYLES = { light: vars(themeVariables('light')), dark: vars(themeVariables('dark')) } as const;

/** O tema efetivo, para o que não lê classe (barra de status, cor de componente nativo). */
const ThemeContext = createContext<ThemeName>('light');

/**
 * @param preference Escolha do aparelho.
 * @param system Esquema do sistema operacional; `null` ou `unspecified` quando ele não diz.
 * @return O tema a aplicar; o claro quando o sistema não informa.
 */
export function resolveTheme(preference: ThemePreference, system: string | null | undefined): ThemeName {
    if (preference !== 'system') {
        return preference;
    }
    return system === 'dark' ? 'dark' : 'light';
}

/**
 * Raiz do tema (decisão de interface 1 dos mockups): aplica as variáveis de cor do tema
 * efetivo na raiz, e toda classe de cor (`bg-surface`, `text-ink`) lê a variável — o mesmo
 * mecanismo da classe `.dark` no desktop, com os mesmos tokens. A preferência vem das
 * preferências do aparelho; até a tela de Ajustes existir, é sempre `system`.
 *
 * @param props.preference Escolha do aparelho.
 * @param props.children O app.
 * @return A árvore com o tema aplicado.
 */
export function ThemeRoot({ preference = 'system', children }: { readonly preference?: ThemePreference; readonly children: ReactNode }): ReactNode {
    const theme = resolveTheme(preference, useColorScheme());
    return (
        <ThemeContext value={theme}>
            <View style={THEME_STYLES[theme]} className="flex-1 bg-bg">
                <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
                {children}
            </View>
        </ThemeContext>
    );
}

/** @return O tema efetivo, para quem precisa do valor e não da classe. */
export function useTheme(): ThemeName {
    return useContext(ThemeContext);
}
