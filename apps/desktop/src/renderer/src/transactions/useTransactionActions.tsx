import { otherProfileAccountLabel, useAccounts, useCoreMutation, useCreditCards, useRecurrences, useTransferTargets, type MovementTarget } from '@finance/client';
import type { TransactionResponse } from '@finance/core';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useActiveProfile } from '@/shell/activeProfile';
import { useReferenceMonth } from '@/shell/useReferenceMonth';
import { DeleteTransactionDialog } from './DeleteTransactionDialog.tsx';
import { TransactionDialog } from './TransactionDialog.tsx';

/** O diálogo de lançamento aberto: um novo, com a origem sugerida, ou a edição de um existente. */
type EditorState = { readonly mode: 'new'; readonly initialSource: string } | { readonly mode: 'edit'; readonly transaction: TransactionResponse; readonly container: string | null };

/** O que as telas com a listagem de movimentos fazem com uma linha. */
export interface TransactionActions {
    /** Lançamento aberto na edição, marcado na lista. */
    readonly editingId: string | null;
    /** Abre o lançamento novo, com a origem sugerida (`sourceKey`) ou vazia. */
    readonly openNew: (initialSource: string) => void;
    /** Clique e `Enter`: edita o lançamento ou abre a fatura em Cartões. */
    readonly open: (target: MovementTarget) => void;
    /** Clique na situação e `P`: marca ou desmarca o pagamento com a data de hoje. */
    readonly togglePaid: (target: MovementTarget, name: string) => void;
    /** `Del` e "Excluir…": abre a confirmação de excluir. */
    readonly remove: (target: MovementTarget) => void;
    /** Os diálogos de lançamento e de exclusão, para a tela desenhar. */
    readonly dialogs: ReactNode;
}

/**
 * Ações sobre as linhas da listagem de movimentos, as mesmas em Transações, no extrato de Contas e
 * na fatura de Cartões (desktop-mvp-plan Fase 13.2): antes cada tela tinha a sua — em Contas não
 * se editava nada, e em Cartões não se marcava pago —, e as regras de quem pode o quê ficavam
 * repetidas. Cada tela só monta as linhas; o que abrir, pagar e excluir fazem vem daqui.
 *
 * @param options.onSaved Recebe o lançamento gravado, para a tela selecioná-lo ou avisar onde ele caiu.
 * @param options.onDeleted Recebe o id do lançamento excluído, para a tela tirar a seleção.
 * @return As ações e os diálogos.
 */
