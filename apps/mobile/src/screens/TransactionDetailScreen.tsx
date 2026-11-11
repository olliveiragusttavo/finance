import {
    buildTransactionTable,
    describeError,
    describeTransactionDeletion,
    formatDate,
    formatMoney,
    formatTransactionType,
    movementPermissions,
    NO_TRANSACTION_FILTERS,
    useAccounts,
    useCategoryTree,
    useCoreMutation,
    useCreditCards,
    useGoalOptions,
    useMonthInvoices,
    useRecurrences,
    useTags,
    useTransaction,
    useTransferTargets,
    type TransactionRow,
} from '@finance/client';
import type { TransactionResponse } from '@finance/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useActiveProfile } from '../shell/ActiveProfile.tsx';
import { Screen } from '../shell/Screen.tsx';
import { ScreenHeader } from '../shell/ScreenHeader.tsx';
import { useReferenceMonth } from '../shell/useReferenceMonth.ts';
import { AppText } from '../ui/AppText.tsx';
import { Button } from '../ui/Button.tsx';
import { FormGroup } from '../ui/form.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { EmptyState, ErrorState, LoadingState } from '../ui/states.tsx';

/** Cor do valor em destaque pelo sentido; o sinal e o ⇄ vêm no texto. */
const HERO_TONE: Readonly<Record<TransactionRow['direction'], string>> = { in: 'text-in', out: 'text-out', transfer: 'text-ink', none: 'text-ink' };

/**
 * Linha de leitura do detalhe (`.it` do mockup): rótulo à esquerda, valor à direita.
 *
 * @param props.label Rótulo.
 * @param props.value Valor; `null` mostra "—".
 * @param props.first Se é a primeira do grupo.
 * @return A linha.
 */
function DetailRow({ label, value, first = false }: { readonly label: string; readonly value: string | null; readonly first?: boolean }): ReactNode {
    return (
        <View className={`min-h-12.5 flex-row items-center justify-between gap-3 px-3.5 py-2.5 ${first ? '' : 'border-t border-line2'}`}>
            <AppText className="text-muted">{label}</AppText>
            <AppText className={`flex-1 text-right ${value === null ? 'text-muted' : ''}`}>{value ?? '—'}</AppText>
        </View>
    );
}

/**
 * Monta a linha legível do lançamento com o mesmo `buildTransactionTable` da lista, sem as faturas
 * do mês — assim a compra no cartão aparece ela mesma, e não agrupada na fatura —, para que o
 * detalhe e a lista nunca escrevam a conta, a categoria ou a situação de jeitos diferentes.
 *
 * @param transaction Lançamento aberto.
 * @param profileId Perfil ativo.
 * @param period Mês de referência, a chave das consultas de contas e cartões já em cache.
 * @return A linha, ou `null` enquanto os cadastros carregam.
 */
function useTransactionRow(transaction: TransactionResponse | undefined, profileId: string, period: string): TransactionRow | null {
    const accounts = useAccounts({ profileId, period });
    const otherProfileAccounts = useTransferTargets({ profileId });
    const creditCards = useCreditCards({ profileId, period });
    const categories = useCategoryTree({ profileId });
    const recurrences = useRecurrences({ profileId });
    const transactions = useMemo(() => (transaction === undefined ? undefined : [transaction]), [transaction]);
    const invoices = useMonthInvoices(transactions);
    return useMemo(() => {
        if (transactions === undefined || accounts.data === undefined || creditCards.data === undefined || categories.data === undefined) {
            return null;
        }
        const table = buildTransactionTable(
            {
                profileId,
                transactions,
                accounts: accounts.data.accounts,
                otherProfileAccounts: otherProfileAccounts.data ?? [],
                creditCards: creditCards.data.creditCards,
                categories: categories.data,
                invoices,
                recurrences: recurrences.data ?? [],
            },
            NO_TRANSACTION_FILTERS,
        );
        const row = table.rows[0];
        return row?.kind === 'transaction' ? row : null;
    }, [transactions, accounts.data, otherProfileAccounts.data, creditCards.data, categories.data, invoices, recurrences.data, profileId]);
}

/**
 * Detalhe do lançamento (mockup `MobileTransacaoDetalhe`; mobile-mvp-plan, Fase 9): o valor em
 * destaque, os dados do lançamento e as ações. "Marcar como pago" só aparece onde o desktop
 * deixa: a compra no cartão segue a fatura e a transferência que chega de outro perfil é só
 * leitura (`movementPermissions`). Excluir pede confirmação com o texto do desktop
 * (`describeTransactionDeletion`).
 *
 * @return A tela.
 */
