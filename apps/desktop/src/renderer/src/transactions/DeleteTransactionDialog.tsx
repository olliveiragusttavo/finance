import { describeError, describeTransactionDeletion, useCoreMutation } from '@finance/client';
import type { AccountResponse, CreditCardResponse, TransactionResponse } from '@finance/core';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/**
 * Confirmação de excluir um lançamento (desktop-mvp-plan Fase 9: "Excluir com confirmação"). Diz
 * de onde o valor sai e quais saldos mudam (`describeTransactionDeletion`), em vez de um aviso
 * genérico (brief §4, regra 9). Abre pelo botão do painel, pela tecla `Del` e pelo menu de
 * contexto da tabela.
 *
 * @param props.transaction Lançamento a excluir.
 * @param props.accounts Contas do perfil, desativadas incluídas, para os nomes.
 * @param props.creditCards Cartões do perfil, desativados incluídos, para os nomes.
 * @param props.onClose Fecha o alerta, depois de excluir ou ao desistir.
 * @param props.onDeleted Avisa a tela, que fecha o painel do lançamento excluído.
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
    const text = describeTransactionDeletion({ transaction, accounts, creditCards });
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
                {remove.error !== null && (
                    <p role="alert" className="text-13 text-danger">
                        {describeError(remove.error.error).message}
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
                            remove.mutate(
                                { id: transaction.id },
                                {
                                    onSuccess: () => {
                                        toast.success(`“${transaction.name}” excluído.`);
                                        onDeleted();
                                        onClose();
                                    },
                                },
                            );
                        }}
                    >
                        {remove.isPending ? 'Excluindo…' : 'Excluir lançamento'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
