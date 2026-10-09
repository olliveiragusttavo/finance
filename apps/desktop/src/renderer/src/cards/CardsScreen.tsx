import {
    buildInvoiceTable,
    buildUpcomingInvoices,
    describeLimitUsage,
    formatDayMonth,
    formatInvoiceAmount,
    formatInvoiceSituation,
    formatMoney,
    formatMonthAbbreviation,
    formatMonthLong,
    formatMonthShort,
    useAccounts,
    useCategoryTree,
    useCreditCards,
    useInvoice,
    useInvoicesByCard,
    useRecurrences,
    type InvoiceLine,
} from '@finance/client';
import type { AccountInPeriodResponse, CreditCardInPeriodResponse, CreditCardListResponse, InvoiceCycleResponse, TransactionResponse } from '@finance/core';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EmptyState, QueryState, Skeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { CreditCardDialog, useToggleCreditCard } from '@/registry/CreditCardsSection';
import { CreditCardDeletionDialog } from '@/registry/DeletionDialog';
import { StatusTag } from '@/registry/registryUi';
import { useActiveProfile } from '@/shell/activeProfile';
import { currentDate } from '@/shell/referenceMonth';
import { useReferenceMonth } from '@/shell/useReferenceMonth';
import { DeleteTransactionDialog } from '@/transactions/DeleteTransactionDialog';
import { TransactionDialog } from '@/transactions/TransactionDialog';
import { openCreditCard, openInvoicePeriod, parseCardsSearch, shouldDropInvoice, type CardsLocation } from './cardsSearch.ts';
import { PartialPaymentDialog, PayInvoiceDialog, ReopenInvoiceDialog, type InvoiceActionTarget } from './InvoiceDialogs.tsx';

/** Diálogo aberto na tela: cadastro do cartão ou ação sobre a fatura. */
type CardsDialogState =
    | { readonly mode: 'create' }
    | { readonly mode: 'edit'; readonly creditCard: CreditCardInPeriodResponse }
    | { readonly mode: 'delete'; readonly creditCard: CreditCardInPeriodResponse }
    | { readonly mode: 'pay'; readonly target: InvoiceActionTarget }
    | { readonly mode: 'partial'; readonly target: InvoiceActionTarget }
    | { readonly mode: 'reopen'; readonly target: InvoiceActionTarget };

/** Ação sobre a fatura que a tela abre num diálogo. */
type InvoiceAction = 'pay' | 'partial' | 'reopen';

/**
 * Cartões (mockup `DesktopCartoes`; desktop-mvp-plan Fase 8): à esquerda a lista com a fatura
 * do mês de cada cartão e os totais, à direita o detalhe da fatura aberta — números, lançamentos
 * e próximas faturas — com pagar, pagamento parcial e reabrir. O cartão e a fatura abertos ficam
 * na URL (`card`, `invoice`), como a conta aberta em Contas.
 *
 * @return A tela de Cartões.
 */
