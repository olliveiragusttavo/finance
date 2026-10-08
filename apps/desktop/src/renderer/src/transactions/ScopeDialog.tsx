import { scopeChoices, useRecurrenceOccurrences, type EditScope } from '@finance/client';
import type { TransactionResponse } from '@finance/core';
import { useState, type ReactNode } from 'react';
import { Skeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/cn';

/**
 * Pergunta a quais ocorrências da série a edição ou a exclusão se aplica (mockup `MobileEscopo`,
 * adaptado ao desktop; desktop-mvp-plan Fase 9.1). Só a escolha: o que cada escopo exclui, cria e
 * altera — com as pagas e os saldos que mudam — aparece em seguida, no diálogo de revisão
 * (`SeriesReviewDialog`), montado a partir do escopo escolhido (desktop-mvp-plan Fase 9.2).
 * Regra de negócio (Recorrências, database-design §4.12): não há escopo padrão que acerte, então
 * o usuário escolhe; mudar a série não passa por aqui, porque vale sempre para a editada e as
 * futuras.
 *
 * @param props.transaction Ocorrência editada ou excluída.
 * @param props.title Título ("Excluir “Aluguel”", "Salvar “Aluguel”").
 * @param props.action `edit` ou `delete`, que muda a pergunta.
 * @param props.onConfirm Segue para a revisão com o escopo escolhido.
 * @param props.onClose Fecha o diálogo sem escrever.
 * @return O diálogo.
 */
export function ScopeDialog({
    transaction,
    title,
    action,
    onConfirm,
    onClose,
}: {
    readonly transaction: TransactionResponse;
    readonly title: string;
    readonly action: 'edit' | 'delete';
    readonly onConfirm: (scope: EditScope) => void;
    readonly onClose: () => void;
}): ReactNode {
    const occurrences = useRecurrenceOccurrences(transaction.recurrenceId === null ? null : { recurrenceId: transaction.recurrenceId });
    const [scope, setScope] = useState<EditScope>('single');
    const choices = occurrences.data === undefined ? null : scopeChoices({ edited: transaction, occurrences: occurrences.data });
    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
        >
            <DialogContent showCloseButton={false} role={action === 'delete' ? 'alertdialog' : 'dialog'}>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{action === 'delete' ? 'Este lançamento faz parte de uma série. Excluir quais?' : 'Este lançamento faz parte de uma série. Aplicar a quais?'}</DialogDescription>
                </DialogHeader>
                {choices === null ? (
                    <Skeleton className="h-36" />
                ) : (
                    <div role="radiogroup" aria-label="Escopo" className="flex flex-col gap-2">
                        {choices.map((choice) => (
                            <button
                                key={choice.scope}
                                type="button"
                                role="radio"
                                aria-checked={choice.scope === scope}
                                aria-label={choice.label}
                                aria-description={choice.detail}
                                className={cn(
                                    'flex flex-col items-start gap-0.5 rounded-8 border border-line px-3.5 py-2.5 text-left text-14',
                                    choice.scope === scope && 'border-accent bg-soft text-soft-ink',
                                )}
                                onClick={() => {
                                    setScope(choice.scope);
                                }}
                            >
                                <span className="font-medium">{choice.label}</span>
                                <span className="text-12 text-muted">{choice.detail}</span>
                            </button>
                        ))}
                    </div>
                )}
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>
                        Cancelar
                    </Button>
                    <Button
                        type="button"
                        disabled={choices === null}
                        onClick={() => {
                            onConfirm(scope);
                        }}
                    >
                        Continuar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
