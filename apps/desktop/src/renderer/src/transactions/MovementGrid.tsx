import { compareMovementRows, type MovementColumn, type MovementRow, type MovementSortKey } from '@finance/client';
import { createColumnHelper, createSortedRowModel, rowSortingFeature, tableFeatures, useTable, type SortFn, type SortingState } from '@tanstack/react-table';
import { Link } from '@tanstack/react-router';
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from '@/components/ui/context-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { StatusTag } from '@/registry/registryUi';
import type { TransactionActions } from './useTransactionActions.tsx';

/*
 * Listagem de movimentos (desktop-mvp-plan Fase 13.2): a mesma tabela em Transações, no extrato de
 * Contas e na fatura de Cartões, com o mesmo teclado, o mesmo menu e a mesma ordenação. Nasceu da
 * tabela densa de Transações (mockup `DesktopTransacoes`, Fase 9). A TanStack Table cuida do
 * estado da ordenação; a marcação, o teclado e a acessibilidade são daqui. As comparações são as
 * do `client` (`compareMovementRows`), para que o celular ordene igual.
 */

/** Recursos da tabela: só a ordenação no cliente — os filtros já vieram aplicados pelo view-model. */
const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });

const helper = createColumnHelper<typeof features, MovementRow>();

/**
 * @param key Coluna da ordenação.
 * @return O comparador crescente da coluna no formato da TanStack Table, que inverte sozinha
 * para a ordem decrescente.
 */
function sortBy(key: MovementSortKey): SortFn<typeof features, MovementRow> {
    const compare = compareMovementRows(key);
    return (a, b) => compare(a.original, b.original);
}

/** Todas as colunas, na ordem da tela; cada tela escolhe as suas. */
const ALL_COLUMNS = helper.columns([
    helper.accessor((row) => row.sortDate, { id: 'date', sortFn: sortBy('date') }),
    helper.accessor((row) => row.name, { id: 'name', sortFn: sortBy('name') }),
    helper.accessor((row) => row.category, { id: 'category', sortFn: sortBy('category') }),
    helper.accessor((row) => row.container, { id: 'container', sortFn: sortBy('container') }),
    helper.accessor((row) => row.amount, { id: 'amount', sortFn: sortBy('amount') }),
    helper.accessor((row) => row.situation?.rank ?? null, { id: 'situation', sortFn: sortBy('situation') }),
    helper.display({ id: 'recurring', enableSorting: false }),
    helper.display({ id: 'actions', enableSorting: false }),
]);

/** Cabeçalho e largura de cada coluna, nas proporções da grade do mockup. */
const COLUMN_LAYOUT: Readonly<Record<MovementColumn | 'actions', { readonly label: string; readonly className: string }>> = {
    date: { label: 'Data', className: 'w-18 pl-4' },
    name: { label: 'Nome', className: '' },
    category: { label: 'Categoria › Sub', className: 'w-[22%]' },
    container: { label: 'Conta / fatura', className: 'w-[17%]' },
    amount: { label: 'Valor', className: 'w-[14%] text-right' },
    situation: { label: 'Situação', className: 'w-26' },
    recurring: { label: 'Rec.', className: 'w-12' },
    actions: { label: 'Ações', className: 'w-12 pr-4' },
};

/** Ordem inicial: pela data, como o mockup ("Data ↓"). */
const INITIAL_SORTING: SortingState = [{ id: 'date', desc: false }];

/** O que a listagem mostra e faz com as linhas. */
export interface MovementGridProps {
    readonly rows: readonly MovementRow[];
    /** Colunas da tela: o "Conta / fatura" só faz sentido onde a lista mistura contas e cartões. */
    readonly columns: readonly MovementColumn[];
    readonly actions: TransactionActions;
    /** Nome acessível da tabela. */
    readonly label: string;
    /** O que mostrar sem linhas. */
    readonly empty: ReactNode;
    /** Linha selecionada, quando a tela a controla (para selecionar o lançamento gravado). */
    readonly selectedId?: string | null | undefined;
    readonly onSelect?: ((id: string) => void) | undefined;
    /** Linha de total no rodapé, alinhada à coluna do valor (a fatura). */
    readonly total?: { readonly label: string; readonly amountText: string } | undefined;
}

