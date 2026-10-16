import {
    buildTransactionTable,
    formatMonthAbbreviation,
    formatMonthShort,
    formatTransactionSituation,
    movementsFromTransactions,
    TRANSACTION_SITUATIONS,
    useAccounts,
    useCategoryTree,
    useCreditCards,
    useInvoicesByCards,
    useProfileInvoices,
    useRecurrences,
    useTags,
    useTransactions,
    useTransferTargets,
    type MovementColumn,
    type TransactionFilters,
    type TransactionTable,
} from '@finance/client';
import type { AccountInPeriodResponse, CategoryBranchResponse, CoreInput, CreditCardInPeriodResponse, InvoiceResponse, TagResponse, TransactionResponse } from '@finance/core';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Combobox, type ComboboxOption } from '@/components/Combobox';
import { ErrorState, Skeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useActiveProfile } from '@/shell/activeProfile';
import { useTransactionPanel, useTransactionPanelHost } from '@/shell/TransactionPanel';
import { useReferenceMonth } from '@/shell/useReferenceMonth';
import { MovementGrid } from './MovementGrid.tsx';
import { sourceKey } from './transactionForm.ts';
import { useTransactionActions } from './useTransactionActions.tsx';
import {
    categoryFilterValue,
    containerFilterValue,
    filtersFromSearch,
    parseCategoryFilterValue,
    parseContainerFilterValue,
    parseTransactionsSearch,
    withFilters,
} from './transactionsSearch.ts';

/** Colunas da listagem em Transações: o mês inteiro do perfil, com a conta ou o cartão de cada linha. */
const COLUMNS: readonly MovementColumn[] = ['date', 'name', 'category', 'container', 'amount', 'situation', 'recurring'];