export function CardsScreen(): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const navigate = useNavigate();
    // Lida pelo `parseCardsSearch`, e não pelo tipo da rota, pelo mesmo motivo do
    // `useReferenceMonth`: a tela é importada pelo próprio roteador.
    const search = useSearch({ strict: false, select: (raw: Readonly<Record<string, unknown>>) => parseCardsSearch(raw) });
    const creditCards = useCreditCards({ profileId: profile.id, period });
    const accounts = useAccounts({ profileId: profile.id, period });
    const [dialog, setDialog] = useState<CardsDialogState | null>(null);
    const toggle = useToggleCreditCard();
    const close = (): void => {
        setDialog(null);
    };
    useDropInvoiceOnMonthChange({ period, invoice: search.invoice });
    const accountList = accounts.data?.accounts ?? [];

    return (
        <div className="-mx-8 -my-6 flex flex-1">
            <QueryState query={creditCards} loading={<CardListSkeleton />}>
                {(list) => {
                    const open = openCreditCard(list, search);
                    return (
                        <>
                            <CardList
                                list={list}
                                openId={open?.id ?? null}
                                canCreate={accountList.some((account) => !account.disabled)}
                                onCreate={() => {
                                    setDialog({ mode: 'create' });
                                }}
                            />
                            <section aria-label="Fatura" className="flex min-w-0 flex-1 flex-col gap-5 px-8 py-6">
                                {open === null ? (
                                    <EmptyState title="Nenhum cartão" description="Cadastre um cartão para ver a fatura do mês." />
                                ) : (
                                    <CardInvoice
                                        key={open.id}
                                        creditCard={open}
                                        accounts={accountList}
                                        invoicePeriod={openInvoicePeriod(search, period)}
                                        referencePeriod={period}
                                        onEdit={() => {
                                            setDialog({ mode: 'edit', creditCard: open });
                                        }}
                                        onToggle={() => {
                                            toggle(open);
                                        }}
                                        onDelete={() => {
                                            setDialog({ mode: 'delete', creditCard: open });
                                        }}
                                        onAction={(mode, target) => {
                                            setDialog({ mode, target });
                                        }}
                                    />
                                )}
                            </section>
                        </>
                    );
                }}
            </QueryState>
            {dialog?.mode === 'create' && (
                <CreditCardDialog
                    creditCard={null}
                    accounts={accountList}
                    onClose={close}
                    onCreated={(created) => {
                        void navigate({ to: '/cards', search: { card: created.id } });
                    }}
                />
            )}
            {dialog?.mode === 'edit' && <CreditCardDialog key={dialog.creditCard.id} creditCard={dialog.creditCard} accounts={accountList} onClose={close} />}
            {dialog?.mode === 'delete' && (
                <CreditCardDeletionDialog
                    creditCard={dialog.creditCard}
                    onClose={close}
                    onDisableInstead={
                        dialog.creditCard.disabled
                            ? undefined
                            : () => {
                                  toggle(dialog.creditCard);
                              }
                    }
                />
            )}
            {dialog?.mode === 'pay' && <PayInvoiceDialog target={dialog.target} onClose={close} />}
            {dialog?.mode === 'partial' && <PartialPaymentDialog target={dialog.target} accounts={accountList} onClose={close} />}
            {dialog?.mode === 'reopen' && <ReopenInvoiceDialog target={dialog.target} onClose={close} />}
        </div>
    );
}

/**
 * Tira a fatura pedida da URL quando o usuário troca o mês de referência (`shouldDropInvoice`),
 * para que o detalhe acompanhe a lista. Troca a entrada do histórico em vez de criar outra: a
 * troca do mês já criou a sua.
 *
 * @param current O mês de referência e a fatura da URL neste render.
 */
function useDropInvoiceOnMonthChange(current: CardsLocation): void {
    const navigate = useNavigate();
    const { period, invoice } = current;
    const previous = useRef<CardsLocation>(current);
    useEffect(() => {
        const next = { period, invoice };
        const drop = shouldDropInvoice(previous.current, next);
        previous.current = next;
        if (drop) {
            void navigate({ to: '/cards', search: (search: Readonly<Record<string, unknown>>) => ({ ...search, invoice: undefined }), replace: true });
        }
    }, [period, invoice, navigate]);
}

/**
 * Lista lateral: cada cartão com a fatura do mês e os totais no rodapé.
 * Regra de negócio (Cartões): os totais vêm prontos do núcleo, em módulo — "Em aberto no mês"
 * soma só as faturas do mês ainda não pagas, "Total das faturas" soma todas —, e a tela não
 * refaz a soma.
 *
 * @param props.list Cartões do perfil no mês e os totais.
 * @param props.openId Cartão aberto, marcado na lista.
 * @param props.canCreate Se o perfil tem conta ativa para pagar um cartão novo.
 * @param props.onCreate Abre o diálogo de novo cartão.
 * @return A lista de cartões.
 */