/**
 * A listagem com ordenação por coluna, navegação pelo teclado, menu de contexto e o "⋯".
 * Teclado (desktop-mvp-plan Fase 9): `↑↓` navegam, `Enter` abre, `P` marca ou desmarca o
 * pagamento, `Del` exclui; o botão direito e o "⋯" têm as mesmas ações, para quem usa o mouse. A
 * linha selecionada é a única que entra no `Tab` (*roving tabindex*), para que atravessar a tela
 * não exija passar por centenas de linhas. Na linha da fatura, `Enter` e o clique abrem a fatura.
 * A situação "Pendente"/"Pago" é um botão que alterna o pagamento — o atalho de mouse do `P`. O
 * cabeçalho fica fixo no topo da tela ao rolar (desktop-mvp-plan Fase 13.3), para que as colunas e
 * a ordenação continuem à vista numa lista longa; por isso a seção em volta recorta as bordas com
 * `overflow-clip`, e não `overflow-hidden`, que criaria um contêiner de rolagem e prenderia o
 * cabeçalho nele.
 *
 * @param props As linhas, as colunas e as ações.
 * @return A tabela.
 */
export function MovementGrid({ rows, columns, actions, label, empty, selectedId: controlled, onSelect, total }: MovementGridProps): ReactNode {
    const [sorting, setSorting] = useState<SortingState>(INITIAL_SORTING);
    const [ownSelection, setOwnSelection] = useState<string | null>(null);
    const selectedId = controlled === undefined ? ownSelection : controlled;
    /**
     * @param id Linha selecionada pelo foco, pelo clique ou pelo botão direito; a tela que controla
     * a seleção também fica sabendo.
     */
    const select = (id: string): void => {
        setOwnSelection(id);
        onSelect?.(id);
    };
    const visibleColumns = useMemo(() => ALL_COLUMNS.filter((column) => column.id === 'actions' || columns.some((id) => id === column.id)), [columns]);
    // O primeiro clique é sempre crescente, inclusive no valor (a TanStack começaria os números
    // pelo maior); e a ordenação nunca é removida, porque a tabela sem ordem não tem sentido.
    const table = useTable({ features, columns: visibleColumns, data: rows, state: { sorting }, onSortingChange: setSorting, enableSortingRemoval: false, sortDescFirst: false, getRowId: (row) => row.id });
    const visible = table.getRowModel().rows.map((row) => row.original);
    const rowElements = useRef(new Map<string, HTMLTableRowElement>());
    const selected = visible.find((row) => row.id === selectedId) ?? null;
    const focusable = selected ?? visible[0] ?? null;

    /**
     * @param row Linha a selecionar e focar, depois de `↑↓`.
     */
    const moveTo = (row: MovementRow): void => {
        select(row.id);
        rowElements.current.get(row.id)?.focus();
    };

    /**
     * Atalhos da tabela; valem com o foco numa linha, sem modificador (que é do sistema). O foco
     * num botão da linha (a situação, o "⋯") é do botão.
     *
     * @param event Tecla no corpo da tabela.
     */
    const onKeyDown = (event: KeyboardEvent<HTMLTableSectionElement>): void => {
        if (event.ctrlKey || event.altKey || event.metaKey || focusable === null || !(event.target instanceof HTMLTableRowElement)) {
            return;
        }
        const current = selected ?? focusable;
        const index = visible.indexOf(current);
        switch (event.key) {
            case 'ArrowDown':
            case 'ArrowUp': {
                event.preventDefault();
                const next = visible[event.key === 'ArrowDown' ? Math.min(index + 1, visible.length - 1) : Math.max(index - 1, 0)];
                if (next !== undefined) {
                    moveTo(next);
                }
                return;
            }
            case 'Enter':
                event.preventDefault();
                actions.open(current.target);
                return;
            case 'p':
            case 'P':
                if (!event.repeat) {
                    event.preventDefault();
                    actions.togglePaid(current.target, current.name);
                }
                return;
            case 'Delete':
                event.preventDefault();
                actions.remove(current.target);
                return;
        }
    };

    return (
        <>
            {/* Sem a rolagem horizontal do contêiner (a tabela é de largura fixa): um contêiner que
                rola prenderia o cabeçalho fixo nele, e não no topo da tela. */}
            <Table aria-label={label} className="table-fixed text-13" containerClassName="overflow-visible">
                <TableHeader className="bg-surface2">
                    <TableRow className="border-line hover:bg-transparent">
                        {table.getHeaderGroups()[0]?.headers.map((header) => {
                            const layout = COLUMN_LAYOUT[columnId(header.column.id)];
                            const direction = header.column.getIsSorted();
                            return (
                                <TableHead
                                    key={header.id}
                                    aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : undefined}
                                    // Cabeçalho fixo no topo da tela ao rolar a lista; a sombra faz a
                                    // vez da borda, que a célula fixa não leva consigo.
                                    className={cn('sticky top-0 z-10 h-auto bg-surface2 py-2.5 text-12 font-normal text-muted shadow-[inset_0_-1px_0_var(--color-line)]', layout.className)}
                                >
                                    {header.column.id === 'actions' ? (
                                        <span className="sr-only">{layout.label}</span>
                                    ) : header.column.getCanSort() ? (
                                        <button type="button" className="inline-flex items-center gap-1 hover:text-ink" onClick={header.column.getToggleSortingHandler()}>
                                            {layout.label}
                                            <span aria-hidden="true">{direction === 'asc' ? '↓' : direction === 'desc' ? '↑' : ''}</span>
                                        </button>
                                    ) : (
                                        layout.label
                                    )}
                                </TableHead>
                            );
                        })}
                    </TableRow>
                </TableHeader>
                <ContextMenu>
                    <ContextMenuTrigger asChild disabled={visible.length === 0}>
                        <TableBody onKeyDown={onKeyDown}>
                            {visible.length === 0 ? (
                                <TableRow className="hover:bg-transparent">
                                    <TableCell colSpan={visibleColumns.length}>{empty}</TableCell>
                                </TableRow>
                            ) : (
                                visible.map((row) => (
                                    <GridRow
                                        key={row.id}
                                        row={row}
                                        columns={columns}
                                        actions={actions}
                                        selected={row.id === selectedId}
                                        editing={row.target.kind === 'transaction' && row.target.transaction.id === actions.editingId}
                                        focusable={row === focusable}
                                        register={(element) => {
                                            if (element === null) {
                                                rowElements.current.delete(row.id);
                                            } else {
                                                rowElements.current.set(row.id, element);
                                            }
                                        }}
                                        onSelect={() => {
                                            select(row.id);
                                        }}
                                    />
                                ))
                            )}
                        </TableBody>
                    </ContextMenuTrigger>
                    {selected !== null && <RowContextMenu row={selected} actions={actions} />}
                </ContextMenu>
                {total !== undefined && (
                    <TableFooter className="bg-surface2">
                        <TableRow className="border-line hover:bg-transparent">
                            {visibleColumns.map((column) => (
                                <TableCell key={column.id} className={cn(column.id === 'amount' && 'text-right tabular-nums', 'font-semibold')}>
                                    {column.id === 'name' ? total.label : column.id === 'amount' ? total.amountText : null}
                                </TableCell>
                            ))}
                        </TableRow>
                    </TableFooter>
                )}
            </Table>
            <p className="flex flex-wrap gap-4 border-t border-line bg-surface2 px-4 py-2.5 text-12 text-muted">
                <span>↑↓ navegar</span>
                <span>Enter editar</span>
                <span>P marcar pago</span>
                <span>Del excluir</span>
                <span>Botão direito ou ⋯: mais ações</span>
            </p>
        </>
    );
}

