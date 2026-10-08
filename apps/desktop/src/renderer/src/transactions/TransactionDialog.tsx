import { describeOccurrence, formatTransactionType } from '@finance/client';
import type { RecurrenceResponse, TransactionResponse } from '@finance/core';
import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TransactionForm } from './TransactionForm.tsx';

/**
 * Diálogo de criação e edição de lançamento, como os de contas e cartões (pedido do usuário,
 * desktop-mvp-plan Fase 9: o formulário saiu da coluna ao lado da tabela). O mesmo diálogo serve
 * à tela de Transações e ao "+ Lançamento" das outras telas, para que lançar seja igual de
 * qualquer lugar.
 *
 * @param props.transaction Lançamento editado; `null` num lançamento novo.
 * @param props.container Onde o lançamento editado está ("Nubank", "Roxinho · fat. nov"), para o
 * subtítulo de um avulso; `null` num novo ou quando a tabela não o mostra.
 * @param props.recurrence Série do lançamento editado, para dizer a posição dele nela; `null`
 * num avulso, num novo ou enquanto a série carrega.
 * @param props.initialSource Origem sugerida para o novo (`sourceKey`).
 * @param props.onClose Fecha o diálogo, depois de salvar ou ao desistir.
 * @param props.onSaved Recebe o lançamento gravado, para a tela selecioná-lo na tabela.
 * @param props.onDelete Abre a confirmação de excluir o editado; ausente num novo.
 * @return O diálogo.
 */
export function TransactionDialog({
    transaction,
    container = null,
    recurrence = null,
    initialSource,
    onClose,
    onSaved,
    onDelete,
}: {
    readonly transaction: TransactionResponse | null;
    readonly container?: string | null;
    readonly recurrence?: RecurrenceResponse | null;
    readonly initialSource?: string;
    readonly onClose: () => void;
    readonly onSaved?: (saved: TransactionResponse) => void;
    readonly onDelete?: (transaction: TransactionResponse) => void;
}): ReactNode {
    // Mockup: "Despesa · parcela 3 de 12 (valor total R$ 4.800,00)".
    const subtitle = transaction === null
        ? 'Despesa, receita, transferência ou investimento.'
        : [formatTransactionType(transaction.type), recurrence === null ? container : describeOccurrence(transaction, recurrence)].filter((part) => part !== null).join(' · ');
    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
        >
            <DialogContent showCloseButton={false} className="max-h-[calc(100vh-4rem)] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="break-words">{transaction === null ? 'Novo lançamento' : `Editar ${transaction.name}`}</DialogTitle>
                    <DialogDescription>{subtitle}</DialogDescription>
                </DialogHeader>
                <TransactionForm
                    transaction={transaction}
                    initialSource={initialSource}
                    onClose={onClose}
                    onSaved={onSaved}
                    onDelete={
                        transaction === null || onDelete === undefined
                            ? undefined
                            : () => {
                                  onDelete(transaction);
                              }
                    }
                />
            </DialogContent>
        </Dialog>
    );
}