function CardList({
    list,
    openId,
    canCreate,
    onCreate,
}: {
    readonly list: CreditCardListResponse;
    readonly openId: string | null;
    readonly canCreate: boolean;
    readonly onCreate: () => void;
}): ReactNode {
    return (
        <section aria-label="Lista de cartões" className="flex w-95 shrink-0 flex-col border-r border-line bg-surface">
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
                <h1 className="text-20 font-semibold">Cartões</h1>
                <Button variant="outline" size="sm" className="text-13 font-normal" disabled={!canCreate} title={canCreate ? undefined : 'Reative ou crie uma conta para pagar o cartão.'} onClick={onCreate}>
                    + Novo cartão
                </Button>
            </div>
            <div aria-hidden="true" className="flex justify-between px-5 py-2 text-12 text-muted">
                <span>Cartão</span>
                <span>fatura do mês</span>
            </div>
            <ul aria-label="Cartões">
                {list.creditCards.map((creditCard) => (
                    <li key={creditCard.id}>
                        <CardLink creditCard={creditCard} current={creditCard.id === openId} />
                    </li>
                ))}
            </ul>
            <dl className="mt-auto flex flex-col gap-1 border-t border-line px-5 py-3.5 text-13">
                <div className="flex justify-between">
                    <dt className="text-muted">Em aberto no mês</dt>
                    <dd className="font-semibold tabular-nums">{formatMoney(list.openTotal, 'absolute')}</dd>
                </div>
                <div className="flex justify-between">
                    <dt className="text-muted">Total das faturas</dt>
                    <dd className="tabular-nums">{formatMoney(list.total, 'absolute')}</dd>
                </div>
            </dl>
        </section>
    );
}

/**
 * Item da lista: nome e situação da fatura do mês à esquerda, valor a pagar à direita.
 *
 * @param props.creditCard Cartão com a fatura do mês.
 * @param props.current Se é o cartão aberto.
 * @return O link que abre a fatura do mês do cartão.
 */
function CardLink({ creditCard, current }: { readonly creditCard: CreditCardInPeriodResponse; readonly current: boolean }): ReactNode {
    const cycle = creditCard.invoiceOfMonth;
    return (
        <Link
            to="/cards"
            search={{ card: creditCard.id }}
            aria-current={current ? 'page' : undefined}
            className={cn(
                'flex items-center justify-between gap-3 border-t border-line2 px-5 py-3 text-ink hover:bg-surface2',
                current && 'bg-soft shadow-[inset_3px_0_0_var(--color-accent)] hover:bg-soft',
            )}
        >
            <span className="flex min-w-0 flex-col">
                <span className={cn('flex items-center gap-2 text-14', current && 'font-semibold')}>
                    <span className="truncate">{creditCard.name}</span>
                    {creditCard.disabled && <StatusTag tone="warn">Desativado</StatusTag>}
                </span>
                <span className={cn('text-12', cycle.invoice?.status === 'open' ? 'text-warn-ink' : 'text-muted')}>{formatInvoiceSituation(cycle)}</span>
            </span>
            <span className="shrink-0 text-14 font-semibold tabular-nums">{formatInvoiceAmount(cycle)}</span>
        </Link>
    );
}

/**
 * Detalhe da fatura aberta: cabeçalho com as ações, os quatro números, os lançamentos e as
 * próximas faturas. A competência pode não ser a do mês de referência quando veio de um link;
 * então um aviso diz isso e leva de volta à fatura do mês.
 *
 * @param props.creditCard Cartão aberto, com o limite usado.
 * @param props.accounts Contas do perfil, desativadas incluídas: nomeiam a conta pagadora e a
 * origem dos pagamentos parciais.
 * @param props.invoicePeriod Competência `YYYY-MM` da fatura aberta.
 * @param props.referencePeriod Mês de referência.
 * @param props.onEdit Abre "Editar cartão".
 * @param props.onToggle Desativa ou reativa o cartão.
 * @param props.onDelete Abre o alerta de exclusão.
 * @param props.onAction Abre pagar, pagamento parcial ou reabrir para a fatura.
 * @return O detalhe da fatura.
 */
