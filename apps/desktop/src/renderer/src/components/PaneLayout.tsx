import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/*
 * Layout das telas com lista lateral e detalhe — Contas, Cartões, Metas e os
 * relatórios por conta e por tag (desktop-mvp-plan Fase 13.3, pedido do usuário). Cada painel rola
 * sozinho: rolar o extrato não leva a lista de contas embora, e uma lista longa de contas não
 * empurra o detalhe. O rodapé da lista (os totais) fica fixo embaixo, sempre à vista.
 *
 * A altura vem do `AppShell`: o `main` que contém um `PaneLayout` deixa de crescer com o conteúdo
 * (`data-pane-layout`) e ocupa só a área abaixo da barra superior, que os painéis dividem.
 */

/**
 * A área dos painéis, de borda a borda do conteúdo (desfaz o espaçamento do `main`).
 *
 * @param props.children A lista lateral, o detalhe e os diálogos da tela.
 * @return A área com altura fixa, que os painéis dividem.
 */
export function PaneLayout({ children }: { readonly children: ReactNode }): ReactNode {
    return (
        <div data-pane-layout="" className="-mx-8 -my-6 flex min-h-0 flex-1">
            {children}
        </div>
    );
}

/**
 * A lista lateral: cabeçalho e rodapé fixos, e só a lista no meio rola. Os totais ficam no
 * rodapé, porque são o resumo da lista inteira — rolá-los junto os esconderia justamente quando a
 * lista é longa.
 *
 * @param props.label Nome acessível do painel.
 * @param props.width Largura do painel, a do mockup (`w-95`).
 * @param props.header Título, ações e os rótulos das colunas.
 * @param props.footer Totais ou nota da lista; ausente quando a lista não tem.
 * @param props.children Os itens da lista.
 * @return O painel.
 */
export function ListPane({
    label,
    width,
    header,
    footer,
    children,
}: {
    readonly label: string;
    readonly width: string;
    readonly header: ReactNode;
    readonly footer?: ReactNode;
    readonly children: ReactNode;
}): ReactNode {
    return (
        <section aria-label={label} className={cn('flex shrink-0 flex-col border-r border-line bg-surface', width)}>
            <div className="shrink-0">{header}</div>
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
            {footer !== undefined && <div className="shrink-0 border-t border-line">{footer}</div>}
        </section>
    );
}

/**
 * O detalhe à direita, com a rolagem própria. O conteúdo fica numa coluna interna, e não direto
 * no painel que rola: num contêiner flex de altura fixa, as seções com `overflow` diferente de
 * `visible` encolheriam para caber, em vez de rolar. É também o contêiner em que o cabeçalho fixo
 * das listagens de movimentos gruda.
 *
 * @param props.label Nome acessível do painel; sem ele, o painel é só um contêiner.
 * @param props.children O detalhe.
 * @return O painel.
 */
export function DetailPane({ label, children }: { readonly label?: string; readonly children: ReactNode }): ReactNode {
    const content = <div className="flex min-h-full flex-col gap-5 px-8 py-6">{children}</div>;
    const className = 'min-w-0 flex-1 overflow-y-auto';
    return label === undefined ? (
        <div className={className}>{content}</div>
    ) : (
        <section aria-label={label} className={className}>
            {content}
        </section>
    );
}
