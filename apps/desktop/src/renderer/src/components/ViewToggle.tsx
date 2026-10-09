import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Botão da alternância Gráfico/Tabela dos relatórios. `aria-pressed`, e não abas, porque as duas
 * opções mostram o mesmo conteúdo de dois jeitos. Fica num lugar só para que a Visão geral e os
 * relatórios alternem do mesmo jeito.
 *
 * @param props.pressed Se é a opção escolhida.
 * @param props.onClick Escolhe a opção.
 * @param props.children Rótulo.
 * @return O botão.
 */
export function ViewToggle({ pressed, onClick, children }: { readonly pressed: boolean; readonly onClick: () => void; readonly children: string }): ReactNode {
    return (
        <button
            type="button"
            aria-pressed={pressed}
            onClick={onClick}
            className={cn(
                'rounded-6 border px-2.5 py-1.25 text-13 outline-none focus-visible:ring-[3px] focus-visible:ring-accent/50',
                pressed ? 'border-accent bg-soft text-soft-ink' : 'border-line bg-surface text-ink hover:bg-surface2',
            )}
        >
            {children}
        </button>
    );
}
