import { compareTransactionRows, type TransactionSortKey, type TransactionTableRow } from '@finance/client';
import { createColumnHelper, createSortedRowModel, rowSortingFeature, tableFeatures, useTable, type SortFn, type SortingState } from '@tanstack/react-table';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { StatusTag } from '@/registry/registryUi';

/*
 * Tabela densa de Transações (mockup `DesktopTransacoes`; desktop-mvp-plan Fase 9). A TanStack
 * Table cuida do estado da ordenação; a marcação, o teclado e a acessibilidade são daqui. As
 * comparações de cada coluna são as do `client` (`compareTransactionRows`), para que o celular
 * ordene igual.
 */

/** Recursos da tabela: só a ordenação no cliente — os filtros já vieram aplicados pelo view-model. */
const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });

const helper = createColumnHelper<typeof features, TransactionTableRow>();

/**
 * @param key Coluna da ordenação.
 * @return O comparador crescente da coluna no formato da TanStack Table, que inverte sozinha
 * para a ordem decrescente.
 */
function sortBy(key: TransactionSortKey): SortFn<typeof features, TransactionTableRow> {
    const compare = compareTransactionRows(key);
    return (a, b) => compare(a.original, b.original);
}

/** Colunas do mockup, menos a seleção em lote (fora do MVP); "Rec." mostra "3/12" ou "Fixa". */
const columns = helper.columns([
    helper.accessor((row) => row.dueDate, { id: 'date', sortFn: sortBy('date') }),
    helper.accessor((row) => row.name, { id: 'name', sortFn: sortBy('name') }),
    helper.accessor((row) => row.category, { id: 'category', sortFn: sortBy('category') }),
    helper.accessor((row) => row.container, { id: 'container', sortFn: sortBy('container') }),
    helper.accessor((row) => row.amount.amount, { id: 'amount', sortFn: sortBy('amount') }),
    helper.accessor((row) => row.situation, { id: 'situation', sortFn: sortBy('situation') }),
    helper.display({ id: 'recurring', enableSorting: false }),
]);

/** Cabeçalho e largura de cada coluna, nas proporções da grade do mockup. */
const COLUMN_LAYOUT: Readonly<Record<string, { readonly label: string; readonly className: string }>> = {
    date: { label: 'Data', className: 'w-18 pl-4' },
    name: { label: 'Nome', className: 'w-[24%]' },
    category: { label: 'Categoria › Sub', className: 'w-[20%]' },
    container: { label: 'Conta / fatura', className: 'w-[17%]' },
    amount: { label: 'Valor', className: 'w-[14%] text-right' },
    situation: { label: 'Situação', className: 'w-22' },
    recurring: { label: 'Rec.', className: 'w-12 pr-4' },
};

/** Ordem inicial: pela data, como o mockup ("Data ↓"). */
const INITIAL_SORTING: SortingState = [{ id: 'date', desc: false }];

/** O que a tabela faz com as linhas: a tela é dona do estado e dos diálogos. */
export interface TransactionGridProps {
    readonly rows: readonly TransactionTableRow[];
    /** Linha selecionada pelo teclado ou pelo clique. */
    readonly selectedId: string | null;
    /** Lançamento aberto na coluna de edição, marcado como no mockup. */
    readonly editingId: string | null;
    /** O que mostrar sem linhas (mês vazio ou filtro sem resultado). */
    readonly empty: ReactNode;
    readonly onSelect: (id: string) => void;
    /** Abre a edição do lançamento, ou a fatura na linha da fatura. */
    readonly onEdit: (row: TransactionTableRow) => void;
    readonly onTogglePaid: (row: TransactionTableRow) => void;
    readonly onDelete: (row: TransactionTableRow) => void;
}

/**
 * A tabela com ordenação por coluna, navegação pelo teclado e menu de contexto.
 * Teclado (desktop-mvp-plan Fase 9): `↑↓` navegam, `Enter` edita, `P` marca ou desmarca o
 * pagamento, `Del` exclui; o botão direito abre as mesmas ações. A linha selecionada é a única
 * que entra no `Tab` (*roving tabindex*), para que atravessar a tela não exija passar por
 * centenas de linhas. Na linha da fatura (tabela agrupada), `Enter` e o clique abrem a fatura.
 *
 * @param props As linhas, a seleção e as ações.
 * @return A tabela.
 */