/**
 * @param id Id da coluna na TanStack Table.
 * @return O id como coluna conhecida; as colunas são só as de `ALL_COLUMNS`.
 */
function columnId(id: string): MovementColumn | 'actions' {
    switch (id) {
        case 'date':
        case 'name':
        case 'category':
        case 'container':
        case 'amount':
        case 'situation':
        case 'recurring':
        case 'actions':
            return id;
        default:
            throw new Error(`coluna desconhecida na listagem: ${id}`);
    }
}

/**
 * Menu do botão direito: as ações da linha, as mesmas do teclado e do "⋯".
 *
 * @param props.row Linha selecionada.
 * @param props.actions Ações da tela.
 * @return O conteúdo do menu.
 */
function RowContextMenu({ row, actions }: { readonly row: MovementRow; readonly actions: TransactionActions }): ReactNode {
    const { target } = row;
    if (target.kind === 'invoice') {
        return (
            <ContextMenuContent>
                <ContextMenuItem
                    onSelect={() => {
                        actions.open(target);
                    }}
                >
                    Abrir fatura
                    <ContextMenuShortcut>Enter</ContextMenuShortcut>
                </ContextMenuItem>
            </ContextMenuContent>
        );
    }
    return (
        <ContextMenuContent>
            <ContextMenuItem
                onSelect={() => {
                    actions.open(target);
                }}
            >
                Editar
                <ContextMenuShortcut>Enter</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
                disabled={!target.payable}
                onSelect={() => {
                    actions.togglePaid(target, row.name);
                }}
            >
                {target.transaction.paid ? 'Marcar como pendente' : 'Marcar como pago'}
                <ContextMenuShortcut>P</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
                variant="destructive"
                onSelect={() => {
                    actions.remove(target);
                }}
            >
                Excluir…
                <ContextMenuShortcut>Del</ContextMenuShortcut>
            </ContextMenuItem>
        </ContextMenuContent>
    );
}

