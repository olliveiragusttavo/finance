import * as React from 'react';
import { cn } from '@/lib/cn';
import { Popover as PopoverPrimitive } from 'radix-ui';

/**
 * Raiz do popover (seletor de subcategoria com busca, escolha de fatura). Envolve o primitivo
 * do Radix só para marcar `data-slot`, que as regras de estilo e os testes usam para achar a
 * peça sem depender de classe.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>): React.ReactNode {
    return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

/**
 * Elemento que abre o popover. Envolve o primitivo do Radix só para marcar `data-slot`, que as
 * regras de estilo e os testes usam para achar a peça sem depender de classe.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>): React.ReactNode {
    return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

/**
 * Caixa flutuante posicionada pelo Radix junto ao gatilho, que se reposiciona sozinha perto da
 * borda da janela.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function PopoverContent({ className, align = 'center', sideOffset = 4, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>): React.ReactNode {
    return (
        <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
                data-slot="popover-content"
                align={align}
                sideOffset={sideOffset}
                className={cn(
                    'z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-8 border bg-surface p-4 text-ink shadow-md outline-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
                    className,
                )}
                {...props}
            />
        </PopoverPrimitive.Portal>
    );
}

/**
 * Ponto de ancoragem alternativo, quando o popover deve se alinhar a outro elemento que não o
 * gatilho. Envolve o primitivo do Radix só para marcar `data-slot`, que as regras de estilo e
 * os testes usam para achar a peça sem depender de classe.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>): React.ReactNode {
    return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

/**
 * Agrupa título e descrição do popover com o espaçamento padrão.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function PopoverHeader({ className, ...props }: React.ComponentProps<'div'>): React.ReactNode {
    return <div data-slot="popover-header" className={cn('flex flex-col gap-1 text-14', className)} {...props} />;
}

/**
 * Título do popover.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function PopoverTitle({ className, ...props }: React.ComponentProps<'h2'>): React.ReactNode {
    return <div data-slot="popover-title" className={cn('font-medium', className)} {...props} />;
}

/**
 * Texto de apoio do popover, em `muted`.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function PopoverDescription({ className, ...props }: React.ComponentProps<'p'>): React.ReactNode {
    return <p data-slot="popover-description" className={cn('text-muted', className)} {...props} />;
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverHeader, PopoverTitle, PopoverDescription };