export function TransactionGrid({ rows, selectedId, editingId, empty, onSelect, onEdit, onTogglePaid, onDelete }: TransactionGridProps): ReactNode {
    const [sorting, setSorting] = useState<SortingState>(INITIAL_SORTING);
    // O primeiro clique é sempre crescente, inclusive no valor (a TanStack começaria os números
    // pelo maior); e a ordenação nunca é removida, porque a tabela sem ordem não tem sentido.
    const table = useTable({ features, columns, data: rows, state: { sorting }, onSortingChange: setSorting, enableSortingRemoval: false, sortDescFirst: false, getRowId: (row) => row.id });
    const visible = table.getRowModel().rows.map((row) => row.original);
    const rowElements = useRef(new Map<string, HTMLTableRowElement>());
    const selected = visible.find((row) => row.id === selectedId) ?? null;
    const focusable = selected ?? visible[0] ?? null;

    /**
     * @param row Linha a selecionar e focar, depois de `↑↓`.
     */
    const moveTo = (row: TransactionTableRow): void => {
        onSelect(row.id);
        rowElements.current.get(row.id)?.focus();
    };

    /**
     * Atalhos da tabela; valem com o foco numa linha, sem modificador (que é do sistema).
     *
     * @param event Tecla no corpo da tabela.
     */
    const onKeyDown = (event: KeyboardEvent<HTMLTableSectionElement>): void => {
        if (event.ctrlKey || event.altKey || event.metaKey || focusable === null) {
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
                onEdit(current);
                return;
            case 'p':
            case 'P':
                if (!event.repeat) {
                    event.preventDefault();
                    onTogglePaid(current);
                }
                return;
            case 'Delete':
                event.preventDefault();
                onDelete(current);
                return;
        }
    };

    return (
        <>
            <Table className="table-fixed text-13">
                <TableHeader className="bg-surface2">
                    <TableRow className="border-line hover:bg-transparent">
                        {table.getHeaderGroups()[0]?.headers.map((header) => {
                            const layout = COLUMN_LAYOUT[header.column.id] ?? { label: header.column.id, className: '' };
                            const direction = header.column.getIsSorted();
                            return (
                                <TableHead
                                    key={header.id}
                                    aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : undefined}
                                    className={cn('h-auto py-2.5 text-12 font-normal text-muted', layout.className)}
                                >
                                    {header.column.getCanSort() ? (
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
                                    <TableCell colSpan={columns.length}>{empty}</TableCell>
                                </TableRow>
                            ) : (
                                visible.map((row) => (
                                    <GridRow
                                        key={row.id}
                                        row={row}
                                        selected={row.id === selectedId}
                                        editing={row.id === editingId}
                                        focusable={row === focusable}
                                        register={(element) => {
                                            if (element === null) {
                                                rowElements.current.delete(row.id);
                                            } else {
                                                rowElements.current.set(row.id, element);
                                            }
                                        }}
                                        onSelect={() => {
                                            onSelect(row.id);
                                        }}
                                        onEdit={() => {
                                            onEdit(row);
                                        }}
                                    />
                                ))
                            )}
                        </TableBody>
                    </ContextMenuTrigger>
                    {selected?.kind === 'invoice' && (
                        <ContextMenuContent>
                            <ContextMenuItem
                                onSelect={() => {
                                    onEdit(selected);
                                }}
                            >
                                Abrir fatura
                                <ContextMenuShortcut>Enter</ContextMenuShortcut>
                            </ContextMenuItem>
                        </ContextMenuContent>
                    )}
                    {selected?.kind === 'transaction' && (
                        <ContextMenuContent>
                            <ContextMenuItem
                                onSelect={() => {
                                    onEdit(selected);
                                }}
                            >
                                Editar
                                <ContextMenuShortcut>Enter</ContextMenuShortcut>
                            </ContextMenuItem>
                            <ContextMenuItem
                                disabled={selected.transaction.container.kind === 'invoice' && !selected.invoicePayment}
                                onSelect={() => {
                                    onTogglePaid(selected);
                                }}
                            >
                                {selected.transaction.paid ? 'Marcar como pendente' : 'Marcar como pago'}
                                <ContextMenuShortcut>P</ContextMenuShortcut>
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                                variant="destructive"
                                onSelect={() => {
                                    onDelete(selected);
                                }}
                            >
                                Excluir…
                                <ContextMenuShortcut>Del</ContextMenuShortcut>
                            </ContextMenuItem>
                        </ContextMenuContent>
                    )}
                </ContextMenu>
            </Table>
            <p className="flex flex-wrap gap-4 border-t border-line bg-surface2 px-4 py-2.5 text-12 text-muted">
                <span>↑↓ navegar</span>
                <span>Enter editar</span>
                <span>P marcar pago</span>
                <span>Del excluir</span>
                <span>Botão direito: mais ações</span>
            </p>
        </>
    );
}

/**
 * Uma linha da tabela. Entrada e saída se leem pelo sinal, pelo `⇄` da transferência e pela
 * etiqueta de estorno, não só pela cor (decisão de interface 7); os números são tabulares e
 * alinhados à direita (decisão 8).
 *
 * @param props.row Linha montada pelo view-model: um lançamento ou, na tabela agrupada, uma fatura.
 * @param props.selected Se é a linha selecionada.
 * @param props.editing Se é o lançamento aberto na coluna de edição.
 * @param props.focusable Se é a linha que entra no `Tab`.
 * @param props.register Guarda o elemento da linha, para a navegação focá-lo.
 * @param props.onSelect Seleciona a linha (foco ou botão direito).
 * @param props.onEdit Abre a edição (clique).
 * @return A linha.
 */
function GridRow({
    row,
    selected,
    editing,
    focusable,
    register,
    onSelect,
    onEdit,
}: {
    readonly row: TransactionTableRow;
    readonly selected: boolean;
    readonly editing: boolean;
    readonly focusable: boolean;
    readonly register: (element: HTMLTableRowElement | null) => void;
    readonly onSelect: () => void;
    readonly onEdit: () => void;
}): ReactNode {
    return (
        <TableRow
            ref={register}
            tabIndex={focusable ? 0 : -1}
            aria-selected={selected}
            data-state={editing ? 'selected' : undefined}
            className={cn('cursor-pointer border-line2 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset', (selected || editing) && 'bg-soft hover:bg-soft')}
            onFocus={onSelect}
            onContextMenu={onSelect}
            onClick={onEdit}
        >
            <TableCell className="pl-4 tabular-nums">{row.date}</TableCell>
            <TableCell className="truncate">
                <span className={cn(editing && 'font-semibold')}>{row.name}</span>
                {row.kind === 'transaction' && row.refund && (
                    <span className="ml-1.5">
                        <StatusTag tone="neutral">estorno</StatusTag>
                    </span>
                )}
            </TableCell>
            <TableCell className="truncate text-ink2">{row.category}</TableCell>
            <TableCell className="truncate">{row.container}</TableCell>
            <TableCell className={cn('text-right font-semibold tabular-nums', row.direction === 'out' ? 'text-out' : row.direction === 'in' ? 'text-in' : 'text-ink2')}>{row.amountText}</TableCell>
            <TableCell className={situationClass(row)}>{row.situationText}</TableCell>
            <TableCell className="pr-4 text-muted tabular-nums">{row.recurrenceTag}</TableCell>
        </TableRow>
    );
}

/**
 * Cor da situação. O que ainda vai sair da conta — o pendente e a fatura em aberto — fica em
 * destaque; a compra numa fatura em aberto fica apagada, porque quem pesa é a fatura, não ela.
 *
 * @param row Linha da tabela.
 * @return A classe da célula, ou `undefined` sem destaque.
 */
function situationClass(row: TransactionTableRow): string | undefined {
    if (row.situation === 'pending' || (row.kind === 'invoice' && row.situation === 'onInvoice')) {
        return 'text-warn-ink';
    }
    return row.situation === 'onInvoice' ? 'text-muted' : undefined;
}
