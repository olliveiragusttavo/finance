import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Campo de texto com borda, foco e estado inválido dos tokens. O estado inválido vem de
 * `aria-invalid`, o mesmo atributo que o formulário marca para leitores de tela — a cor nunca
 * é o único sinal do erro.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>): React.ReactNode {
    return (
        <input
            type={type}
            data-slot="input"
            className={cn(
                'h-9 w-full min-w-0 rounded-8 border border-line bg-transparent px-3 py-1 text-14 shadow-xs transition-[color,box-shadow] outline-none selection:bg-accent selection:text-on-accent file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-14 file:font-medium file:text-ink placeholder:text-muted disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-14 dark:bg-line/30',
                'focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/50',
                'aria-invalid:border-danger aria-invalid:ring-danger/20 dark:aria-invalid:ring-danger/40',
                className,
            )}
            {...props}
        />
    );
}

export { Input };