function CardInvoice({
    creditCard,
    accounts,
    invoicePeriod,
    referencePeriod,
    onEdit,
    onToggle,
    onDelete,
    onAction,
}: {
    readonly creditCard: CreditCardInPeriodResponse;
    readonly accounts: readonly AccountInPeriodResponse[];
    readonly invoicePeriod: string;
    readonly referencePeriod: string;
    readonly onEdit: () => void;
    readonly onToggle: () => void;
    readonly onDelete: () => void;
    readonly onAction: (action: InvoiceAction, target: InvoiceActionTarget) => void;
}): ReactNode {
    const cycles = useInvoicesByCard({ creditCardId: creditCard.id, from: invoicePeriod });
    const payingAccountName = accounts.find((account) => account.id === creditCard.accountId)?.name ?? '—';
    const cycle = cycles.data?.[0];
    const invoice = cycle?.invoice ?? null;
    const target: InvoiceActionTarget | null =
        cycle === undefined || invoice === null
            ? null
            : { creditCardId: creditCard.id, creditCardName: creditCard.name, payingAccountId: creditCard.accountId, payingAccountName, invoice, dueDate: cycle.dueDate };

    return (
        <>
            <header className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                    <span className="text-13 text-muted">
                        Cartão de crédito · paga com {payingAccountName}
                        {creditCard.disabled && ' · desativado'}
                    </span>
                    <h2 className="text-22 font-semibold">
                        {creditCard.name} — fatura de {formatMonthLong(invoicePeriod).toLowerCase()}
                    </h2>
                </div>
                <div className="flex gap-2">
                    <InvoiceActions target={target} onAction={onAction} />
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="icon-lg" aria-label="Mais ações">
                                ⋯
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={onEdit}>Editar cartão</DropdownMenuItem>
                            <DropdownMenuItem onSelect={onToggle}>{creditCard.disabled ? 'Reativar cartão' : 'Desativar cartão'}</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                                Excluir cartão…
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </header>
            {invoicePeriod !== referencePeriod && (
                <p role="note" className="flex items-center justify-between gap-3 rounded-8 bg-surface2 px-4 py-2.5 text-13 text-ink2 ring-1 ring-line">
                    <span>Esta fatura não é a do mês de referência.</span>
                    <Link to="/cards" search={{ card: creditCard.id }} className="text-accent hover:text-soft-ink">
                        Ver a fatura de {formatMonthShort(referencePeriod)}
                    </Link>
                </p>
            )}
            <QueryState query={cycles} loading={<InvoiceSkeleton />}>
                {(data) => {
                    const [shown] = data;
                    return shown === undefined ? null : (
                        <>
                            <InvoiceFigures creditCard={creditCard} cycle={shown} payingAccountName={payingAccountName} />
                            <InvoiceLines cycle={shown} accounts={accounts} />
                            <UpcomingInvoices creditCard={creditCard} cycles={data} />
                        </>
                    );
                }}
            </QueryState>
        </>
    );
}

/**
 * Botões da fatura no cabeçalho, pela situação dela.
 * Regra de negócio (Fatura, database-design §4.7): em aberto, paga-se inteira ou em parte;
 * paga, só se reabre — pagar de novo exige reabrir antes. Sem fatura no mês (nada caiu nela),
 * não há o que pagar. O pagamento parcial precisa de valor a pagar: numa fatura zerada ou
 * credora ele só criaria crédito.
 *
 * @param props.target Fatura aberta; `null` enquanto carrega ou quando o mês não tem fatura.
 * @param props.onAction Abre o diálogo da ação.
 * @return Os botões.
 */
function InvoiceActions({ target, onAction }: { readonly target: InvoiceActionTarget | null; readonly onAction: (action: InvoiceAction, target: InvoiceActionTarget) => void }): ReactNode {
    if (target?.invoice.status === 'paid') {
        return (
            <Button
                variant="outline"
                size="lg"
                className="px-3.5 font-normal"
                onClick={() => {
                    onAction('reopen', target);
                }}
            >
                Reabrir fatura
            </Button>
        );
    }
    const noInvoice = target === null ? 'Nenhum lançamento nesta fatura.' : undefined;
    const nothingDue = target !== null && target.invoice.amountDue.amount <= 0;
    return (
        <>
            <Button
                size="lg"
                className="px-3.5"
                disabled={target === null}
                title={noInvoice}
                onClick={() => {
                    if (target !== null) {
                        onAction('pay', target);
                    }
                }}
            >
                Pagar fatura
            </Button>
            <Button
                variant="outline"
                size="lg"
                className="px-3.5 font-normal"
                disabled={target === null || nothingDue}
                title={noInvoice ?? (nothingDue ? 'A fatura não tem valor a pagar.' : undefined)}
                onClick={() => {
                    if (target !== null) {
                        onAction('partial', target);
                    }
                }}
            >
                Pagamento parcial
            </Button>
        </>
    );
}

