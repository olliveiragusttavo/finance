import {
    buildTransactionTable,
    formatMonthShort,
    formatTransactionSituation,
    TRANSACTION_SITUATIONS,
    useAccounts,
    useCategoryTree,
    useCoreMutation,
    useCreditCards,
    useInvoicesByCards,
    useRecurrences,
    useTags,
    useTransactions,
    type TransactionFilters,
    type TransactionRow,
    type TransactionTable,
} from '@finance/client';
import type { AccountInPeriodResponse, CategoryBranchResponse, CoreInput, CreditCardInPeriodResponse, InvoiceResponse, TagResponse, TransactionResponse } from '@finance/core';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ErrorState, Skeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useActiveProfile } from '@/shell/activeProfile';
import { useTransactionPanel, useTransactionPanelHost } from '@/shell/TransactionPanel';
import { useReferenceMonth } from '@/shell/useReferenceMonth';
import { DeleteTransactionDialog } from './DeleteTransactionDialog.tsx';
import { TransactionDialog } from './TransactionDialog.tsx';
import { sourceKey } from './transactionForm.ts';
import { TransactionGrid } from './TransactionGrid.tsx';
import {
    categoryFilterValue,
    containerFilterValue,
    filtersFromSearch,
    parseCategoryFilterValue,
    parseContainerFilterValue,
    parseTransactionsSearch,
    withFilters,
} from './transactionsSearch.ts';

/** O que o diálogo de lançamento mostra: um lançamento novo ou a edição de um existente. */
type EditorState = { readonly mode: 'new' } | { readonly mode: 'edit'; readonly transaction: TransactionResponse };

/** Valor dos campos de filtro para "Todos/Todas": o `Select` do Radix não aceita valor vazio. */
const ALL = 'all';

/**
 * Transações (mockup `DesktopTransacoes`; desktop-mvp-plan Fase 9): a tabela densa do mês com os
 * filtros e a linha-resumo. Criar e editar abrem o diálogo de lançamento, como os de contas e
 * cartões (pedido do usuário, divergindo da coluna ao lado da tabela do mockup). Os filtros ficam
 * na URL (`transactionsSearch.ts`). O "+ Lançamento" e o `N` abrem o diálogo desta tela no lugar
 * do do shell, para sugerir a origem do filtro e selecionar na tabela o lançamento gravado.
 *
 * @return A tela de Transações.
 */
