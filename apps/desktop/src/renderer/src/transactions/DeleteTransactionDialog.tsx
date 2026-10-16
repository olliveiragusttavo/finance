import { describeError, describeTransactionDeletion, useCoreMutation, type EditScope } from '@finance/client';
import type { AccountResponse, CreditCardResponse, TransactionResponse } from '@finance/core';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScopeDialog } from './ScopeDialog.tsx';
import { SeriesReviewDialog } from './SeriesReviewDialog.tsx';

/**
 * Confirmação de excluir um lançamento (desktop-mvp-plan Fase 9: "Excluir com confirmação"). Diz
 * de onde o valor sai e quais saldos mudam (`describeTransactionDeletion`), em vez de um aviso
 * genérico (brief §4, regra 9). Abre pelo botão do diálogo de edição, pela tecla `Del` e pelo menu de
 * contexto da tabela. Numa ocorrência de série, pergunta o escopo (Fase 9.1) e, em "esta e as
 * futuras" e "todas", mostra o que será excluído antes de excluir (diálogo de revisão,
 * database-design §4.12); "somente esta" exclui direto do escopo (Fase 13.2).
 *
 * @param props.transaction Lançamento a excluir.
 * @param props.accounts Contas do perfil, desativadas incluídas, para os nomes.
 * @param props.creditCards Cartões do perfil, desativados incluídos, para os nomes.
 * @param props.onClose Fecha o alerta, depois de excluir ou ao desistir.
 * @param props.onDeleted Avisa a tela, que fecha o diálogo de edição do lançamento excluído.
 * @return O alerta.
 */
export function DeleteTransactionDialog({
    transaction,
    accounts,
    creditCards,
    onClose,
    onDeleted,
}: {
    readonly transaction: TransactionResponse;
    readonly accounts: readonly Pick<AccountResponse, 'id' | 'name'>[];
    readonly creditCards: readonly Pick<CreditCardResponse, 'id' | 'name'>[];
    readonly onClose: () => void;
    readonly onDeleted: () => void;
}): ReactNode {
    const remove = useCoreMutation('transactions.delete');
    const [reviewScope, setReviewScope] = useState<EditScope | null>(null);
    const text = describeTransactionDeletion({ transaction, accounts, creditCards });
    /**
     * Exclui no escopo escolhido e fecha o alerta.
     *
     * @param scope Escopo da exclusão; num lançamento avulso, "somente esta".
     */
    const confirm = (scope: EditScope): void => {
        remove.mutate(
            { id: transaction.id, scope },
            {
                onSuccess: () => {
                    toast.success(scope === 'single' ? `“${transaction.name}” excluído.` : `Lançamentos de “${transaction.name}” excluídos.`);
                    onDeleted();
                    onClose();
                },
            },
        );
    };
    const failure = remove.error === null ? null : describeError(remove.error.error).message;
    if (transaction.recurrenceId !== null) {
        // Ocorrência de série: primeiro o escopo; em "esta e as futuras" e "todas", depois a
        // revisão do que sai — com as pagas e os saldos que mudam (database-design §4.12; mockup
        // `MobileEscopo`). "Somente esta" exclui direto do escopo, que já diz o que sai.
        if (reviewScope === null) {
            return (
                <ScopeDialog
                    transaction={transaction}
                    title={text.title}
                    action="delete"
                    pending={remove.isPending}
                    error={failure}
                    onConfirm={(scope) => {
                        if (scope === 'single') {
                            confirm(scope);
                        } else {
                            setReviewScope(scope);
                        }
                    }}
                    onClose={onClose}
                />
            );
        }
        return (
            <SeriesReviewDialog
                name={transaction.name}
                request={{ action: 'delete', input: { id: transaction.id, scope: reviewScope } }}
                accounts={accounts}
                pending={remove.isPending}
                error={failure}
                onConfirm={() => {
                    confirm(reviewScope);
                }}
                onClose={() => {
                    setReviewScope(null);
                }}
            />
        );
    }
    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
        >
            <DialogContent showCloseButton={false} role="alertdialog">
                <DialogHeader>
                    <DialogTitle>{text.title}</DialogTitle>
                    <DialogDescription>{text.description}</DialogDescription>
                </DialogHeader>
                {failure !== null && (
                    <p role="alert" className="text-13 text-danger">
                        {failure}
                    </p>
                )}
                <DialogFooter>
                    <Button type="button" variant="outline" autoFocus onClick={onClose}>
                        Cancelar
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        disabled={remove.isPending}
                        onClick={() => {
                            confirm('single');
                        }}
                    >
                        {remove.isPending ? 'Excluindo…' : 'Excluir lançamento'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
