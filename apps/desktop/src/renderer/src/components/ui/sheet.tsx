import * as React from 'react';
import { cn } from '@/lib/cn';
import { XIcon } from 'lucide-react';
import { Dialog as SheetPrimitive } from 'radix-ui';

/**
 * Raiz do painel lateral (o painel de criação e edição de transação). Envolve o primitivo do
 * Radix só para marcar `data-slot`, que as regras de estilo e os testes usam para achar a peça
 * sem depender de classe.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>): React.ReactNode {
    return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

/**
 * Elemento que abre o painel lateral. Envolve o primitivo do Radix só para marcar `data-slot`,
 * que as regras de estilo e os testes usam para achar a peça sem depender de classe.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function SheetTrigger({ ...props }: React.ComponentProps<typeof SheetPrimitive.Trigger>): React.ReactNode {
    return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

/**
 * Elemento que fecha o painel lateral. Envolve o primitivo do Radix só para marcar
 * `data-slot`, que as regras de estilo e os testes usam para achar a peça sem depender de
 * classe.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function SheetClose({ ...props }: React.ComponentProps<typeof SheetPrimitive.Close>): React.ReactNode {
    return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

/**
 * Leva o painel para o fim do `body`, fora do layout da tela. Envolve o primitivo do Radix só
 * para marcar `data-slot`, que as regras de estilo e os testes usam para achar a peça sem
 * depender de classe.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function SheetPortal({ ...props }: React.ComponentProps<typeof SheetPrimitive.Portal>): React.ReactNode {
    return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

/**
 * Véu atrás do painel lateral, no token `scrim`, igual ao do diálogo.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function SheetOverlay({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Overlay>): React.ReactNode {
    return (
        <SheetPrimitive.Overlay
            data-slot="sheet-overlay"
            className={cn(
                'fixed inset-0 z-50 bg-scrim/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
                className,
            )}
            {...props}
        />
    );
}

/**
 * Painel que desliza de uma borda, com foco preso e Esc para fechar. É um diálogo do Radix por
 * baixo: o painel de edição precisa do mesmo comportamento acessível de um modal.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function SheetContent({
    className,
    children,
    side = 'right',
    showCloseButton = true,
    ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
    side?: 'top' | 'right' | 'bottom' | 'left';
    showCloseButton?: boolean;
}): React.ReactNode {
    return (
        <SheetPortal>
            <SheetOverlay />
            <SheetPrimitive.Content
                data-slot="sheet-content"
                className={cn(
                    'fixed z-50 flex flex-col gap-4 bg-surface shadow-lg transition ease-in-out data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:animate-in data-[state=open]:duration-500',
                    side === 'right' &&
                        'inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm',
                    side === 'left' &&
                        'inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm',
                    side === 'top' && 'inset-x-0 top-0 h-auto border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top',
                    side === 'bottom' && 'inset-x-0 bottom-0 h-auto border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
                    className,
                )}
                {...props}
            >
                {children}
                {showCloseButton && (
                    <SheetPrimitive.Close className="absolute top-4 right-4 rounded-2 opacity-70 ring-offset-surface transition-opacity hover:opacity-100 focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-surface2">
                        <XIcon className="size-4" />
                        <span className="sr-only">Close</span>
                    </SheetPrimitive.Close>
                )}
            </SheetPrimitive.Content>
        </SheetPortal>
    );
}

/**
 * Cabeçalho do painel com o espaçamento padrão.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function SheetHeader({ className, ...props }: React.ComponentProps<'div'>): React.ReactNode {
    return <div data-slot="sheet-header" className={cn('flex flex-col gap-1.5 p-4', className)} {...props} />;
}

/**
 * Rodapé do painel, preso embaixo, onde ficam "Salvar" e "Excluir".
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function SheetFooter({ className, ...props }: React.ComponentProps<'div'>): React.ReactNode {
    return <div data-slot="sheet-footer" className={cn('mt-auto flex flex-col gap-2 p-4', className)} {...props} />;
}

/**
 * Título do painel, ligado ao `aria-labelledby`.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>): React.ReactNode {
    return <SheetPrimitive.Title data-slot="sheet-title" className={cn('font-semibold text-ink', className)} {...props} />;
}

/**
 * Descrição do painel, ligada ao `aria-describedby`.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>): React.ReactNode {
    return <SheetPrimitive.Description data-slot="sheet-description" className={cn('text-14 text-muted', className)} {...props} />;
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription };
