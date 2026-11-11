import { describeAccountDeletion, useAccountDeletionImpact, useCoreMutation } from '@finance/client';
import type { AccountResponse } from '@finance/core';
import { useState, type ReactNode } from 'react';
import { DeletionSheet } from '../ui/DeletionSheet.tsx';

/**
 * Exclusão de conta com o impacto antes de confirmar (`accounts.deletionImpact`), como o alerta
 * do desktop. A consulta do impacto para assim que a exclusão começa: a invalidação que segue a
 * exclusão a refaria para uma conta que já não existe, e a folha trocaria a lista do que será
 * apagado por um "não encontrado" até fechar.
 *
 * @param props.account Conta a excluir.
 * @param props.onClose Fecha a folha ao desistir.
 * @param props.onDeleted Depois de excluir: a tela sai do extrato, que deixou de existir.
 * @param props.onDisableInstead Desativa a conta em vez de excluí-la; omitido quando ela já
 * está desativada.
 * @return A folha.
 */
export function AccountDeletionSheet(props: {
    readonly account: AccountResponse;
    readonly onClose: () => void;
    readonly onDeleted: () => void;
    readonly onDisableInstead: (() => void) | undefined;
}): ReactNode {
    const { account, onClose, onDeleted, onDisableInstead } = props;
    const [deleting, setDeleting] = useState(false);
    const impact = useAccountDeletionImpact(deleting ? null : { id: account.id });
    const remove = useCoreMutation('accounts.delete');
    return (
        <DeletionSheet
            noun="conta"
            name={account.name}
            warning={impact}
            describe={describeAccountDeletion}
            pending={remove.isPending}
            error={remove.error}
            onConfirm={() => {
                setDeleting(true);
                // `mutateAsync`, e não `mutate` com `onSuccess`: a invalidação que segue a exclusão
                // tira a conta da lista, a tela deixa de montar esta folha, e o TanStack Query não
                // chama os retornos do `mutate` de quem já desmontou — a tela ficaria no extrato
                // de uma conta que não existe. A promessa resolve de qualquer jeito.
                remove.mutateAsync({ id: account.id }).then(onDeleted, () => {
                    setDeleting(false);
                });
            }}
            onClose={onClose}
            onDisableInstead={onDisableInstead}
        />
    );
}
