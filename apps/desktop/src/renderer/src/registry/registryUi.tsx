import type { ReactNode, SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/cn';

/*
 * Peças repetidas pelas seções de Cadastros. Ficam juntas para que contas, cartões,
 * categorias e perfis tenham o mesmo cabeçalho, as mesmas etiquetas e o mesmo diálogo — o
 * mockup desenha só Categorias, e as outras seções seguem o mesmo desenho.
 */

/**
 * Cabeçalho da seção aberta, como no mockup: título com a explicação abaixo, e as ações à
 * direita.
 *
 * @param props.title Nome do cadastro ("Contas").
 * @param props.description Frase sobre o cadastro, que diz a regra que mais importa nele.
 * @param props.actions Botões do cabeçalho ("+ Nova conta").
 * @return O cabeçalho.
 */
export function SectionHeader({ title, description, actions }: { readonly title: string; readonly description: string; readonly actions?: ReactNode }): ReactNode {
    return (
        <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
                <h2 className="text-22 font-semibold">{title}</h2>
                <span className="text-12 text-muted">{description}</span>
            </div>
            {actions !== undefined && <div className="flex items-center gap-2.5">{actions}</div>}
        </div>
    );
}

/**
 * Etiqueta de situação ao lado do nome ("Desativada", "Fora do total"). É texto, e não só
 * cor, para que a situação se leia sem depender dela (decisão de interface 7).
 *
 * @param props.tone `warn` para o que limita o uso (desativado); `neutral` para informação.
 * @param props.children Texto da etiqueta.
 * @return A etiqueta.
 */
export function StatusTag({ tone, children }: { readonly tone: 'warn' | 'neutral'; readonly children: string }): ReactNode {
    return <span className={cn('rounded-4 px-1.5 py-0.5 text-11 font-medium', tone === 'warn' ? 'bg-warn-bg text-warn-ink' : 'bg-surface2 text-muted ring-1 ring-line')}>{children}</span>;
}

/**
 * Botão discreto das linhas e cartões ("Editar"), o `.ic` do mockup.
 *
 * @param props.label Texto visível.
 * @param props.accessibleName Nome completo para o leitor de tela ("Editar Moradia"), porque
 * vários "Editar" iguais na tela não dizem o que editam.
 * @param props.onClick Ação.
 * @param props.danger Ação destrutiva (excluir), no tom `danger`.
 * @return O botão.
 */
export function RowAction({ label, accessibleName, onClick, danger = false }: { readonly label: string; readonly accessibleName: string; readonly onClick: () => void; readonly danger?: boolean }): ReactNode {
    return (
        <Button type="button" variant="ghost" size="xs" aria-label={accessibleName} onClick={onClick} className={cn('text-13 font-normal', danger ? 'text-danger' : 'text-muted')}>
            {label}
        </Button>
    );
}

/**
 * Diálogo de formulário de cadastro: título, campos, aviso geral e ações. O aviso geral só
 * aparece para a recusa do núcleo que não é de um campo; a de um campo vai para baixo dele.
 *
 * @param props.open Se o diálogo está aberto.
 * @param props.onClose Fecha o diálogo (Esc, Cancelar ou depois de salvar).
 * @param props.title Título ("Nova conta", "Editar Nubank").
 * @param props.description Frase sob o título, que diz o que o cadastro afeta.
 * @param props.submitLabel Texto do botão de salvar.
 * @param props.pending Se o núcleo ainda está gravando; trava o botão contra envio duplo.
 * @param props.error Recusa do núcleo que não pertence a um campo.
 * @param props.onSubmit Envio do formulário.
 * @param props.secondaryAction Ação à esquerda do rodapé, separada das de salvar (ex.: "Excluir
 * categoria" no diálogo de editar, que é o único caminho para ela no mockup).
 * @param props.children Os campos.
 * @return O diálogo.
 */
export function FormDialog({
    open,
    onClose,
    title,
    description,
    submitLabel,
    pending,
    error,
    onSubmit,
    secondaryAction,
    children,
}: {
    readonly open: boolean;
    readonly onClose: () => void;
    readonly title: string;
    readonly description: string;
    readonly submitLabel: string;
    readonly pending: boolean;
    readonly error: string | null;
    readonly onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
    readonly secondaryAction?: ReactNode;
    readonly children: ReactNode;
}): ReactNode {
    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
        >
            <DialogContent showCloseButton={false}>
                <form noValidate className="flex flex-col gap-4" onSubmit={onSubmit}>
                    <DialogHeader>
                        <DialogTitle>{title}</DialogTitle>
                        <DialogDescription>{description}</DialogDescription>
                    </DialogHeader>
                    {children}
                    {error !== null && (
                        <p role="alert" className="text-13 text-danger">
                            {error}
                        </p>
                    )}
                    <DialogFooter>
                        {secondaryAction !== undefined && <div className="sm:mr-auto">{secondaryAction}</div>}
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={pending}>
                            {pending ? 'Salvando…' : submitLabel}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
