import * as React from 'react';
import { cn } from '@/lib/cn';
import { Tooltip as TooltipPrimitive } from 'radix-ui';

/**
 * Provedor único das dicas, montado na raiz: compartilha o atraso de abertura para que passar
 * o mouse de um ícone a outro não espere de novo.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function TooltipProvider({ delayDuration = 0, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>): React.ReactNode {
    return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />;
}

/**
 * Raiz de uma dica (rótulo de ícone, valor de uma barra do gráfico). Envolve o primitivo do
 * Radix só para marcar `data-slot`, que as regras de estilo e os testes usam para achar a peça
 * sem depender de classe.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>): React.ReactNode {
    return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

/**
 * Elemento que mostra a dica no hover e no foco do teclado. Envolve o primitivo do Radix só
 * para marcar `data-slot`, que as regras de estilo e os testes usam para achar a peça sem
 * depender de classe.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>): React.ReactNode {
    return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

/**
 * Balão da dica, em cores invertidas (`ink` sobre `surface`) para destacar de qualquer fundo
 * nos dois temas.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function TooltipContent({ className, sideOffset = 0, children, ...props }: React.ComponentProps<typeof TooltipPrimitive.Content>): React.ReactNode {
    return (
        <TooltipPrimitive.Portal>
            <TooltipPrimitive.Content
                data-slot="tooltip-content"
                sideOffset={sideOffset}
                className={cn(
                    'z-50 w-fit origin-(--radix-tooltip-content-transform-origin) animate-in rounded-8 bg-ink px-3 py-1.5 text-12 text-balance text-surface fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
                    className,
                )}
                {...props}
            >
                {children}
                <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-2 bg-ink fill-ink" />
            </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
    );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
