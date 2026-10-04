import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDevicePreferences } from '@/lib/devicePreferences';
import type { ThemePreference } from '../../../shared/bridge.ts';

/** Ordem das opções no menu: o padrão primeiro. */
const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];

/** Rótulo de cada tema, no botão e no menu. */
const THEME_LABELS: Readonly<Record<ThemePreference, string>> = {
    system: 'Seguir o sistema',
    light: 'Tema claro',
    dark: 'Tema escuro',
};

/**
 * @param value Valor vindo do Radix, que tipa o item do menu como `string`.
 * @return Se o valor é um dos temas, para gravar só o que as preferências aceitam.
 */
function isThemePreference(value: string): value is ThemePreference {
    return Object.hasOwn(THEME_LABELS, value);
}

/**
 * Tema claro, escuro ou do sistema, gravado nas preferências do aparelho. É um menu, e não o
 * botão de alternar do mockup, porque "seguir o sistema" é a terceira opção e o padrão
 * (decisão registrada na Fase 4 do plano); o botão mostra o tema escolhido. Tem arquivo
 * próprio, e não fica na barra superior, porque o primeiro uso abre antes do shell e tem o
 * mesmo botão no topo.
 *
 * @return O botão do tema com o menu das opções.
 */
export function ThemeMenu(): ReactNode {
    const { preferences, update } = useDevicePreferences();
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" className="border-line text-13 font-normal">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                        <circle cx="12" cy="12" r="8" />
                        <path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" />
                    </svg>
                    {THEME_LABELS[preferences.theme]}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                    value={preferences.theme}
                    onValueChange={(value) => {
                        if (isThemePreference(value)) {
                            update({ theme: value });
                        }
                    }}
                >
                    {THEMES.map((theme) => (
                        <DropdownMenuRadioItem key={theme} value={theme}>
                            {THEME_LABELS[theme]}
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
