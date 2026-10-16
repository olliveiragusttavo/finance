import { describeError, describeSeriesPlan, formatHiddenRows, REVIEW_VISIBLE_ROWS, useCreatePlan, useDeletePlan, useUpdatePlan, type ReviewAction, type ReviewGroup } from '@finance/client';
import type { AccountResponse, CoreInput } from '@finance/core';
import { useState, type ReactNode } from 'react';
import { Skeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusTag } from '@/registry/registryUi';

/** A escrita que o diálogo revisa, com a entrada da rota de plano correspondente. */
export type SeriesReviewRequest =
    | { readonly action: 'create'; readonly input: CoreInput<'recurrences.planCreate'> }
    | { readonly action: 'edit'; readonly input: CoreInput<'recurrences.planUpdate'> }
    | { readonly action: 'delete'; readonly input: CoreInput<'recurrences.planDelete'> };

/**
 * Título de cada escrita. Diferente do diálogo de escopo ("Salvar “Aluguel”"), que vem logo
 * antes, para que se saiba em que passo se está.
 */
const TITLES: Readonly<Record<ReviewAction, (name: string) => string>> = {
    create: (name) => `Revisar o lançamento de “${name}”`,
    edit: (name) => `Revisar as alterações em “${name}”`,
    delete: (name) => `Revisar a exclusão de “${name}”`,
};

/** Rótulo do botão de confirmar de cada escrita. */
const CONFIRM_LABELS: Readonly<Record<ReviewAction, readonly [string, string]>> = {
    create: ['Lançar', 'Lançando…'],
    edit: ['Salvar', 'Salvando…'],
    delete: ['Excluir', 'Excluindo…'],
};

/**
 * Diálogo de revisão (database-design §4.12): toda criação, edição ou exclusão de uma
 * transação recorrente só é gravada depois que o usuário vê o que será feito com as séries e quais
 * transações serão excluídas, criadas e alteradas — com as pagas e as editadas à mão marcadas.
 * Vem depois da escolha do escopo, quando há escolha. Os mockups não têm esta tela; segue a caixa
 * de aviso do `MobileEscopo` e a especificação aprovada (desktop-mvp-plan Fase 9.2).
 * Regra de negócio (Recorrências, database-design §4.12): ocorrências pagas não são protegidas,
 * então o diálogo diz antes o que está em jogo, em vez de um aviso genérico.
 *
 * @param props.name Nome do lançamento, para o título.
 * @param props.request Escrita revisada; o plano é o ensaio dela no núcleo.
 * @param props.accounts Contas do perfil, para os nomes no aviso das pagas.
 * @param props.pending Se a escrita confirmada está em andamento.
 * @param props.error Recusa da escrita confirmada, para mostrar no diálogo.
 * @param props.onConfirm Grava a escrita revisada.
 * @param props.onClose Volta sem gravar.
 * @return O diálogo.
 */
export function SeriesReviewDialog({
    name,
    request,
    accounts,
    pending,
    error,
    onConfirm,
    onClose,
}: {
    readonly name: string;
    readonly request: SeriesReviewRequest;
    readonly accounts: readonly Pick<AccountResponse, 'id' | 'name'>[];
    readonly pending: boolean;
    readonly error: string | null;
    readonly onConfirm: () => void;
    readonly onClose: () => void;
}): ReactNode {
    const created = useCreatePlan(request.action === 'create' ? request.input : null);
    const updated = useUpdatePlan(request.action === 'edit' ? request.input : null);
    const deleted = useDeletePlan(request.action === 'delete' ? request.input : null);
    const query = request.action === 'create' ? created : request.action === 'edit' ? updated : deleted;
    const review = query.data === undefined ? null : describeSeriesPlan({ plan: query.data, action: request.action, accounts });
    const planError = query.error === null ? null : describeError(query.error.error).message;
    const [label, pendingLabel] = CONFIRM_LABELS[request.action];
    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
        >
            <DialogContent showCloseButton={false} role={request.action === 'delete' ? 'alertdialog' : 'dialog'} className="max-h-[calc(100vh-4rem)] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="break-words">{TITLES[request.action](name)}</DialogTitle>
                    <DialogDescription>Confira o que será feito antes de confirmar.</DialogDescription>
                </DialogHeader>
                {review === null && planError === null && <Skeleton className="h-40" />}
                {review !== null && (
                    <div className="flex flex-col gap-3 text-13">
                        {review.summary.length > 0 && (
                            <ul aria-label="Resumo" className="flex list-disc flex-col gap-1 pl-4 text-ink2">
                                {review.summary.map((sentence) => (
                                    <li key={sentence}>{sentence}</li>
                                ))}
                            </ul>
                        )}
                        {review.warnings.length > 0 && (
                            <div role="note" className="flex flex-col gap-1 rounded-6 bg-warn-bg px-3 py-2.5 text-warn-ink">
                                {review.warnings.map((warning) => (
                                    <p key={warning}>{warning}</p>
                                ))}
                            </div>
                        )}
                        {review.groups.map((group) => (
                            <ReviewGroupList key={group.kind} group={group} />
                        ))}
                    </div>
                )}
                {(planError ?? error) !== null && (
                    <p role="alert" className="text-13 text-danger">
                        {planError ?? error}
                    </p>
                )}
                <DialogFooter>
                    <Button type="button" variant="outline" autoFocus={request.action === 'delete'} onClick={onClose}>
                        Voltar
                    </Button>
                    <Button type="button" variant={request.action === 'delete' ? 'destructive' : 'default'} disabled={pending || review === null} onClick={onConfirm}>
                        {pending ? pendingLabel : label}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/**
 * Um grupo do diálogo ("11 transações serão excluídas"): as primeiras linhas e "e mais n
 * transações", com a opção de ver todas (desktop-mvp-plan Fase 9.2). Cada linha é só a
 * data e a situação, com a marca de editada à mão.
 *
 * @param props.group Grupo do diálogo.
 * @return A lista do grupo.
 */
function ReviewGroupList({ group }: { readonly group: ReviewGroup }): ReactNode {
    const [expanded, setExpanded] = useState(false);
    const rows = expanded ? group.rows : group.rows.slice(0, REVIEW_VISIBLE_ROWS);
    const more = expanded ? null : formatHiddenRows(group.rows.length - rows.length);
    return (
        <section aria-label={group.title} className="flex flex-col gap-1">
            <h3 className="font-semibold">{group.title}</h3>
            <ul className="flex flex-col">
                {rows.map((row) => (
                    <li key={row.key} className="flex items-center gap-2 border-t border-line2 py-1">
                        <span className="tabular-nums">{row.date}</span>
                        <StatusTag tone={row.paid ? 'warn' : 'neutral'}>{row.status}</StatusTag>
                        {row.editedByHand && <StatusTag tone="neutral">Editada manualmente</StatusTag>}
                    </li>
                ))}
            </ul>
            {(more !== null || expanded) && (
                <div className="flex items-center gap-2 text-12 text-muted">
                    {more !== null && <span>{more}</span>}
                    <Button
                        type="button"
                        variant="link"
                        size="xs"
                        className="h-auto p-0 text-12"
                        onClick={() => {
                            setExpanded(!expanded);
                        }}
                    >
                        {expanded ? 'Ver menos' : 'Ver todas'}
                    </Button>
                </div>
            )}
        </section>
    );
}