export function TransactionsScreen(): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const navigate = useNavigate();
    const search = useSearch({ strict: false, select: (raw: Readonly<Record<string, unknown>>) => parseTransactionsSearch(raw) });
    const filters = useMemo(() => filtersFromSearch(search), [search]);
    const transactions = useTransactions({ profileId: profile.id, period });
    const accounts = useAccounts({ profileId: profile.id, period });
    const creditCards = useCreditCards({ profileId: profile.id, period });
    const categories = useCategoryTree({ profileId: profile.id });
    const tags = useTags({ profileId: profile.id });
    const recurrences = useRecurrences({ profileId: profile.id });
    const invoices = useMonthInvoices(transactions.data);
    const [editor, setEditor] = useState<EditorState | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<TransactionResponse | null>(null);
    const setPaid = useCoreMutation('transactions.setPaid');
    const panel = useTransactionPanel();

    const openNew = useCallback(() => {
        setEditor({ mode: 'new' });
    }, []);
    useTransactionPanelHost(openNew);

    const table = useMemo(
        () =>
            transactions.data === undefined || accounts.data === undefined || creditCards.data === undefined || categories.data === undefined
                ? null
                : buildTransactionTable(
                      {
                          transactions: transactions.data,
                          accounts: accounts.data.accounts,
                          creditCards: creditCards.data.creditCards,
                          categories: categories.data,
                          invoices,
                          recurrences: recurrences.data ?? [],
                      },
                      filters,
                  ),
        [transactions.data, accounts.data, creditCards.data, categories.data, invoices, recurrences.data, filters],
    );
    const failed = [transactions, accounts, creditCards, categories].find((query) => query.error !== null)?.error ?? null;

    /**
     * @param next Filtros escolhidos; substituem os da URL sem criar entrada no histórico a cada
     * tecla da busca.
     */
    const changeFilters = (next: TransactionFilters): void => {
        void navigate({ to: '/transactions', search: (current: Readonly<Record<string, unknown>>) => withFilters(current, next), replace: true });
    };

    /**
     * Atalho `P`: marca ou desmarca o pagamento com a data de hoje.
     * Regra de negócio (Cartão, database-design §4.7): numa compra no cartão quem decide se o
     * dinheiro saiu é a fatura, não a compra; marcar a compra não mudaria a situação mostrada, e a
     * tela diz onde pagar.
     *
     * @param row Linha selecionada.
     */
    const togglePaid = (row: TransactionRow): void => {
        if (row.transaction.container.kind === 'invoice') {
            toast.info('A situação de uma compra no cartão é a da fatura: pague ou reabra a fatura em Cartões.');
            return;
        }
        const paid = !row.transaction.paid;
        setPaid.mutate(
            { id: row.id, paid },
            {
                onSuccess: () => {
                    toast.success(paid ? `“${row.name}” marcado como pago.` : `“${row.name}” voltou a pendente.`);
                },
                onError: (error) => {
                    toast.error(error.message);
                },
            },
        );
    };

    return (
        <div className="flex flex-col gap-4">
            <h1 className="text-24 font-semibold">Transações</h1>
            <FilterBar
                filters={filters}
                accounts={accounts.data?.accounts ?? []}
                creditCards={creditCards.data?.creditCards ?? []}
                categories={categories.data ?? []}
                tags={tags.data ?? []}
                summary={table?.summary ?? null}
                onChange={changeFilters}
            />
            <section aria-label="Lançamentos do mês" className="min-w-0 overflow-hidden rounded-10 border border-line bg-surface text-13">
                {failed !== null ? (
                    <div className="p-4">
                        <ErrorState error={failed} />
                    </div>
                ) : table === null ? (
                    <TableSkeleton />
                ) : (
                    <TransactionGrid
                        rows={table.rows}
                        selectedId={selectedId}
                        editingId={editor?.mode === 'edit' ? editor.transaction.id : null}
                        empty={
                            <EmptyTable
                                table={table}
                                period={period}
                                monthHasTransactions={(transactions.data?.length ?? 0) > 0}
                                onNew={panel.openNew}
                                onClear={() => {
                                    changeFilters(withoutFilters(filters));
                                }}
                            />
                        }
                        onSelect={setSelectedId}
                        onEdit={(row) => {
                            setSelectedId(row.id);
                            setEditor({ mode: 'edit', transaction: row.transaction });
                        }}
                        onTogglePaid={togglePaid}
                        onDelete={(row) => {
                            setDeleting(row.transaction);
                        }}
                    />
                )}
            </section>
            {editor !== null && (
                <TransactionDialog
                    key={editor.mode === 'edit' ? editor.transaction.id : 'new'}
                    transaction={editor.mode === 'edit' ? editor.transaction : null}
                    container={editor.mode === 'edit' ? (table?.rows.find((row) => row.id === editor.transaction.id)?.container ?? null) : null}
                    recurrence={editor.mode === 'edit' ? (recurrences.data?.find((recurrence) => recurrence.id === editor.transaction.recurrenceId) ?? null) : null}
                    initialSource={initialSourceOf(filters)}
                    onClose={() => {
                        setEditor(null);
                    }}
                    onSaved={(saved) => {
                        setSelectedId(saved.id);
                    }}
                    onDelete={(transaction) => {
                        setDeleting(transaction);
                    }}
                />
            )}
            {deleting !== null && (
                <DeleteTransactionDialog
                    transaction={deleting}
                    accounts={accounts.data?.accounts ?? []}
                    creditCards={creditCards.data?.creditCards ?? []}
                    onClose={() => {
                        setDeleting(null);
                    }}
                    onDeleted={() => {
                        if (editor?.mode === 'edit' && editor.transaction.id === deleting.id) {
                            setEditor(null);
                        }
                        setSelectedId((current) => (current === deleting.id ? null : current));
                    }}
                />
            )}
        </div>
    );
}

/**
 * Faturas em que caíram as compras no cartão do mês, para a situação "Na fatura"/"Fat. paga". Uma
 * consulta por cartão, a partir da fatura mais antiga que o mês usa — `invoices.listByCard` traz
 * dali em diante as que existem.
 *
 * @param transactions Lançamentos do mês; `undefined` enquanto carregam.
 * @return As faturas conhecidas, com identidade estável entre renders; enquanto carregam, a
 * tabela mostra as compras como "Na fatura", o caso conservador (`buildTransactionTable`).
 */
