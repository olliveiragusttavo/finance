import { formatMonthLong } from '@finance/client';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
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
import { useTransactionPanel } from './TransactionPanel.tsx';
import { useReferenceMonth } from './useReferenceMonth.ts';

/**
 * Barra superior fixa do shell (mockups, decisão de interface 2): mês de referência à
 * esquerda, tema e "+ Lançamento" à direita.
 *
 * @param props.showMonth Se a tela depende de período; nas telas de configuração o mês some e
 * a barra mantém só as ações.
 * @return A barra, presa ao topo da área de conteúdo.
 */
export function TopBar({ showMonth }: { readonly showMonth: boolean }): ReactNode {
    const panel = useTransactionPanel();
    return (
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line bg-surface px-8 py-3">
            {showMonth ? <MonthPicker /> : <div />}
            <div className="flex items-center gap-2.5">
                <ThemeMenu />
                <Button onClick={panel.openNew} aria-keyshortcuts="N">
                    + Lançamento
                </Button>
            </div>
        </header>
    );
}

/**
 * Seletor do mês de referência (‹ mês ›) com "Voltar ao mês atual", que só aparece fora do
 * mês corrente, como no mockup.
 *
 * @return O seletor ligado ao *search param* `period`.
 */
function MonthPicker(): ReactNode {
    const month = useReferenceMonth();
    return (
        <div className="flex items-center gap-2.5">
            <span className="text-12 text-muted">Mês de referência</span>
            <div className="flex items-center rounded-8 border border-line bg-bg">
                <button type="button" aria-label="Mês anterior" aria-keyshortcuts="[" onClick={month.previous} className="rounded-8 px-3 py-2 hover:bg-surface2">
                    <ChevronLeftIcon aria-hidden="true" className="size-4" />
                </button>
                <span data-testid="reference-month" aria-live="polite" className="min-w-38 text-center text-14 font-semibold">
                    {formatMonthLong(month.period)}
                </span>
                <button type="button" aria-label="Próximo mês" aria-keyshortcuts="]" onClick={month.next} className="rounded-8 px-3 py-2 hover:bg-surface2">
                    <ChevronRightIcon aria-hidden="true" className="size-4" />
                </button>
            </div>
            {!month.isCurrent && (
                <Button variant="link" size="sm" onClick={month.goToCurrent} className="text-13 font-normal">
                    Voltar ao mês atual
                </Button>
            )}
        </div>
    );
}

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
 * (decisão registrada na Fase 4 do plano); o botão mostra o tema escolhido.
 *
 * @return O botão do tema com o menu das opções.
 */
function ThemeMenu(): ReactNode {
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