/**
 * Uma linha da listagem. Entrada e saída se leem pelo sinal, pelo `⇄` da transferência e pela
 * etiqueta de estorno, não só pela cor (decisão de interface 7); os números são tabulares e
 * alinhados à direita (decisão 8).
 *
 * @param props.row Linha montada pelo view-model.
 * @param props.columns Colunas da tela.
 * @param props.actions Ações da tela, para o clique, a situação e o "⋯".
 * @param props.selected Se é a linha selecionada.
 * @param props.editing Se é o lançamento aberto na edição.
 * @param props.focusable Se é a linha que entra no `Tab`.
 * @param props.register Guarda o elemento da linha, para a navegação focá-lo.
 * @param props.onSelect Seleciona a linha (foco ou botão direito).
 * @return A linha.
 */
function GridRow({
    row,
    columns,
    actions,
    selected,
    editing,
    focusable,
    register,
    onSelect,
}: {
    readonly row: MovementRow;
    readonly columns: readonly MovementColumn[];
    readonly actions: TransactionActions;
    readonly selected: boolean;
    readonly editing: boolean;
    readonly focusable: boolean;
    readonly register: (element: HTMLTableRowElement | null) => void;
    readonly onSelect: () => void;
}): ReactNode {
    /**
     * @param column Coluna da listagem.
     * @return Se a tela mostra a coluna.
     */
    const shown = (column: MovementColumn): boolean => columns.includes(column);
    return (
        <TableRow
            ref={register}
            tabIndex={focusable ? 0 : -1}
            aria-selected={selected}
            data-state={editing ? 'selected' : undefined}
            className={cn(
                'cursor-pointer border-line2 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
                row.muted && 'text-ink2',
                (selected || editing) && 'bg-soft hover:bg-soft',
            )}
            onFocus={(event) => {
                if (event.target === event.currentTarget) {
                    onSelect();
                }
            }}
            onContextMenu={onSelect}
            onClick={() => {
                onSelect();
                actions.open(row.target);
            }}
        >
            {shown('date') && <TableCell className="pl-4 tabular-nums">{row.date}</TableCell>}
            {shown('name') && (
                <TableCell className="whitespace-normal">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className={cn(editing && 'font-semibold')}>{row.name}</span>
                        {row.badges.map((badge) => (
                            <StatusTag key={badge} tone="neutral">
                                {badge}
                            </StatusTag>
                        ))}
                        {row.detail !== null && <span className="text-12 text-muted">{row.detail}</span>}
                        {row.invoiceLink !== null && (
                            <Link
                                to="/cards"
                                search={{ card: row.invoiceLink.creditCardId, invoice: row.invoiceLink.period }}
                                className="text-12 text-accent hover:text-soft-ink"
                                onClick={(event) => {
                                    // O link leva à fatura; não abre a edição da linha por baixo dele.
                                    event.stopPropagation();
                                }}
                            >
                                ver fatura
                            </Link>
                        )}
                    </span>
                </TableCell>
            )}
            {shown('category') && <TableCell className="truncate text-ink2">{row.category}</TableCell>}
            {shown('container') && <TableCell className="truncate">{row.container}</TableCell>}
            {shown('amount') && (
                <TableCell className={cn('text-right font-semibold tabular-nums', row.tone === 'out' ? 'text-out' : row.tone === 'in' ? 'text-in' : row.muted ? 'text-ink2' : 'text-ink')}>{row.amountText}</TableCell>
            )}
            {shown('situation') && (
                <TableCell>
                    <Situation row={row} actions={actions} />
                </TableCell>
            )}
            {shown('recurring') && <TableCell className="text-muted tabular-nums">{row.recurrenceTag}</TableCell>}
            <TableCell
                className="pr-4 text-right"
                onClick={(event) => {
                    // O menu não abre a edição da linha por baixo dele.
                    event.stopPropagation();
                }}
            >
                <RowMenu row={row} actions={actions} />
            </TableCell>
        </TableRow>
    );
}