function useMonthInvoices(transactions: readonly TransactionResponse[] | undefined): readonly InvoiceResponse[] {
    const inputs = useMemo(() => {
        const earliest = new Map<string, string>();
        for (const { container } of transactions ?? []) {
            if (container.kind === 'invoice') {
                const known = earliest.get(container.creditCardId);
                if (known === undefined || container.period < known) {
                    earliest.set(container.creditCardId, container.period);
                }
            }
        }
        return [...earliest].map(([creditCardId, from]): CoreInput<'invoices.listByCard'> => ({ creditCardId, from }));
    }, [transactions]);
    return useInvoicesByCards(inputs).invoices;
}

/**
 * Origem sugerida para o lançamento novo: quem filtrou uma conta ou um cartão e aperta `N` está
 * lançando nele.
 *
 * @param filters Filtros da tela.
 * @return A origem (`sourceKey`), ou vazio sem filtro de conta ou cartão.
 */
function initialSourceOf(filters: TransactionFilters): string {
    const { container } = filters;
    if (container === null) {
        return '';
    }
    return container.kind === 'account' ? sourceKey({ kind: 'account', id: container.accountId }) : sourceKey({ kind: 'creditCard', id: container.creditCardId });
}

/**
 * @param filters Filtros atuais.
 * @return Os mesmos filtros todos vazios — o "Limpar filtros" do estado vazio.
 */
function withoutFilters(filters: TransactionFilters): TransactionFilters {
    return { ...filters, container: null, category: null, tagId: null, situation: null, search: '' };
}

/**
 * Barra de filtros do mockup: busca, conta ou cartão, categoria, tag e situação, com a
 * linha-resumo à direita. As listas mostram também contas e cartões desativados: o histórico
 * continua neles, e filtrá-los é como achar o que foi lançado lá.
 *
 * @param props.filters Filtros atuais.
 * @param props.accounts Contas do perfil.
 * @param props.creditCards Cartões do perfil.
 * @param props.categories Árvore de categorias.
 * @param props.tags Tags do perfil.
 * @param props.summary "7 lançamentos · resultado +R$ 6.280,68"; `null` enquanto carrega.
 * @param props.onChange Recebe os filtros novos.
 * @return A barra.
 */
