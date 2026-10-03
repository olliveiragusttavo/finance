import * as React from 'react';
import { cn } from '@/lib/cn';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import { Select as SelectPrimitive } from 'radix-ui';

/**
 * Raiz da lista de escolha (filtros, conta, tipo de lançamento). Envolve o primitivo do Radix
 * só para marcar `data-slot`, que as regras de estilo e os testes usam para achar a peça sem
 * depender de classe.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function Select({ ...props }: React.ComponentProps<typeof SelectPrimitive.Root>): React.ReactNode {
    return <SelectPrimitive.Root data-slot="select" {...props} />;
}

/**
 * Grupo de opções com rótulo próprio. Envolve o primitivo do Radix só para marcar `data-slot`,
 * que as regras de estilo e os testes usam para achar a peça sem depender de classe.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function SelectGroup({ ...props }: React.ComponentProps<typeof SelectPrimitive.Group>): React.ReactNode {
    return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

/**
 * Valor escolhido mostrado no gatilho. Envolve o primitivo do Radix só para marcar
 * `data-slot`, que as regras de estilo e os testes usam para achar a peça sem depender de
 * classe.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function SelectValue({ ...props }: React.ComponentProps<typeof SelectPrimitive.Value>): React.ReactNode {
    return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

/**
 * Botão que abre a lista, com a altura dos campos de texto para que filtros e campos alinhem
 * na mesma linha.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function SelectTrigger({
    className,
    size = 'default',
    children,
    ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
    size?: 'sm' | 'default';
}): React.ReactNode {
    return (
        <SelectPrimitive.Trigger
            data-slot="select-trigger"
            data-size={size}
            className={cn(
                "flex w-fit items-center justify-between gap-2 rounded-8 border border-line bg-transparent px-3 py-2 text-14 whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger aria-invalid:ring-danger/20 data-[placeholder]:text-muted data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 dark:bg-line/30 dark:hover:bg-line/50 dark:aria-invalid:ring-danger/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted",
                className,
            )}
            {...props}
        >
            {children}
            <SelectPrimitive.Icon asChild>
                <ChevronDownIcon className="size-4 opacity-50" />
            </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
    );
}

/**
 * Lista de opções num portal, posicionada pelo Radix e com rolagem por botões quando passa da
 * altura da janela.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function SelectContent({ className, children, position = 'item-aligned', align = 'center', ...props }: React.ComponentProps<typeof SelectPrimitive.Content>): React.ReactNode {
    return (
        <SelectPrimitive.Portal>
            <SelectPrimitive.Content
                data-slot="select-content"
                className={cn(
                    'relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-8 border bg-surface text-ink shadow-md data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
                    position === 'popper' &&
                        'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
                    className,
                )}
                position={position}
                align={align}
                {...props}
            >
                <SelectScrollUpButton />
                <SelectPrimitive.Viewport
                    className={cn(
                        'p-1',
                        position === 'popper' && 'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1',
                    )}
                >
                    {children}
                </SelectPrimitive.Viewport>
                <SelectScrollDownButton />
            </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
    );
}

/**
 * Rótulo de um grupo de opções, em `muted`.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>): React.ReactNode {
    return <SelectPrimitive.Label data-slot="select-label" className={cn('px-2 py-1.5 text-12 text-muted', className)} {...props} />;
}

/**
 * Opção da lista, com a marca de escolhida à direita.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>): React.ReactNode {
    return (
        <SelectPrimitive.Item
            data-slot="select-item"
            className={cn(
                "relative flex w-full cursor-default items-center gap-2 rounded-4 py-1.5 pr-8 pl-2 text-14 outline-hidden select-none focus:bg-soft focus:text-soft-ink data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
                className,
            )}
            {...props}
        >
            <span data-slot="select-item-indicator" className="absolute right-2 flex size-3.5 items-center justify-center">
                <SelectPrimitive.ItemIndicator>
                    <CheckIcon className="size-4" />
                </SelectPrimitive.ItemIndicator>
            </span>
            <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        </SelectPrimitive.Item>
    );
}

/**
 * Divisória entre grupos de opções.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>): React.ReactNode {
    return <SelectPrimitive.Separator data-slot="select-separator" className={cn('pointer-events-none -mx-1 my-1 h-px bg-line', className)} {...props} />;
}

/**
 * Seta de rolagem para cima de uma lista longa, como a de subcategorias.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function SelectScrollUpButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>): React.ReactNode {
    return (
        <SelectPrimitive.ScrollUpButton
            data-slot="select-scroll-up-button"
            className={cn('flex cursor-default items-center justify-center py-1', className)}
            {...props}
        >
            <ChevronUpIcon className="size-4" />
        </SelectPrimitive.ScrollUpButton>
    );
}

/**
 * Seta de rolagem para baixo de uma lista longa.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function SelectScrollDownButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>): React.ReactNode {
    return (
        <SelectPrimitive.ScrollDownButton
            data-slot="select-scroll-down-button"
            className={cn('flex cursor-default items-center justify-center py-1', className)}
            {...props}
        >
            <ChevronDownIcon className="size-4" />
        </SelectPrimitive.ScrollDownButton>
    );
}

export {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectScrollDownButton,
    SelectScrollUpButton,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
};
