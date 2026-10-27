import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Barra de progresso das metas, compartilhada pela tela Metas e pelos blocos de metas e de
 * categorias da Visão geral (desktop-mvp-plan Fase 13.2), para que o progresso se desenhe igual
 * nos dois lugares. Decorativa: o percentual ao lado já diz o mesmo em texto.
 *
 * @param props.ratio Preenchimento entre 0 e 1.
 * @param props.className Altura e raio, que mudam entre a lista e o detalhe.
 * @param props.fill Cor do preenchimento: `accent` no progresso das metas; `out` nos gastos por
 * categoria, que são saída de dinheiro (mockup `DesktopVisaoGeral2`).
 * @return A barra.
 */
export function ProgressBar({ ratio, className, fill = 'accent' }: { readonly ratio: number; readonly className: string; readonly fill?: 'accent' | 'out' }): ReactNode {
    return (
        <span aria-hidden="true" className={cn('block overflow-hidden bg-track', className)}>
            <span className={cn('block h-full', fill === 'out' ? 'bg-out' : 'bg-accent')} style={{ width: `${String(ratio * 100)}%` }} />
        </span>
    );
}
