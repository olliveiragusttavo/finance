import { groupTransactionsByDay, NO_TRANSACTION_FILTERS, transactionTotals, type TransactionFilters, type TransactionTableRow } from '@finance/client';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useActiveProfile } from '../shell/ActiveProfile.tsx';
import { invoiceRoute, transactionRoute } from '../shell/routes.ts';
import { MonthStrip } from '../shell/MonthStrip.tsx';
import { NewTransactionButton } from '../shell/Screen.tsx';
import { ScreenHeader } from '../shell/ScreenHeader.tsx';
import { useReferenceMonth } from '../shell/useReferenceMonth.ts';
import { useThemeColor } from '../theme/ThemeRoot.tsx';
import { countActiveFilters, TransactionFiltersSheet } from '../transactions/TransactionFiltersSheet.tsx';
import { useTransactionTable } from '../transactions/useTransactionTable.ts';
import { AppText } from '../ui/AppText.tsx';
import { IconButton } from '../ui/IconButton.tsx';
import { EmptyState, ErrorState, LoadingState } from '../ui/states.tsx';

/** Um item da lista virtualizada: o título de um dia ou uma linha. */
type ListItem = { readonly kind: 'day'; readonly key: string; readonly label: string } | { readonly kind: 'row'; readonly key: string; readonly row: TransactionTableRow };

/** Cor do valor pelo sentido; o sinal e o ⇄ já vêm no texto (decisão de interface 7). */
const AMOUNT_TONE: Readonly<Record<TransactionTableRow['direction'], string>> = { in: 'text-in', out: 'text-out', transfer: 'text-ink', none: 'text-ink' };

/**
 * @param row Linha da tabela.
 * @return A linha de apoio à direita: a situação e a recorrência (`pendente · fixa`), sem a
 * situação "Paga", que é o caso comum e só ocuparia espaço.
 */
function rowHint(row: TransactionTableRow): string {
    const parts = [row.situation === 'paid' ? null : row.situationText.toLowerCase(), row.recurrenceTag === null ? null : row.recurrenceTag.toLowerCase()];
    return parts.filter((part) => part !== null).join(' · ');
}

/**
 * Uma linha de Transações (`.it` do mockup): nome, "conta · categoria", valor com o sinal e a
 * situação. O estorno leva a etiqueta "estorno", como no desktop.
 *
 * @param props.row Linha já formatada pelo `buildTransactionTable`.
 * @param props.first Primeira linha do dia: borda e cantos de cima do grupo.
 * @param props.last Última linha do dia: cantos de baixo do grupo.
 * @param props.onPress Abre o detalhe do lançamento ou a fatura.
 * @return A linha.
 */
function TransactionItem(props: { readonly row: TransactionTableRow; readonly first: boolean; readonly last: boolean; readonly onPress: () => void }): ReactNode {
    const { row, first, last, onPress } = props;
    const hint = rowHint(row);
    const refund = row.kind === 'transaction' && row.refund;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={[row.name, refund ? 'estorno' : null, row.container, row.category, row.amountText, hint === '' ? null : hint].filter((part) => part !== null).join(', ')}
            onPress={onPress}
            className={`mx-4 min-h-13 flex-row items-center justify-between gap-2.5 border-x border-b border-line bg-surface px-3.5 py-2.5 active:bg-line2 ${first ? 'rounded-t-12 border-t' : ''} ${last ? 'rounded-b-12' : ''}`}
        >
            <View className="min-w-0 flex-1">
                <View className="flex-row items-center gap-1.5">
                    <AppText className="shrink" numberOfLines={1}>{row.name}</AppText>
                    {refund && (
                        <View className="rounded-full bg-soft px-1.5">
                            <AppText className="text-11 text-soft-ink">estorno</AppText>
                        </View>
                    )}
                </View>
                <AppText className="text-12 text-muted" numberOfLines={1}>{row.category === '' ? row.container : `${row.container} · ${row.category}`}</AppText>
            </View>
            <View className="items-end">
                <AppText className={`font-medium ${AMOUNT_TONE[row.direction]}`}>{row.amountText}</AppText>
                {hint !== '' && <AppText className="text-12 text-muted">{hint}</AppText>}
            </View>
        </Pressable>
    );
}

/**
 * Transações do mês (mockup `MobileTransacoes`; mobile-mvp-plan, Fase 9): entradas, saídas e
 * resultado no topo, a lista por dia numa `FlashList` — um mês tem centenas de linhas, e a
 * reciclagem mantém a rolagem fluida com o núcleo na mesma thread —, a busca e os filtros em
 * folha. A tabela é a do desktop (`buildTransactionTable`): sem filtro, as compras do cartão ficam
 * na linha da fatura, que abre o cartão.
 *
 * @return A tela.
 */
