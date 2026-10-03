import type { RadiusPx } from '@finance/tokens';
import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/** Raio dos avisos, da escala dos tokens (o mesmo dos botões nos mockups). */
const TOAST_RADIUS: RadiusPx = 8;

/**
 * Variáveis do Sonner apontadas para os tokens. Como elas leem as variáveis CSS do tema, o
 * aviso troca de tema junto com a classe `.dark` da raiz, sem o Toaster precisar saber qual
 * tema está ativo — por isso o `next-themes` do modelo do shadcn/ui não entrou.
 */
const TOKEN_STYLE: CSSProperties & Readonly<Record<`--${string}`, string>> = {
    '--normal-bg': 'var(--surface)',
    '--normal-text': 'var(--ink)',
    '--normal-border': 'var(--line)',
    '--border-radius': `${String(TOAST_RADIUS)}px`,
};

/**
 * Avisos passageiros ("Lançamento salvo") no canto da janela, com ícones do mesmo conjunto
 * dos demais componentes.
 *
 * @param props Opções do Sonner; sobrescrevem as padrão.
 * @return O contêiner dos avisos.
 */
function Toaster({ ...props }: ToasterProps): ReactNode {
    return (
        <Sonner
            className="toaster group"
            icons={{
                success: <CircleCheckIcon className="size-4" />,
                info: <InfoIcon className="size-4" />,
                warning: <TriangleAlertIcon className="size-4" />,
                error: <OctagonXIcon className="size-4" />,
                loading: <Loader2Icon className="size-4 animate-spin" />,
            }}
            style={TOKEN_STYLE}
            {...props}
        />
    );
}

export { Toaster };