/**
 * Os quatro números da fatura (mockup): total a pagar com a situação, fechamento, vencimento e
 * limite usado.
 * Regra de negócio (Fatura, database-design §4.7): o total aparece em módulo, e a nota do
 * vencimento diz onde a fatura pesa — em aberto, no previsto da conta pagadora no vencimento;
 * paga, no extrato do mês do pagamento.
 *
 * @param props.creditCard Cartão, com o ciclo e o limite usado.
 * @param props.cycle Competência aberta, com as datas e a fatura.
 * @param props.payingAccountName Conta pagadora.
 * @return A faixa com os quatro números.
 */
function InvoiceFigures({
    creditCard,
    cycle,
    payingAccountName,
}: {
    readonly creditCard: CreditCardInPeriodResponse;
    readonly cycle: InvoiceCycleResponse;
    readonly payingAccountName: string;
}): ReactNode {
    const { invoice } = cycle;
    const usage = describeLimitUsage(creditCard);
    const paid = invoice?.status === 'paid';
    const dueNote =
        invoice !== null && invoice.paidInPeriod !== null ? `Saiu do extrato de ${formatMonthShort(invoice.paidInPeriod)} de ${payingAccountName}` : `Entra no previsto de ${payingAccountName}`;
    return (
        <section aria-label="Resumo da fatura" className="grid grid-cols-4 gap-4">
            <FigureCard label="Total a pagar">
                <span className="text-22 font-semibold tabular-nums">{invoice === null ? '—' : formatMoney(invoice.amountDue, 'absolute')}</span>
                <span className={cn('w-fit rounded-4 px-1.5 py-0.5 text-12 font-medium', invoice === null ? 'bg-surface2 text-muted' : paid ? 'bg-ok-bg text-ok-ink' : 'bg-warn-bg text-warn-ink')}>
                    {invoice === null ? 'Sem lançamentos' : paid ? formatInvoiceSituation(cycle) : 'Em aberto'}
                </span>
            </FigureCard>
            <FigureCard label="Fechamento">
                <span className="text-22 font-semibold tabular-nums">{formatDayMonth(cycle.closingDate)}</span>
                <span className="text-12 text-muted">Todo dia {creditCard.closingDay}</span>
            </FigureCard>
            <FigureCard label="Vencimento">
                <span className="text-22 font-semibold tabular-nums">{formatDayMonth(cycle.dueDate)}</span>
                <span className="text-12 text-muted">{dueNote}</span>
            </FigureCard>
            <FigureCard label="Limite usado">
                <span className={cn('text-22 font-semibold tabular-nums', usage.exceeded && 'text-out')}>{usage.percentText}</span>
                {usage.share !== null && (
                    <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-3 bg-track">
                        <span className={cn('block h-full', usage.exceeded ? 'bg-out' : 'bg-accent')} style={{ width: `${String(usage.share * 100)}%` }} />
                    </span>
                )}
                <span className="text-12 text-muted tabular-nums">
                    {usage.limitText}
                    {usage.exceeded && ' · acima do limite'}
                </span>
            </FigureCard>
        </section>
    );
}

/**
 * Um número da fatura.
 *
 * @param props.label Rótulo.
 * @param props.children Valor e notas.
 * @return O cartão do número.
 */