export function TransactionsScreen(): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const router = useRouter();
    const [filters, setFilters] = useState<TransactionFilters>(NO_TRANSACTION_FILTERS);
    const [searching, setSearching] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const state = useTransactionTable(profile.id, period, filters);
    const placeholder = useThemeColor('muted');
    const active = countActiveFilters(filters);

    const items = useMemo((): readonly ListItem[] => {
        if (state.table === null) {
            return [];
        }
        return groupTransactionsByDay(state.table).flatMap((day): ListItem[] => [
            { kind: 'day', key: `day:${day.key}`, label: day.label },
            ...day.rows.map((row): ListItem => ({ kind: 'row', key: row.id, row })),
        ]);
    }, [state.table]);
    const totals = state.table === null ? null : transactionTotals(state.table);

    /**
     * @param row Linha tocada.
     */
    const open = (row: TransactionTableRow): void => {
        router.push(row.kind === 'invoice' ? invoiceRoute(row.invoice.creditCardId, row.invoice.period) : transactionRoute(row.id));
    };

    const header = (
        <ScreenHeader
            title="Transações"
            actions={
                <>
                    <IconButton
                        icon="search"
                        label={searching ? 'Fechar a busca' : 'Buscar'}
                        onPress={() => {
                            if (searching) {
                                setFilters({ ...filters, search: '' });
                            }
                            setSearching(!searching);
                        }}
                    />
                    <IconButton
                        icon="filter"
                        label={active === 0 ? 'Filtrar, nenhum filtro ativo' : `Filtrar, ${String(active)} ${active === 1 ? 'filtro ativo' : 'filtros ativos'}`}
                        onPress={() => {
                            setFiltersOpen(true);
                        }}
                    />
                </>
            }
        />
    );

    return (
        <View className="flex-1 bg-bg">
            {header}
            <MonthStrip />
            {searching && (
                <View className="border-b border-line bg-surface px-4 py-2">
                    <TextInput
                        autoFocus
                        accessibilityLabel="Buscar lançamentos"
                        placeholder="Buscar por nome, conta, categoria…"
                        placeholderTextColor={placeholder}
                        value={filters.search}
                        onChangeText={(search) => {
                            setFilters({ ...filters, search });
                        }}
                        className="min-h-11 rounded-10 border border-line bg-bg px-3 font-sans text-15 text-ink"
                    />
                </View>
            )}
            {totals !== null && (
                <View accessibilityRole="summary" className="flex-row justify-between border-b border-line bg-surface px-4 py-2">
                    <View>
                        <AppText className="text-11 text-muted">↑ Entradas</AppText>
                        <AppText className="text-14 font-medium text-in">{totals.incoming}</AppText>
                    </View>
                    <View>
                        <AppText className="text-11 text-muted">↓ Saídas</AppText>
                        <AppText className="text-14 font-medium text-out">{totals.outgoing}</AppText>
                    </View>
                    <View className="items-end">
                        <AppText className="text-11 text-muted">Resultado</AppText>
                        <AppText className="text-14 font-semibold">{totals.result}</AppText>
                    </View>
                </View>
            )}
            {state.table === null && state.error !== null && (
                <View className="p-4">
                    <ErrorState error={state.error} onRetry={state.refetch} />
                </View>
            )}
            {state.table === null && state.error === null && <LoadingState label="Abrindo as transações…" />}
            {state.table !== null && items.length === 0 && (
                <View className="p-4">
                    <EmptyState title={active === 0 && filters.search.trim() === '' ? 'Nenhum lançamento neste mês' : 'Nenhum lançamento com estes filtros'} body="Lance pelo + no canto da tela." />
                </View>
            )}
            {items.length > 0 && (
                <FlashList
                    data={items}
                    keyExtractor={(item) => item.key}
                    getItemType={(item) => item.kind}
                    contentContainerStyle={{ paddingBottom: 96 }}
                    renderItem={({ item, index }) => {
                        if (item.kind === 'day') {
                            return (
                                <AppText accessibilityRole="header" className="px-4 pb-1.5 pt-3.5 text-12 font-semibold text-muted">
                                    {item.label}
                                </AppText>
                            );
                        }
                        const previous = items[index - 1];
                        const next = items[index + 1];
                        return (
                            <TransactionItem
                                row={item.row}
                                first={previous?.kind === 'day'}
                                last={next === undefined || next.kind === 'day'}
                                onPress={() => {
                                    open(item.row);
                                }}
                            />
                        );
                    }}
                />
            )}
            <NewTransactionButton />
            <TransactionFiltersSheet
                open={filtersOpen}
                onClose={() => {
                    setFiltersOpen(false);
                }}
                profileId={profile.id}
                period={period}
                filters={filters}
                onChange={setFilters}
            />
        </View>
    );
}