/**
 * A situação da linha. Onde marcar pago vale, ela é um botão que alterna o pagamento com a data de
 * hoje — o atalho de mouse do `P` (desktop-mvp-plan Fase 13.2). O que ainda vai sair da conta — o
 * pendente e a fatura em aberto — fica em destaque; a compra numa fatura em aberto fica apagada,
 * porque quem pesa é a fatura, não ela.
 *
 * @param props.row Linha da listagem.
 * @param props.actions Ações da tela.
 * @return O texto da situação, ou o botão que a alterna.
 */
function Situation({ row, actions }: { readonly row: MovementRow; readonly actions: TransactionActions }): ReactNode {
    const { situation, target } = row;
    if (situation === null) {
        return null;
    }
    const tone = cn(situation.tone === 'warn' && 'text-warn-ink', situation.tone === 'muted' && 'text-muted');
    if (target.kind !== 'transaction' || !target.payable) {
        return <span className={tone}>{situation.text}</span>;
    }
    return (
        <button
            type="button"
            // Fora do `Tab`, como o "⋯": pelo teclado, o `P` na linha faz o mesmo.
            tabIndex={-1}
            title={target.transaction.paid ? 'Voltar a pendente (P)' : 'Marcar como pago hoje (P)'}
            aria-label={target.transaction.paid ? `${situation.text}: voltar “${row.name}” a pendente` : `${situation.text}: marcar “${row.name}” como pago`}
            className={cn('-mx-1.5 rounded-4 px-1.5 py-0.5 hover:bg-surface2 hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none', tone)}
            onClick={(event) => {
                // Alterna o pagamento sem abrir a edição da linha.
                event.stopPropagation();
                actions.togglePaid(target, row.name);
            }}
        >
            {situation.text}
        </button>
    );
}

/**
 * O "⋯" da linha: as ações do menu de contexto, para quem não usa o teclado nem o botão direito.
 *
 * @param props.row Linha da listagem.
 * @param props.actions Ações da tela.
 * @return O botão com o menu.
 */
function RowMenu({ row, actions }: { readonly row: MovementRow; readonly actions: TransactionActions }): ReactNode {
    const { target } = row;
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" tabIndex={-1} aria-label={`Ações de ${row.name}`}>
                    ⋯
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {target.kind === 'invoice' ? (
                    <DropdownMenuItem
                        onSelect={() => {
                            actions.open(target);
                        }}
                    >
                        Abrir fatura
                        <DropdownMenuShortcut>Enter</DropdownMenuShortcut>
                    </DropdownMenuItem>
                ) : (
                    <>
                        <DropdownMenuItem
                            onSelect={() => {
                                actions.open(target);
                            }}
                        >
                            Editar
                            <DropdownMenuShortcut>Enter</DropdownMenuShortcut>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            disabled={!target.payable}
                            onSelect={() => {
                                actions.togglePaid(target, row.name);
                            }}
                        >
                            {target.transaction.paid ? 'Marcar como pendente' : 'Marcar como pago'}
                            <DropdownMenuShortcut>P</DropdownMenuShortcut>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => {
                                actions.remove(target);
                            }}
                        >
                            Excluir…
                            <DropdownMenuShortcut>Del</DropdownMenuShortcut>
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
