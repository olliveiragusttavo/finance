import * as React from 'react';
import { cn } from '@/lib/cn';
import { XIcon } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';

import { Button } from '@/components/ui/button';

/**
 * Raiz do diálogo modal (confirmações de exclusão, pagamento de fatura). Envolve o primitivo
 * do Radix só para marcar `data-slot`, que as regras de estilo e os testes usam para achar a
 * peça sem depender de classe.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>): React.ReactNode {
    return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

/**
 * Elemento que abre o diálogo. Envolve o primitivo do Radix só para marcar `data-slot`, que as
 * regras de estilo e os testes usam para achar a peça sem depender de classe.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>): React.ReactNode {
    return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

/**
 * Leva o diálogo para o fim do `body`, fora do `overflow` das tabelas que o abrem. Envolve o
 * primitivo do Radix só para marcar `data-slot`, que as regras de estilo e os testes usam para
 * achar a peça sem depender de classe.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>): React.ReactNode {
    return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

/**
 * Elemento que fecha o diálogo. Envolve o primitivo do Radix só para marcar `data-slot`, que
 * as regras de estilo e os testes usam para achar a peça sem depender de classe.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>): React.ReactNode {
    return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

/**
 * Véu atrás do diálogo, no token `scrim`: escurece nos dois temas e bloqueia o clique fora sem
 * tirar o contexto de vista.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>): React.ReactNode {
    return (
        <DialogPrimitive.Overlay
            data-slot="dialog-overlay"
            className={cn(
                'fixed inset-0 z-50 bg-scrim/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
                className,
            )}
            {...props}
        />
    );
}

/**
 * Caixa do diálogo com foco preso e Esc para fechar (Radix). O botão de fechar opcional existe
 * porque alguns alertas, como o de exclusão em cadeia, exigem uma escolha explícita e não
 * podem ser dispensados pelo canto.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function DialogContent({
    className,
    children,
    showCloseButton = true,
    ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
    showCloseButton?: boolean;
}): React.ReactNode {
    return (
        <DialogPortal data-slot="dialog-portal">
            <DialogOverlay />
            <DialogPrimitive.Content
                data-slot="dialog-content"
                className={cn(
                    'fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-10 border bg-surface p-6 shadow-lg duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg',
                    className,
                )}
                {...props}
            >
                {children}
                {showCloseButton && (
                    <DialogPrimitive.Close
                        data-slot="dialog-close"
                        className="absolute top-4 right-4 rounded-2 opacity-70 ring-offset-surface transition-opacity hover:opacity-100 focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-soft data-[state=open]:text-muted [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
                    >
                        <XIcon />
                        <span className="sr-only">Close</span>
                    </DialogPrimitive.Close>
                )}
            </DialogPrimitive.Content>
        </DialogPortal>
    );
}

/**
 * Agrupa título e descrição com o espaçamento padrão, para que todo diálogo comece igual.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function DialogHeader({ className, ...props }: React.ComponentProps<'div'>): React.ReactNode {
    return <div data-slot="dialog-header" className={cn('flex flex-col gap-2 text-center sm:text-left', className)} {...props} />;
}

/**
 * Área das ações do diálogo, alinhada à direita; o botão "Fechar" opcional poupa repetir o
 * mesmo `DialogClose` em cada confirmação.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function DialogFooter({
    className,
    showCloseButton = false,
    children,
    ...props
}: React.ComponentProps<'div'> & {
    showCloseButton?: boolean;
}): React.ReactNode {
    return (
        <div data-slot="dialog-footer" className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props}>
            {children}
            {showCloseButton && (
                <DialogPrimitive.Close asChild>
                    <Button variant="outline">Close</Button>
                </DialogPrimitive.Close>
            )}
        </div>
    );
}

/**
 * Título do diálogo; o Radix o liga ao `aria-labelledby` da caixa para leitores de tela.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>): React.ReactNode {
    return <DialogPrimitive.Title data-slot="dialog-title" className={cn('text-17 leading-none font-semibold', className)} {...props} />;
}

/**
 * Explicação do diálogo; o Radix a liga ao `aria-describedby`, então o alerta é lido inteiro
 * ao abrir.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>): React.ReactNode {
    return <DialogPrimitive.Description data-slot="dialog-description" className={cn('text-14 text-muted', className)} {...props} />;
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger };
