import { DARK_THEME_CLASS } from '@finance/tokens';
import { useEffect } from 'react';
import type { ThemePreference } from '../../../shared/bridge.ts';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Liga o tema na raiz do documento. O tema troca por classe, e as cores vêm das variáveis
 * CSS dos tokens (desktop-shell-design §4.5): trocar de tema não re-renderiza a árvore.
 *
 * @param preference Tema escolhido no aparelho.
 * @param systemPrefersDark Se o sistema operacional está no escuro; decide o `system`.
 */
export function applyTheme(preference: ThemePreference, systemPrefersDark: boolean): void {
    const dark = preference === 'dark' || (preference === 'system' && systemPrefersDark);
    document.documentElement.classList.toggle(DARK_THEME_CLASS, dark);
}

/**
 * Mantém o tema aplicado e, em `system`, acompanha a troca do sistema operacional com o app
 * aberto — quem agenda o modo escuro ao anoitecer espera que a janela mude junto.
 *
 * @param preference Tema escolhido no aparelho.
 */
export function useTheme(preference: ThemePreference): void {
    useEffect(() => {
        const media = window.matchMedia(DARK_QUERY);
        const update = (): void => {
            applyTheme(preference, media.matches);
        };
        update();
        media.addEventListener('change', update);
        return () => {
            media.removeEventListener('change', update);
        };
    }, [preference]);
}
