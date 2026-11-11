import { useState, type ReactNode } from 'react';
import { useDevicePreferences } from '../preferences/devicePreferences.tsx';
import type { ThemePreference } from '../theme/ThemeRoot.tsx';
import { OptionList, type SelectOption } from '../ui/Select.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { IconButton } from '../ui/IconButton.tsx';

/** As três escolhas, com os rótulos do menu do desktop; o padrão primeiro. */
export const THEME_OPTIONS: readonly SelectOption<ThemePreference>[] = [
    { value: 'system', label: 'Seguir o sistema' },
    { value: 'light', label: 'Tema claro' },
    { value: 'dark', label: 'Tema escuro' },
];

/**
 * Botão de tema do cabeçalho (todos os mockups do celular o têm). Abre uma folha com as três
 * escolhas, e não alterna entre claro e escuro como o mockup, porque "seguir o sistema" é a
 * terceira opção e o padrão — a mesma decisão do desktop (desktop-mvp-plan Fase 4).
 *
 * @return O botão e a folha.
 */
export function ThemeButton(): ReactNode {
    const { preferences, update } = useDevicePreferences();
    const [open, setOpen] = useState(false);
    const current = THEME_OPTIONS.find((option) => option.value === preferences.theme)?.label ?? '';
    return (
        <>
            <IconButton
                icon="theme"
                label={`Tema: ${current}`}
                onPress={() => {
                    setOpen(true);
                }}
            />
            <Sheet
                open={open}
                title="Tema"
                onClose={() => {
                    setOpen(false);
                }}
            >
                <OptionList
                    options={THEME_OPTIONS}
                    value={preferences.theme}
                    onSelect={(theme) => {
                        update({ theme });
                        setOpen(false);
                    }}
                />
            </Sheet>
        </>
    );
}