function FilterBar({
    filters,
    accounts,
    creditCards,
    categories,
    tags,
    summary,
    onChange,
}: {
    readonly filters: TransactionFilters;
    readonly accounts: readonly AccountInPeriodResponse[];
    readonly creditCards: readonly CreditCardInPeriodResponse[];
    readonly categories: readonly CategoryBranchResponse[];
    readonly tags: readonly TagResponse[];
    readonly summary: string | null;
    readonly onChange: (filters: TransactionFilters) => void;
}): ReactNode {
    const [count, result] = (summary ?? '').split(' · resultado ');
    return (
        <div role="search" aria-label="Filtros" className="flex flex-wrap items-end gap-2.5 text-13">
            <label className="flex max-w-80 flex-1 flex-col gap-1">
                <span className="text-12 text-muted">Buscar</span>
                <Input
                    type="search"
                    placeholder="nome, descrição…"
                    className="bg-surface"
                    value={filters.search}
                    onChange={(event) => {
                        onChange({ ...filters, search: event.target.value });
                    }}
                />
            </label>
            <FilterSelect
                label="Conta ou cartão"
                width="w-43"
                value={containerFilterValue(filters.container)}
                onChange={(value) => {
                    onChange({ ...filters, container: parseContainerFilterValue(value) });
                }}
                allLabel="Todos"
            >
                {accounts.length > 0 && (
                    <SelectGroup>
                        <SelectLabel>Contas</SelectLabel>
                        {accounts.map((account) => (
                            <SelectItem key={account.id} value={`account:${account.id}`}>
                                {account.name}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                )}
                {creditCards.length > 0 && (
                    <SelectGroup>
                        <SelectLabel>Cartões</SelectLabel>
                        {creditCards.map((creditCard) => (
                            <SelectItem key={creditCard.id} value={`creditCard:${creditCard.id}`}>
                                {creditCard.name}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                )}
            </FilterSelect>
            <FilterSelect
                label="Categoria"
                width="w-38"
                value={categoryFilterValue(filters.category)}
                onChange={(value) => {
                    onChange({ ...filters, category: parseCategoryFilterValue(value) });
                }}
                allLabel="Todas"
            >
                {categories.map((category) => (
                    <SelectGroup key={category.id}>
                        <SelectItem value={`category:${category.id}`} className="font-semibold">
                            {category.name}
                        </SelectItem>
                        {category.subCategories.map((sub) => (
                            <SelectItem key={sub.id} value={`subCategory:${sub.id}`} className="pl-6">
                                {sub.name}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                ))}
            </FilterSelect>
            <FilterSelect
                label="Tag"
                width="w-30"
                value={filters.tagId ?? ''}
                onChange={(value) => {
                    onChange({ ...filters, tagId: value === '' ? null : value });
                }}
                allLabel="Todas"
            >
                {tags.map((tag) => (
                    <SelectItem key={tag.id} value={tag.id}>
                        {tag.name}
                    </SelectItem>
                ))}
            </FilterSelect>
            <FilterSelect
                label="Situação"
                width="w-30"
                value={filters.situation ?? ''}
                onChange={(value) => {
                    onChange({ ...filters, situation: TRANSACTION_SITUATIONS.find((situation) => situation === value) ?? null });
                }}
                allLabel="Todas"
            >
                {TRANSACTION_SITUATIONS.map((situation) => (
                    <SelectItem key={situation} value={situation}>
                        {formatTransactionSituation(situation)}
                    </SelectItem>
                ))}
            </FilterSelect>
            <p aria-live="polite" className="ml-auto pb-2 text-muted">
                {summary === null ? (
                    'Carregando…'
                ) : result === undefined ? (
                    count
                ) : (
                    <>
                        {count} · resultado <span className="font-semibold text-ink tabular-nums">{result}</span>
                    </>
                )}
            </p>
        </div>
    );
}

/**
 * Um filtro de escolha da barra, com "Todos/Todas" no topo.
 *
 * @param props.label Rótulo acima do campo.
 * @param props.width Largura mínima, a do mockup.
 * @param props.value Valor escolhido; vazio para "Todos".
 * @param props.onChange Recebe o valor; vazio para "Todos".
 * @param props.allLabel "Todos" ou "Todas", conforme o gênero do rótulo.
 * @param props.children As opções.
 * @return O filtro.
 */
function FilterSelect({
    label,
    width,
    value,
    onChange,
    allLabel,
    children,
}: {
    readonly label: string;
    readonly width: string;
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly allLabel: string;
    readonly children: ReactNode;
}): ReactNode {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-12 text-muted">{label}</span>
            <Select
                value={value === '' ? ALL : value}
                onValueChange={(next) => {
                    onChange(next === ALL ? '' : next);
                }}
            >
                <SelectTrigger aria-label={label} className={`${width} bg-surface`}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={ALL}>{allLabel}</SelectItem>
                    {children}
                </SelectContent>
            </Select>
        </label>
    );
}

/**
 * O que a tabela diz quando não tem linhas: o mês sem lançamento convida a lançar; o filtro que
 * escondeu tudo oferece limpar os filtros.
 *
 * @param props.table Tabela filtrada.
 * @param props.period Mês de referência.
 * @param props.monthHasTransactions Se o mês tem lançamentos antes dos filtros.
 * @param props.onNew Abre o lançamento novo.
 * @param props.onClear Limpa os filtros.
 * @return O estado vazio.
 */
function EmptyTable({
    table,
    period,
    monthHasTransactions,
    onNew,
    onClear,
}: {
    readonly table: TransactionTable;
    readonly period: string;
    readonly monthHasTransactions: boolean;
    readonly onNew: () => void;
    readonly onClear: () => void;
}): ReactNode {
    if (table.rows.length > 0) {
        return null;
    }
    return monthHasTransactions ? (
        <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <p className="text-muted">Nenhum lançamento com esses filtros.</p>
            <Button variant="outline" onClick={onClear}>
                Limpar filtros
            </Button>
        </div>
    ) : (
        <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <p className="text-muted">Nenhum lançamento em {formatMonthShort(period)}.</p>
            <Button onClick={onNew}>+ Lançamento</Button>
        </div>
    );
}

/**
 * @return O esqueleto da tabela enquanto o mês carrega.
 */
function TableSkeleton(): ReactNode {
    return (
        <div role="status" aria-busy="true" aria-label="Carregando lançamentos" className="flex flex-col gap-2 p-4">
            <Skeleton className="h-6" />
            <Skeleton className="h-6" />
            <Skeleton className="h-6" />
            <Skeleton className="h-6" />
        </div>
    );
}