/** Valor dos campos de filtro para "Todos/Todas": o `Select` do Radix não aceita valor vazio, e o `Combobox` trata o vazio como "nada escolhido". */
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
    const otherProfileAccounts = useTransferTargets({ profileId: profile.id });
    const creditCards = useCreditCards({ profileId: profile.id, period });
    const categories = useCategoryTree({ profileId: profile.id });
    const tags = useTags({ profileId: profile.id });
    const recurrences = useRecurrences({ profileId: profile.id });
    const invoices = useMonthInvoices(transactions.data);
    const monthInvoices = useProfileInvoices({ profileId: profile.id, period });
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const panel = useTransactionPanel();

    const table = useMemo(
        () =>
            transactions.data === undefined || accounts.data === undefined || otherProfileAccounts.data === undefined || creditCards.data === undefined || categories.data === undefined || monthInvoices.data === undefined
                ? null
                : buildTransactionTable(
                      {
                          profileId: profile.id,
                          transactions: transactions.data,
                          accounts: accounts.data.accounts,
                          otherProfileAccounts: otherProfileAccounts.data,
                          creditCards: creditCards.data.creditCards,
                          categories: categories.data,
                          invoices,
                          recurrences: recurrences.data ?? [],
                          monthInvoices: monthInvoices.data,
                      },
                      filters,
                  ),
        [profile.id, transactions.data, accounts.data, otherProfileAccounts.data, creditCards.data, categories.data, invoices, recurrences.data, monthInvoices.data, filters],
    );
    const rows = useMemo(() => (table === null ? [] : movementsFromTransactions(table.rows, profile.id)), [table, profile.id]);
    const failed = [transactions, accounts, otherProfileAccounts, creditCards, categories, monthInvoices].find((query) => query.error !== null)?.error ?? null;

    /**
     * Lançamento gravado. A compra no cartão não aparece na tabela agrupada, então a tela diz em
     * que fatura ela caiu e oferece abri-la, em vez de parecer que o lançamento sumiu.
     *
     * @param saved Lançamento gravado pelo formulário.
     */
    const onSaved = (saved: TransactionResponse): void => {
        setSelectedId(saved.id);
        const { container } = saved;
        if (table?.grouped === true && container.kind === 'invoice' && saved.destinationAccountId === null) {
            const card = creditCards.data?.creditCards.find((item) => item.id === container.creditCardId)?.name ?? 'do cartão';
            toast.info(`Está na fatura ${card} · ${formatMonthAbbreviation(container.period)}, que aparece aqui no mês em que pesa na conta.`, {
                action: {
                    label: 'Ver fatura',
                    onClick: () => {
                        void navigate({ to: '/cards', search: { card: container.creditCardId, invoice: container.period } });
                    },
                },
            });
        }
    };

    /**
     * @param next Filtros escolhidos; substituem os da URL sem criar entrada no histórico a cada
     * tecla da busca.
     */
    const changeFilters = (next: TransactionFilters): void => {
        void navigate({ to: '/transactions', search: (current: Readonly<Record<string, unknown>>) => withFilters(current, next), replace: true });
    };

    const actions = useTransactionActions({
        onSaved,
        onDeleted: (id) => {
            setSelectedId((current) => (current === id ? null : current));
        },
    });
    const { openNew } = actions;
    const initialSource = initialSourceOf(filters);
    /**
     * Faz o "+ Lançamento" e o `N` abrirem o diálogo desta tela, com a origem do filtro sugerida,
     * em vez do painel genérico do shell. O `useCallback` depende só da origem: o
     * `useTransactionPanelHost` refaz o registro a cada referência nova, e ele precisa mudar
     * apenas quando o filtro muda a sugestão.
     */
    const openHere = useCallback(() => {
        openNew(initialSource);
    }, [openNew, initialSource]);
    useTransactionPanelHost(openHere);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <h1 className="text-24 font-semibold">Transações</h1>
                {/* Entrada da importação (desktop-mvp-plan Fase 13.1; mockup `DesktopTransacoes`). */}
                <Button variant="outline" size="sm" className="border-line text-13 font-normal" asChild>
                    <Link to="/settings/import">Importar arquivo…</Link>
                </Button>
            </div>
            <FilterBar
                filters={filters}
                accounts={accounts.data?.accounts ?? []}
                creditCards={creditCards.data?.creditCards ?? []}
                categories={categories.data ?? []}
                tags={tags.data ?? []}
                summary={table?.summary ?? null}
                onChange={changeFilters}
            />
            {table?.grouped === true && table.rows.some((row) => row.kind === 'invoice') && (
                <p className="text-12 text-muted">As compras no cartão estão na linha de cada fatura, no dia em que ela pesa na conta. Filtre por cartão, categoria, tag ou busca para vê-las uma a uma.</p>
            )}
            <section aria-label="Lançamentos do mês" className="min-w-0 overflow-clip rounded-10 border border-line bg-surface text-13">
                {failed !== null ? (
                    <div className="p-4">
                        <ErrorState error={failed} />
                    </div>
                ) : table === null ? (
                    <TableSkeleton />
                ) : (
                    <MovementGrid
                        rows={rows}
                        columns={COLUMNS}
                        actions={actions}
                        label="Lançamentos"
                        selectedId={selectedId}
                        onSelect={setSelectedId}
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
                    />
                )}
            </section>
            {actions.dialogs}
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
            <FilterCombobox
                label="Conta ou cartão"
                width="w-43"
                value={containerFilterValue(filters.container)}
                onChange={(value) => {
                    onChange({ ...filters, container: parseContainerFilterValue(value) });
                }}
                allLabel="Todos"
                searchLabel="Buscar conta ou cartão"
                emptyText="Nenhuma conta ou cartão encontrado."
                options={[
                    ...accounts.map((account): ComboboxOption => ({ value: `account:${account.id}`, label: account.name, group: 'Contas' })),
                    ...creditCards.map((creditCard): ComboboxOption => ({ value: `creditCard:${creditCard.id}`, label: creditCard.name, group: 'Cartões' })),
                ]}
            />
            <FilterCombobox
                label="Categoria"
                width="w-38"
                value={categoryFilterValue(filters.category)}
                onChange={(value) => {
                    onChange({ ...filters, category: parseCategoryFilterValue(value) });
                }}
                allLabel="Todas"
                searchLabel="Buscar categoria"
                emptyText="Nenhuma categoria encontrada."
                // A categoria filtra todas as suas subcategorias; a subcategoria leva a categoria
                // como prefixo, para que buscar "alimentação" ache as duas coisas.
                options={categories.flatMap((category): ComboboxOption[] => [
                    { value: `category:${category.id}`, label: category.name },
                    ...category.subCategories.map((sub): ComboboxOption => ({ value: `subCategory:${sub.id}`, label: sub.name, prefix: `${category.name} › ` })),
                ])}
            />
            <FilterCombobox
                label="Tag"
                width="w-30"
                value={filters.tagId ?? ''}
                onChange={(value) => {
                    onChange({ ...filters, tagId: value === '' ? null : value });
                }}
                allLabel="Todas"
                searchLabel="Buscar tag"
                emptyText="Nenhuma tag encontrada."
                options={tags.map((tag): ComboboxOption => ({ value: tag.id, label: tag.name }))}
            />
            {/* Lista curta e fixa: fica no `Select`, como o tipo e a moeda nos formulários. */}
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
 * Um filtro de cadastro da barra, com busca como os campos do formulário (desktop-mvp-plan Fase
 * 13.3): contas, categorias e tags crescem com o uso, e rolar um menu para achar uma delas é o
 * mesmo problema que o `Combobox` resolveu no lançamento. "Todos/Todas" fica no topo da lista.
 *
 * @param props.label Rótulo acima do campo, que também nomeia o botão.
 * @param props.width Largura do botão, a do mockup.
 * @param props.value Valor escolhido; vazio para "Todos".
 * @param props.onChange Recebe o valor; vazio para "Todos".
 * @param props.allLabel "Todos" ou "Todas", conforme o gênero do rótulo.
 * @param props.searchLabel Nome do campo de busca da lista.
 * @param props.emptyText Frase da busca sem resultado.
 * @param props.options As opções, sem o "Todos".
 * @return O filtro.
 */
function FilterCombobox({
    label,
    width,
    value,
    onChange,
    allLabel,
    searchLabel,
    emptyText,
    options,
}: {
    readonly label: string;
    readonly width: string;
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly allLabel: string;
    readonly searchLabel: string;
    readonly emptyText: string;
    readonly options: readonly ComboboxOption[];
}): ReactNode {
    const id = useId();
    return (
        <div className="flex flex-col gap-1">
            <label htmlFor={id} className="text-12 text-muted">
                {label}
            </label>
            <div className={width}>
                <Combobox
                    id={id}
                    value={value === '' ? ALL : value}
                    onChange={(next) => {
                        onChange(next === ALL ? '' : next);
                    }}
                    options={[{ value: ALL, label: allLabel }, ...options]}
                    placeholder={allLabel}
                    searchLabel={searchLabel}
                    emptyText={emptyText}
                />
            </div>
        </div>
    );
}

/**
 * Um filtro de lista curta e fixa da barra (a situação), com "Todas" no topo.
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