function FigureCard({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactNode {
    return (
        <div className="flex flex-col gap-1.5 rounded-10 border border-line bg-surface p-4">
            <span className="text-13 text-muted">{label}</span>
            {children}
        </div>
    );
}

/**
 * Lançamentos da fatura (mockup): data, lançamento, categoria e valor, com o total. Sem fatura
 * no mês não há o que consultar, e a tabela diz isso. É aqui que se editam e excluem as compras
 * do cartão: em Transações, sem filtro, elas ficam agrupadas na linha da fatura
 * (desktop-mvp-plan Fase 11.1). Editar e excluir usam os mesmos diálogos de Transações, com o
 * escopo das séries.
 *
 * @param props.cycle Competência aberta.
 * @param props.accounts Contas do perfil, para a origem dos pagamentos parciais e o alerta de exclusão.
 * @return A tabela.
 */
function InvoiceLines({ cycle, accounts }: { readonly cycle: InvoiceCycleResponse; readonly accounts: readonly AccountInPeriodResponse[] }): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const detail = useInvoice(cycle.invoice === null ? null : { invoiceId: cycle.invoice.id });
    const categories = useCategoryTree({ profileId: profile.id });
    const creditCards = useCreditCards({ profileId: profile.id, period });
    const recurrences = useRecurrences({ profileId: profile.id });
    const [editing, setEditing] = useState<TransactionResponse | null>(null);
    const [deleting, setDeleting] = useState<TransactionResponse | null>(null);
    if (cycle.invoice === null) {
        return (
            <section aria-label="Lançamentos" className="rounded-10 border border-line bg-surface px-4 py-6 text-center text-13 text-muted">
                Nenhum lançamento na fatura de {formatMonthShort(cycle.period)}.
            </section>
        );
    }
    return (
        <>
            <QueryState query={detail} loading={<Skeleton className="h-60" />}>
                {(invoice) => (
                    <QueryState query={categories} loading={<Skeleton className="h-60" />}>
                        {(tree) => {
                            const table = buildInvoiceTable({ invoice, accounts, categories: tree });
                            /**
                             * @param line Linha da fatura.
                             * @return O lançamento inteiro da linha, para os diálogos; `null` se
                             * a fatura recarregou sem ele.
                             */
                            const transactionOf = (line: InvoiceLine): TransactionResponse | null => invoice.transactions.find((item) => item.id === line.transactionId) ?? null;
                            return (
                                <section aria-label="Lançamentos" className="overflow-hidden rounded-10 border border-line bg-surface">
                                    <Table className="text-13">
                                        <TableHeader className="bg-surface2">
                                            <TableRow className="border-line hover:bg-transparent">
                                                <TableHead className="w-16 pl-4 text-12 font-normal text-muted">Data</TableHead>
                                                <TableHead className="text-12 font-normal text-muted">Lançamento</TableHead>
                                                <TableHead className="text-12 font-normal text-muted">Categoria › Sub</TableHead>
                                                <TableHead className="text-right text-12 font-normal text-muted">Valor</TableHead>
                                                <TableHead className="w-12 pr-4">
                                                    <span className="sr-only">Ações</span>
                                                </TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {table.lines.map((line) => (
                                                <InvoiceLineRow
                                                    key={line.key}
                                                    line={line}
                                                    onEdit={() => {
                                                        setEditing(transactionOf(line));
                                                    }}
                                                    onDelete={() => {
                                                        setDeleting(transactionOf(line));
                                                    }}
                                                />
                                            ))}
                                        </TableBody>
                                        <TableFooter className="bg-surface2">
                                            <TableRow className="border-line hover:bg-transparent">
                                                <TableCell />
                                                <TableCell className="font-semibold">Total</TableCell>
                                                <TableCell />
                                                <TableCell className="text-right font-semibold tabular-nums">{table.totalText}</TableCell>
                                                <TableCell />
                                            </TableRow>
                                        </TableFooter>
                                    </Table>
                                </section>
                            );
                        }}
                    </QueryState>
                )}
            </QueryState>
            {editing !== null && (
                <TransactionDialog
                    key={editing.id}
                    transaction={editing}
                    container={`${detail.data?.creditCardName ?? ''} · fat. ${formatMonthAbbreviation(cycle.period)}`}
                    recurrence={recurrences.data?.find((recurrence) => recurrence.id === editing.recurrenceId) ?? null}
                    onClose={() => {
                        setEditing(null);
                    }}
                    onDelete={(transaction) => {
                        setDeleting(transaction);
                    }}
                />
            )}
            {deleting !== null && (
                <DeleteTransactionDialog
                    transaction={deleting}
                    accounts={accounts}
                    creditCards={creditCards.data?.creditCards ?? []}
                    onClose={() => {
                        setDeleting(null);
                    }}
                    onDeleted={() => {
                        setEditing((current) => (current?.id === deleting.id ? null : current));
                    }}
                />
            )}
        </>
    );
}

/**
 * Uma linha da fatura. O estorno e o pagamento parcial se leem pela etiqueta, pelo sinal e pelo
 * `⇄`, não só pela cor (decisão de interface 7). O clique e o `Enter` editam e o `Del` exclui,
 * como na tabela de Transações; o "⋯" tem as duas ações para quem não usa o teclado.
 *
 * @param props.line Linha montada pelo view-model.
 * @param props.onEdit Abre a edição do lançamento.
 * @param props.onDelete Abre a confirmação de excluir o lançamento.
 * @return A linha da tabela.
 */
function InvoiceLineRow({ line, onEdit, onDelete }: { readonly line: InvoiceLine; readonly onEdit: () => void; readonly onDelete: () => void }): ReactNode {
    return (
        <TableRow
            tabIndex={0}
            className="cursor-pointer border-line2 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
            onClick={onEdit}
            onKeyDown={(event) => {
                if (event.target !== event.currentTarget || event.ctrlKey || event.altKey || event.metaKey) {
                    return;
                }
                if (event.key === 'Enter') {
                    event.preventDefault();
                    onEdit();
                } else if (event.key === 'Delete') {
                    event.preventDefault();
                    onDelete();
                }
            }}
        >
            <TableCell className="pl-4 tabular-nums">{line.date}</TableCell>
            <TableCell className="whitespace-normal">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span>{line.name}</span>
                    {line.kind === 'refund' && <StatusTag tone="neutral">estorno</StatusTag>}
                    {line.kind === 'payment' && <StatusTag tone="neutral">pagamento parcial</StatusTag>}
                    {line.detail !== null && <span className="text-12 text-muted">{line.detail}</span>}
                </span>
            </TableCell>
            <TableCell className="whitespace-normal text-ink2">{line.category}</TableCell>
            <TableCell className={cn('text-right font-semibold tabular-nums', line.kind !== 'purchase' && 'text-in')}>{line.amountText}</TableCell>
            <TableCell
                className="pr-4 text-right"
                onClick={(event) => {
                    // O menu não abre a edição da linha por baixo dele.
                    event.stopPropagation();
                }}
            >
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" aria-label={`Ações de ${line.name}`}>
                            ⋯
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={onEdit}>Editar</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                            Excluir…
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </TableCell>
        </TableRow>
    );
}

/**
 * "Próximas faturas deste cartão" (mockup): as faturas depois da aberta, cada uma levando ao
 * seu detalhe.
 *
 * @param props.creditCard Cartão, pelo dia de fechamento que decide a fase de cada fatura.
 * @param props.cycles Saída de `invoices.listByCard` a partir da fatura aberta.
 * @return A lista.
 */
function UpcomingInvoices({ creditCard, cycles }: { readonly creditCard: CreditCardInPeriodResponse; readonly cycles: readonly InvoiceCycleResponse[] }): ReactNode {
    const rows = buildUpcomingInvoices(cycles, creditCard.closingDay, currentDate(new Date()));
    return (
        <section aria-labelledby="upcoming-invoices" className="flex flex-col gap-2.5">
            <h3 id="upcoming-invoices" className="text-15 font-semibold">
                Próximas faturas deste cartão
            </h3>
            {rows.length === 0 ? (
                <p className="text-13 text-muted">Nenhuma fatura com lançamentos depois desta.</p>
            ) : (
                <ul className="flex flex-wrap gap-3">
                    {rows.map((row) => (
                        <li key={row.period}>
                            <Link
                                to="/cards"
                                search={{ card: creditCard.id, invoice: row.period }}
                                className="flex min-w-50 flex-col gap-1 rounded-10 border border-line bg-surface px-4 py-3 text-ink hover:bg-surface2"
                            >
                                <span className="text-12 text-muted">{row.label}</span>
                                <span className="text-15 font-semibold tabular-nums">{row.amountText}</span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

/**
 * @return O esqueleto da tela enquanto a lista de cartões carrega, com o mesmo desenho dela.
 */
function CardListSkeleton(): ReactNode {
    return (
        <section aria-label="Lista de cartões" className="flex w-95 shrink-0 flex-col gap-3 border-r border-line bg-surface p-5">
            <h1 className="text-20 font-semibold">Cartões</h1>
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
        </section>
    );
}

/**
 * @return O esqueleto do detalhe enquanto a fatura carrega: os quatro números e a tabela.
 */
function InvoiceSkeleton(): ReactNode {
    return (
        <>
            <div className="grid grid-cols-4 gap-4">
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
            </div>
            <Skeleton className="h-60" />
        </>
    );
}
