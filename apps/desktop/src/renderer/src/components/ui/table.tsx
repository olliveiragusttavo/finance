import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Tabela com rolagem horizontal própria, para que as tabelas densas do desktop não alarguem a
 * página.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function Table({ className, ...props }: React.ComponentProps<'table'>): React.ReactNode {
    return (
        <div data-slot="table-container" className="relative w-full overflow-x-auto">
            <table data-slot="table" className={cn('w-full caption-bottom text-14', className)} {...props} />
        </div>
    );
}

/**
 * Cabeçalho da tabela, com a linha divisória dos tokens.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function TableHeader({ className, ...props }: React.ComponentProps<'thead'>): React.ReactNode {
    return <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props} />;
}

/**
 * Corpo da tabela; a última linha não leva divisória.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function TableBody({ className, ...props }: React.ComponentProps<'tbody'>): React.ReactNode {
    return <tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

/**
 * Rodapé da tabela, onde ficam as linhas de total ("Total de despesas").
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>): React.ReactNode {
    return <tfoot data-slot="table-footer" className={cn('border-t bg-surface2/50 font-medium [&>tr]:last:border-b-0', className)} {...props} />;
}

/**
 * Linha com hover e estado selecionado (`data-state="selected"`), o realce da linha aberta no
 * painel de edição.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function TableRow({ className, ...props }: React.ComponentProps<'tr'>): React.ReactNode {
    return (
        <tr
            data-slot="table-row"
            className={cn('border-b transition-colors hover:bg-surface2/50 has-aria-expanded:bg-surface2/50 data-[state=selected]:bg-surface2', className)}
            {...props}
        />
    );
}

/**
 * Célula de cabeçalho, em `muted`, sem quebra de linha.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function TableHead({ className, ...props }: React.ComponentProps<'th'>): React.ReactNode {
    return (
        <th
            data-slot="table-head"
            className={cn(
                'h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-ink [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
                className,
            )}
            {...props}
        />
    );
}

/**
 * Célula de dado, sem quebra de linha: números alinhados à direita não podem quebrar no meio
 * do valor.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function TableCell({ className, ...props }: React.ComponentProps<'td'>): React.ReactNode {
    return (
        <td
            data-slot="table-cell"
            className={cn('p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]', className)}
            {...props}
        />
    );
}

/**
 * Legenda da tabela, lida por leitores de tela como o título dela.
 *
 * @param props Propriedades do elemento ou do primitivo do Radix, repassadas a ele; `className`
 * é somado às classes do componente.
 * @return O elemento com o estilo dos tokens.
 */
function TableCaption({ className, ...props }: React.ComponentProps<'caption'>): React.ReactNode {
    return <caption data-slot="table-caption" className={cn('mt-4 text-14 text-muted', className)} {...props} />;
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
