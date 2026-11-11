import { describeCreditCardDeletion, useCoreMutation, useCreditCardDeletionImpact } from '@finance/client';
import type { CreditCardResponse } from '@finance/core';
import { useState, type ReactNode } from 'react';
import { DeletionSheet } from '../ui/DeletionSheet.tsx';

/**
 * Exclusão de cartão com o impacto antes de confirmar (`creditCards.deletionImpact`), como o
 * alerta do desktop. A consulta do impacto para assim que a exclusão começa, pelo mesmo motivo da
 * exclusão de conta: refeita depois da exclusão, ela acusaria "não encontrado".
 *
 * @param props.creditCard Cartão a excluir.
 * @param props.onClose Fecha a folha ao desistir.
 * @param props.onDeleted Depois de excluir: a tela sai da fatura, que deixou de existir.
 * @param props.onDisableInstead Desativa o cartão em vez de excluí-lo; omitido quando ele já
 * está desativado.
 * @return A folha.
 */
export function CreditCardDeletionSheet(props: {
    readonly creditCard: CreditCardResponse;
    readonly onClose: () => void;
    readonly onDeleted: () => void;
    readonly onDisableInstead: (() => void) | undefined;
}): ReactNode {
    const { creditCard, onClose, onDeleted, onDisableInstead } = props;
    const [deleting, setDeleting] = useState(false);
    const impact = useCreditCardDeletionImpact(deleting ? null : { id: creditCard.id });
    const remove = useCoreMutation('creditCards.delete');
    return (
        <DeletionSheet
            noun="cartão"
            name={creditCard.name}
            warning={impact}
            describe={describeCreditCardDeletion}
            pending={remove.isPending}
            error={remove.error}
            onConfirm={() => {
                setDeleting(true);
                // `mutateAsync` pelo mesmo motivo da exclusão de conta: a folha desmonta quando o
                // cartão sai da lista, e os retornos do `mutate` não seriam chamados.
                remove.mutateAsync({ id: creditCard.id }).then(onDeleted, () => {
                    setDeleting(false);
                });
            }}
            onClose={onClose}
            onDisableInstead={onDisableInstead}
        />
    );
}
