import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Barra de progresso das metas, compartilhada pela tela Metas e pelo bloco de metas da Visão geral
 * (desktop-mvp-plan Fase 13.2), para que o progresso se desenhe igual nos dois lugares.
 * Decorativa: o percentual ao lado já diz o mesmo em texto.
 *
 * @param props.ratio Preenchimento entre 0 e 1.
 * @param props.className Altura e raio, que mudam entre a lista e o detalhe.
 * @return A barra.
 */
export function ProgressBar({ ratio, className }: { readonly ratio: number; readonly className: string }): ReactNode {
    return (
        <span aria-hidden="true" className={cn('block overflow-hidden bg-track', className)}>
            <span className="block h-full bg-accent" style={{ width: `${String(ratio * 100)}%` }} />
        </span>
    );
}
