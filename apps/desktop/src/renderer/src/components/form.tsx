import type { ReactNode } from 'react';
import type { FieldError, FieldErrors, FieldValues, Path } from 'react-hook-form';
import { cn } from '@/lib/cn';

/*
 * Peças comuns dos formulários (primeiro uso e Cadastros). Ficam num lugar só para que todo
 * formulário mostre o erro do mesmo jeito: texto abaixo do campo, ligado a ele por
 * `aria-describedby`, além da borda — a cor nunca é o único sinal (decisão de interface 7).
 */

/**
 * Rótulo, campo e mensagem de erro.
 *
 * @param props.id Id do campo, que liga o rótulo e a mensagem a ele.
 * @param props.label Rótulo acima do campo.
 * @param props.error Erro do campo, quando houver.
 * @param props.hint Explicação abaixo do campo quando não há erro (ex.: o aviso do fechamento
 * no fim do mês); o erro a substitui, porque é o que o usuário precisa resolver primeiro.
 * @param props.className Posição do campo na grade do formulário.
 * @param props.children O campo.
 * @return O campo com rótulo e mensagem.
 */
export function Field({
    id,
    label,
    error,
    hint,
    className,
    children,
}: {
    readonly id: string;
    readonly label: string;
    readonly error: FieldError | undefined;
    readonly hint?: ReactNode;
    readonly className?: string;
    readonly children: ReactNode;
}): ReactNode {
    return (
        <div className={cn('flex flex-col gap-1 text-13', className)}>
            <label htmlFor={id} className="text-muted">
                {label}
            </label>
            {children}
            {error?.message !== undefined ? (
                <p id={`${id}-error`} className="text-12 text-danger">
                    {error.message}
                </p>
            ) : (
                hint !== undefined && (
                    <p id={`${id}-hint`} className="text-12 text-ink2">
                        {hint}
                    </p>
                )
            )}
        </div>
    );
}

/**
 * @param id Id do campo.
 * @param error Erro do campo, quando houver.
 * @param hasHint Se o `Field` mostra uma explicação, que então descreve o campo sem erro.
 * @return Os atributos que marcam o campo inválido e o ligam à mensagem.
 */
export function fieldAria(
    id: string,
    error: FieldError | undefined,
    hasHint = false,
): { readonly 'aria-invalid': boolean; readonly 'aria-describedby': string | undefined } {
    if (error !== undefined) {
        return { 'aria-invalid': true, 'aria-describedby': `${id}-error` };
    }
    return { 'aria-invalid': false, 'aria-describedby': hasHint ? `${id}-hint` : undefined };
}

/**
 * Converte as mensagens por campo, como os leitores de formulário as devolvem, no formato do
 * react-hook-form, que as associa aos campos.
 *
 * @param fields Todos os campos do formulário, na ordem da tela; percorrê-los mantém o tipo do
 * campo, que `Object.keys` perderia.
 * @param errors Mensagem de cada campo com problema.
 * @return Os erros no formato do react-hook-form.
 */
export function toFieldErrors<V extends FieldValues>(fields: readonly Path<V>[], errors: Partial<Record<Path<V>, string>>): FieldErrors<V> {
    return fields.reduce<FieldErrors<V>>((fieldErrors, field) => {
        const message = errors[field];
        return message === undefined ? fieldErrors : { ...fieldErrors, [field]: { type: 'validate', message } };
    }, {});
}

/**
 * Título de grupo de campos, em caixa alta e discreto como no mockup do primeiro uso, para
 * separar blocos sem dividir o cartão ou o diálogo.
 *
 * @param props.children Texto do título.
 * @return O título.
 */
export function SectionTitle({ children }: { readonly children: string }): ReactNode {
    return <h3 className="text-13 font-semibold tracking-wide text-muted uppercase">{children}</h3>;
}