export function TransactionDetailScreen(): ReactNode {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const router = useRouter();
    const query = useTransaction({ id });
    const transaction = query.data;
    const row = useTransactionRow(transaction, profile.id, period);
    const tags = useTags({ profileId: profile.id });
    const goals = useGoalOptions({ profileId: profile.id });
    const accounts = useAccounts({ profileId: profile.id, period });
    const creditCards = useCreditCards({ profileId: profile.id, period });
    const setPaid = useCoreMutation('transactions.setPaid');
    const remove = useCoreMutation('transactions.delete');
    const [confirming, setConfirming] = useState(false);

    const header = <ScreenHeader title="Detalhe" back />;
    if (transaction === undefined || row === null) {
        if (query.error !== null) {
            return (
                <Screen header={header}>
                    {query.error.code === 'NOT_FOUND' ? (
                        <EmptyState title="Este lançamento não existe mais" body="Ele pode ter sido excluído." />
                    ) : (
                        <ErrorState
                            error={query.error}
                            onRetry={() => {
                                void query.refetch();
                            }}
                        />
                    )}
                </Screen>
            );
        }
        return (
            <Screen header={header}>
                <LoadingState label="Abrindo o lançamento…" />
            </Screen>
        );
    }

    const permissions = movementPermissions(transaction, profile.id);
    const tagNames = transaction.tagIds.map((tagId) => tags.data?.find((tag) => tag.id === tagId)?.name).filter((name) => name !== undefined);
    const goal = transaction.goalId === null ? null : (goals.data?.find((option) => option.id === transaction.goalId)?.name ?? null);
    const deletion = describeTransactionDeletion({ transaction, accounts: accounts.data?.accounts ?? [], creditCards: creditCards.data?.creditCards ?? [] });
    const onCard = transaction.container.kind === 'invoice' && transaction.destinationAccountId === null;

    return (
        <Screen header={header}>
            <View className="items-center gap-1 py-2">
                <AppText className={`text-28 font-semibold ${HERO_TONE[row.direction]}`}>{row.amountText}</AppText>
                <AppText className="text-17">{transaction.name}</AppText>
                <View className="flex-row gap-1.5">
                    {row.refund && (
                        <View className="rounded-full bg-soft px-2 py-0.5">
                            <AppText className="text-12 text-soft-ink">estorno</AppText>
                        </View>
                    )}
                    {row.recurrenceTag !== null && (
                        <View className="rounded-full bg-soft px-2 py-0.5">
                            <AppText className="text-12 text-soft-ink">{row.recurrenceTag}</AppText>
                        </View>
                    )}
                    <View className="rounded-full bg-line2 px-2 py-0.5">
                        <AppText className="text-12 text-ink2">{row.situationText}</AppText>
                    </View>
                </View>
            </View>
            <FormGroup>
                <DetailRow first label="Tipo" value={formatTransactionType(transaction.type)} />
                <DetailRow label="Categoria" value={row.category} />
                <DetailRow label={onCard ? 'Cartão · fatura' : 'Conta'} value={row.container} />
                <DetailRow label={onCard ? 'Data da compra' : 'Vencimento'} value={formatDate(transaction.dueDate)} />
                {!onCard && <DetailRow label="Pagamento" value={transaction.paymentDate === null ? null : formatDate(transaction.paymentDate)} />}
                {transaction.charges.amount !== 0 && <DetailRow label="Encargos" value={formatMoney(transaction.charges)} />}
                <DetailRow label="Tags" value={tagNames.length === 0 ? 'nenhuma' : tagNames.join(', ')} />
                {goal !== null && <DetailRow label="Meta" value={goal} />}
                {transaction.description !== null && <DetailRow label="Observação" value={transaction.description} />}
            </FormGroup>
            {permissions.readOnly && <AppText className="text-13 text-muted">Esta transferência veio de outro perfil. Para alterá-la, abra o perfil de origem.</AppText>}
            {!permissions.readOnly && !permissions.payable && onCard && <AppText className="text-13 text-muted">A situação de uma compra no cartão é a da fatura: pague ou reabra a fatura em Cartões.</AppText>}
            {setPaid.isError && <AppText accessibilityRole="alert" className="text-13 text-danger">{describeError(setPaid.error.error).message}</AppText>}
            {!permissions.readOnly && (
                <View className="gap-2.5">
                    {permissions.payable && (
                        <Button
                            label={transaction.paid ? 'Voltar a pendente' : transaction.type === 'income' ? 'Marcar como recebido' : 'Marcar como pago'}
                            variant={transaction.paid ? 'secondary' : 'primary'}
                            busy={setPaid.isPending}
                            onPress={() => {
                                setPaid.mutate({ id: transaction.id, paid: !transaction.paid });
                            }}
                        />
                    )}
                    {transaction.recurrenceId === null && (
                        <Button
                            label="Excluir"
                            variant="danger"
                            onPress={() => {
                                setConfirming(true);
                            }}
                        />
                    )}
                </View>
            )}
            <Sheet
                open={confirming}
                title={deletion.title}
                onClose={() => {
                    setConfirming(false);
                }}
            >
                <AppText className="text-ink2">{deletion.description}</AppText>
                {remove.isError && <AppText accessibilityRole="alert" className="text-13 text-danger">{describeError(remove.error.error).message}</AppText>}
                <Button
                    label="Excluir lançamento"
                    variant="danger"
                    busy={remove.isPending}
                    onPress={() => {
                        remove.mutate({ id: transaction.id, scope: 'single' }, {
                            onSuccess: () => {
                                setConfirming(false);
                                router.back();
                            },
                        });
                    }}
                />
                <Button
                    label="Cancelar"
                    variant="secondary"
                    onPress={() => {
                        setConfirming(false);
                    }}
                />
            </Sheet>
        </Screen>
    );
}
