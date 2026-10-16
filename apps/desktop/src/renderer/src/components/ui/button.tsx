import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';
import { Slot } from 'radix-ui';

const buttonVariants = cva(
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-8 text-14 font-medium whitespace-nowrap transition-all outline-none focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-danger aria-invalid:ring-danger/20 dark:aria-invalid:ring-danger/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    {
        variants: {
            variant: {
                default: 'bg-accent text-on-accent hover:bg-accent/90',
                destructive: 'bg-danger text-surface hover:bg-danger/90 focus-visible:ring-danger/20 dark:bg-danger/60 dark:focus-visible:ring-danger/40',
                outline: 'border bg-surface shadow-xs hover:bg-soft hover:text-soft-ink dark:border-line dark:bg-line/30 dark:hover:bg-line/50',
                secondary: 'bg-surface2 text-ink hover:bg-surface2/80',
                ghost: 'hover:bg-soft hover:text-soft-ink dark:hover:bg-soft/50',
                link: 'text-accent underline-offset-4 hover:underline',
            },
            size: {
                default: 'h-9 px-4 py-2 has-[>svg]:px-3',
                xs: "h-6 gap-1 rounded-8 px-2 text-12 has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
                sm: 'h-8 gap-1.5 rounded-8 px-3 has-[>svg]:px-2.5',
                lg: 'h-10 rounded-8 px-6 has-[>svg]:px-4',
                icon: 'size-9',
                'icon-xs': "size-6 rounded-8 [&_svg:not([class*='size-'])]:size-3",
                'icon-sm': 'size-8',
                'icon-lg': 'size-10',
            },
        },
        defaultVariants: {
            variant: 'default',
            size: 'default',
        },
    },
);

/**
 * Botão único do app, com as variantes dos mockups (ação principal em `accent`, destrutiva em
 * `danger`, contorno, discreta e link). Centralizar as variantes evita que cada tela reinvente
 * cor e altura de botão; `asChild` deixa um link com a aparência de botão sem aninhar
 * elementos interativos.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function Button({
    className,
    variant = 'default',
    size = 'default',
    asChild = false,
    ...props
}: React.ComponentProps<'button'> &
    VariantProps<typeof buttonVariants> & {
        asChild?: boolean;
    }): React.ReactNode {
    const Comp = asChild ? Slot.Root : 'button';

    return <Comp data-slot="button" data-variant={variant} data-size={size} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