export function useTransactionActions(options: { readonly onSaved?: (saved: TransactionResponse) => void; readonly onDeleted?: (id: string) => void } = {}): TransactionActions {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const navigate = useNavigate();
    const accounts = useAccounts({ profileId: profile.id, period });
    const otherProfileAccounts = useTransferTargets({ profileId: profile.id });
    const creditCards = useCreditCards({ profileId: profile.id, period });
    const recurrences = useRecurrences({ profileId: profile.id });
    const setPaid = useCoreMutation('transactions.setPaid');
    const [editor, setEditor] = useState<EditorState | null>(null);
    const [deleting, setDeleting] = useState<TransactionResponse | null>(null);
    // Nomes das contas do outro perfil para o alerta de exclusão de uma transferência que sai daqui.
    const namedAccounts = useMemo(
        () => [...(accounts.data?.accounts ?? []), ...(otherProfileAccounts.data ?? []).map((account) => ({ id: account.id, name: otherProfileAccountLabel(account) }))],
        [accounts.data, otherProfileAccounts.data],
    );

    /**
     * Regra de negócio (Transferência entre perfis, database-design §4.13): a transferência
     * recebida de outro perfil é uma linha só, do perfil de origem; editar, pagar ou excluir daqui
     * mexeria no extrato de um perfil que não está aberto. Avisa onde fazer a alteração em vez de
     * abrir um formulário com a subcategoria e as tags do outro perfil.
     *
     * @param target Linha em que o usuário agiu.
     * @return `true` quando a linha é só para leitura e a ação foi barrada.
     */
    const blockedReadOnly = (target: Extract<MovementTarget, { kind: 'transaction' }>): boolean => {
        if (target.readOnly) {
            toast.info('Esta transferência veio de outro perfil. Para alterá-la, abra o perfil de origem.');
        }
        return target.readOnly;
    };

    /**
     * @param target Linha aberta: a fatura leva a Cartões, onde estão as compras, o pagamento e a
     * reabertura (desktop-mvp-plan Fase 11.1); o lançamento abre a edição.
     */
    const open = (target: MovementTarget): void => {
        if (target.kind === 'invoice') {
            void navigate({ to: '/cards', search: { card: target.creditCardId, invoice: target.period } });
        } else if (!blockedReadOnly(target)) {
            setEditor({ mode: 'edit', transaction: target.transaction, container: target.container });
        }
    };

    /**
     * Marca ou desmarca o pagamento com a data de hoje.
     * Regra de negócio (Cartão, database-design §4.7): numa compra no cartão quem decide se o
     * dinheiro saiu é a fatura, não a compra; marcar a compra não mudaria a situação mostrada, e a
     * tela diz onde pagar. O pagamento parcial é a exceção: é dinheiro que sai da conta no dia
     * dele, com a situação própria. A linha da fatura também leva a Cartões, onde se paga.
     *
     * @param target Linha selecionada.
     * @param name Nome da linha, para a confirmação.
     */
    const togglePaid = (target: MovementTarget, name: string): void => {
        if (target.kind === 'invoice') {
            toast.info('Para pagar ou reabrir a fatura, abra-a em Cartões (Enter).');
            return;
        }
        if (blockedReadOnly(target)) {
            return;
        }
        if (!target.payable) {
            toast.info('A situação de uma compra no cartão é a da fatura: pague ou reabra a fatura em Cartões.');
            return;
        }
        const paid = !target.transaction.paid;
        setPaid.mutate(
            { id: target.transaction.id, paid },
            {
                onSuccess: () => {
                    toast.success(paid ? `“${name}” marcado como pago.` : `“${name}” voltou a pendente.`);
                },
                onError: (error) => {
                    toast.error(error.message);
                },
            },
        );
    };

    /**
     * @param target Linha a excluir; a fatura não se exclui, e a tela diz onde estão as compras.
     */
    const remove = (target: MovementTarget): void => {
        if (target.kind === 'invoice') {
            toast.info('A fatura não se exclui: abra-a (Enter) para editar ou excluir as compras dela.');
        } else if (!blockedReadOnly(target)) {
            setDeleting(target.transaction);
        }
    };

    /**
     * Fica estável entre renders porque a tela de Transações a registra como o "+ Lançamento" do
     * shell (`useTransactionPanelHost`); uma referência nova a cada render refaria o registro sem
     * parar.
     *
     * @param initialSource Origem sugerida (`sourceKey`) vinda do filtro da tela, ou vazia quando
     * não há sugestão.
     */
    const openNew = useCallback((initialSource: string): void => {
        setEditor({ mode: 'new', initialSource });
    }, []);

    const dialogs = (
        <>
            {editor !== null && (
                <TransactionDialog
                    key={editor.mode === 'edit' ? editor.transaction.id : 'new'}
                    transaction={editor.mode === 'edit' ? editor.transaction : null}
                    container={editor.mode === 'edit' ? editor.container : null}
                    recurrence={editor.mode === 'edit' ? (recurrences.data?.find((recurrence) => recurrence.id === editor.transaction.recurrenceId) ?? null) : null}
                    initialSource={editor.mode === 'new' ? editor.initialSource : undefined}
                    onClose={() => {
                        setEditor(null);
                    }}
                    onSaved={options.onSaved}
                    onDelete={(transaction) => {
                        setDeleting(transaction);
                    }}
                />
            )}
            {deleting !== null && (
                <DeleteTransactionDialog
                    transaction={deleting}
                    accounts={namedAccounts}
                    creditCards={creditCards.data?.creditCards ?? []}
                    onClose={() => {
                        setDeleting(null);
                    }}
                    onDeleted={() => {
                        setEditor((current) => (current?.mode === 'edit' && current.transaction.id === deleting.id ? null : current));
                        options.onDeleted?.(deleting.id);
                    }}
                />
            )}
        </>
    );

    return {
        editingId: editor?.mode === 'edit' ? editor.transaction.id : null,
        openNew,
        open,
        togglePaid,
        remove,
        dialogs,
    };
}
