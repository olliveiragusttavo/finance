import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/*
 * Peças visuais comuns às três etapas da importação (mockups `DesktopImport*`).
 */

/**
 * Cartão de uma seção, com título e uma nota à direita.
 *
 * @param props.title Título da seção, que também nomeia a região para leitores de tela.
 * @param props.aside Nota ao lado do título (ex.: "Detectado: Despesas").
 * @param props.className Ajustes de layout do cartão.
 * @param props.children Conteúdo.
 * @return A seção.
 */
export function ImportCard({ title, aside, className, children }: { readonly title: string; readonly aside?: ReactNode; readonly className?: string; readonly children: ReactNode }): ReactNode {
    return (
        <section aria-label={title} className={cn('flex flex-col gap-3.5 rounded-10 border border-line bg-surface p-5', className)}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-16 font-semibold">{title}</h2>
                {aside !== undefined && <span className="text-12 text-muted">{aside}</span>}
            </div>
            {children}
        </section>
    );
}

/**
 * Rodapé das etapas: voltar à esquerda, avançar à direita.
 *
 * @param props.back Ação de voltar (ou cancelar).
 * @param props.children Ações da direita.
 * @return O rodapé.
 */
export function StepFooter({ back, children }: { readonly back: ReactNode; readonly children: ReactNode }): ReactNode {
    return (
        <div className="flex items-center justify-between gap-3">
            {back}
            <div className="flex items-center gap-3">{children}</div>
        </div>
    );
}

/**
 * Seletor nativo com o estilo dos campos do app. Nativo, e não o `Select` do shadcn, porque as
 * tabelas da revisão têm um seletor por linha — dezenas de portais abertos por um só arquivo — e o
 * nativo já é acessível pelo teclado.
 *
 * @param props.label Rótulo para leitores de tela.
 * @param props.value Valor escolhido.
 * @param props.options Opções.
 * @param props.onChange Avisado com o valor novo.
 * @param props.className Largura e ajustes.
 * @return O seletor.
 */
export function NativeSelect<T extends string>({
    label,
    value,
    options,
    onChange,
    className,
}: {
    readonly label: string;
    readonly value: T;
    readonly options: readonly { readonly value: T; readonly label: string }[];
    readonly onChange: (value: T) => void;
    readonly className?: string;
}): ReactNode {
    return (
        <select
            aria-label={label}
            value={value}
            onChange={(event) => {
                const chosen = options.find((option) => option.value === event.target.value);
                if (chosen !== undefined) {
                    onChange(chosen.value);
                }
            }}
            className={cn('h-9 rounded-6 border border-line bg-bg px-2.5 text-13', className)}
        >
            {options.map((option) => (
                <option key={option.value} value={option.value}>
                    {option.label}
                </option>
            ))}
        </select>
    );
}

/**
 * Selo de situação ("Lido sem erros", "Pendente").
 *
 * @param props.tone `ok` (verde), `warn` (amarelo) ou `neutral`.
 * @param props.children Texto do selo.
 * @return O selo.
 */
export function Pill({ tone, children }: { readonly tone: 'ok' | 'warn' | 'neutral'; readonly children: ReactNode }): ReactNode {
    const colors = tone === 'ok' ? 'bg-ok-bg text-ok-ink' : tone === 'warn' ? 'bg-warn-bg text-warn-ink' : 'bg-surface2 text-ink2';
    return <span className={cn('rounded-full px-2 py-0.5 text-12 whitespace-nowrap', colors)}>{children}</span>;
}
