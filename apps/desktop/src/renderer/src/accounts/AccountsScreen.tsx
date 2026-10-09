import {
    buildStatementTable,
    formatAccountHeading,
    formatAccountType,
    formatMoney,
    formatMonthLong,
    useAccounts,
    useCategoryTree,
    useCreditCards,
    useStatement,
    useTransferTargets,
    type StatementRow,
    type StatementTable,
} from '@finance/client';
import type { AccountInPeriodResponse, AccountListResponse, BalancePairResponse, StatementResponse } from '@finance/core';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { EmptyState, QueryState, Skeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { AccountDialog, useToggleAccount } from '@/registry/AccountsSection';
import { AccountDeletionDialog } from '@/registry/DeletionDialog';
import { StatusTag } from '@/registry/registryUi';
import { useActiveProfile } from '@/shell/activeProfile';
import { useReferenceMonth } from '@/shell/useReferenceMonth';
import { openAccount, parseAccountsSearch } from './accountsSearch.ts';

/** Diálogo aberto na tela: criar, editar ou excluir uma conta. */
type AccountDialogState = { readonly mode: 'create' } | { readonly mode: 'edit'; readonly account: AccountInPeriodResponse } | { readonly mode: 'delete'; readonly account: AccountInPeriodResponse };

/**
 * Contas (mockup `DesktopContas`; desktop-mvp-plan Fase 7): à esquerda a lista com o saldo do
 * mês de cada conta e os totais, à direita o extrato do mês da conta aberta. A conta aberta
 * fica na URL (`account`), como o tipo aberto em Cadastros.
 *
 * @return A tela de Contas.
 */
export function AccountsScreen(): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const navigate = useNavigate();
    // Lida pelo `parseAccountsSearch`, e não pelo tipo da rota, pelo mesmo motivo do
    // `useReferenceMonth`: a tela é importada pelo próprio roteador.
    const search = useSearch({ strict: false, select: (raw: Readonly<Record<string, unknown>>) => parseAccountsSearch(raw) });
    const accounts = useAccounts({ profileId: profile.id, period });
    const [dialog, setDialog] = useState<AccountDialogState | null>(null);
    const toggle = useToggleAccount();
    const close = (): void => {
        setDialog(null);
    };

    return (
        <div className="-mx-8 -my-6 flex flex-1">
            <QueryState query={accounts} loading={<AccountListSkeleton />}>
                {(list) => {
                    const open = openAccount(list, search);
                    return (
                        <>
                            <AccountList
                                list={list}
                                openId={open?.id ?? null}
                                onCreate={() => {
                                    setDialog({ mode: 'create' });
                                }}
                            />
                            <section aria-label="Extrato" className="flex min-w-0 flex-1 flex-col gap-5 px-8 py-6">
                                {open === null ? (
                                    <EmptyState title="Nenhuma conta" description="Crie uma conta para ver o extrato do mês." />
                                ) : (
                                    <AccountStatement
                                        key={open.id}
                                        account={open}
                                        accounts={list.accounts}
                                        period={period}
                                        onEdit={() => {
                                            setDialog({ mode: 'edit', account: open });
                                        }}
                                        onToggle={() => {
                                            toggle(open);
                                        }}
                                        onDelete={() => {
                                            setDialog({ mode: 'delete', account: open });
                                        }}
                                    />
                                )}
                            </section>
                        </>
                    );
                }}
            </QueryState>
            {dialog?.mode === 'create' && (
                <AccountDialog
                    account={null}
                    onClose={close}
                    onCreated={(created) => {
                        void navigate({ to: '/accounts', search: { account: created.id } });
                    }}
                />
            )}
            {dialog?.mode === 'edit' && <AccountDialog key={dialog.account.id} account={dialog.account} onClose={close} />}
            {dialog?.mode === 'delete' && (
                <AccountDeletionDialog
                    account={dialog.account}
                    onClose={close}
                    onDisableInstead={
                        dialog.account.disabled
                            ? undefined
                            : () => {
                                  toggle(dialog.account);
                              }
                    }
                />
            )}
        </div>
    );
}

/**
 * Lista lateral: cada conta com o saldo do mês e os totais do perfil no rodapé.
 * Regra de negócio (Contas): a conta fora do total aparece apagada e só com o consolidado,
 * como no mockup, e o rodapé soma só as que entram no total — o `total` já vem filtrado do
 * núcleo, e a tela não refaz a soma (database-design §4.4).
 *
 * @param props.list Contas do perfil no mês e o total.
 * @param props.openId Conta aberta, marcada na lista.
 * @param props.onCreate Abre o diálogo de nova conta.
 * @return A lista de contas.
 */
function AccountList({ list, openId, onCreate }: { readonly list: AccountListResponse; readonly openId: string | null; readonly onCreate: () => void }): ReactNode {
    return (
        <section aria-label="Lista de contas" className="flex w-95 shrink-0 flex-col border-r border-line bg-surface">
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
                <h1 className="text-20 font-semibold">Contas</h1>
                <Button variant="outline" size="sm" className="text-13 font-normal" onClick={onCreate}>
                    + Nova conta
                </Button>
            </div>
            <div aria-hidden="true" className="flex justify-between px-5 py-2 text-12 text-muted">
                <span>Conta</span>
                <span>saldo no mês</span>
            </div>
            <ul aria-label="Contas">
                {list.accounts.map((account) => (
                    <li key={account.id}>
                        <AccountLink account={account} current={account.id === openId} />
                    </li>
                ))}
            </ul>
            <dl className="mt-auto flex flex-col gap-1 border-t border-line px-5 py-3.5 text-13">
                <div className="flex justify-between">
                    <dt className="text-muted">Total consolidado</dt>
                    <dd className="font-semibold tabular-nums">{formatMoney(list.total.consolidated)}</dd>
                </div>
                <div className="flex justify-between">
                    <dt className="text-muted">Total previsto</dt>
                    <dd className="tabular-nums">{formatMoney(list.total.projected)}</dd>
                </div>
            </dl>
        </section>
    );
}

/**
 * Item da lista: nome, tipo e situação à esquerda; consolidado e previsto à direita.
 *
 * @param props.account Conta com os saldos do mês.
 * @param props.current Se é a conta aberta.
 * @return O link que abre o extrato da conta.
 */
function AccountLink({ account, current }: { readonly account: AccountInPeriodResponse; readonly current: boolean }): ReactNode {
    const outside = !account.considerBalance;
    return (
        <Link
            to="/accounts"
            search={{ account: account.id }}
            aria-current={current ? 'page' : undefined}
            className={cn(
                'flex items-center justify-between gap-3 border-t border-line2 px-5 py-3 text-ink hover:bg-surface2',
                outside && 'text-muted',
                current && 'bg-soft shadow-[inset_3px_0_0_var(--color-accent)] hover:bg-soft',
            )}
        >
            <span className="flex min-w-0 flex-col">
                <span className={cn('flex items-center gap-2 text-14', current && 'font-semibold')}>
                    <span className="truncate">{account.name}</span>
                    {account.disabled && <StatusTag tone="warn">Desativada</StatusTag>}
                </span>
                <span className="text-12 text-muted">
                    {formatAccountType(account.type)}
                    {outside && ' · fora do total'}
                </span>
            </span>
            {outside ? (
                <span className="text-14 tabular-nums">{formatMoney(account.balances.consolidated)}</span>
            ) : (
                <span className="flex shrink-0 flex-col items-end">
                    <span className="text-14 font-semibold tabular-nums">{formatMoney(account.balances.consolidated)}</span>
                    <span className="text-12 text-muted tabular-nums">previsto {formatMoney(account.balances.projected)}</span>
                </span>
            )}
        </Link>
    );
}

/**
 * Extrato do mês da conta aberta: cabeçalho com as ações, os quatro números e a tabela de
 * movimentos. Os cartões e as categorias só dão nome às linhas; enquanto carregam, os números
 * já aparecem.
 *
 * @param props.account Conta aberta.
 * @param props.accounts Todas as contas do perfil, desativadas incluídas: nomeiam a origem e o
 * destino das transferências; as de outros perfis vêm de `accounts.transferTargets`.
 * @param props.period Mês de referência.
 * @param props.onEdit Abre "Editar conta".
 * @param props.onToggle Desativa ou reativa a conta.
 * @param props.onDelete Abre o alerta de exclusão.
 * @return O extrato.
 */
function AccountStatement({
    account,
    accounts,
    period,
    onEdit,
    onToggle,
    onDelete,
}: {
    readonly account: AccountInPeriodResponse;
    readonly accounts: AccountListResponse['accounts'];
    readonly period: string;
    readonly onEdit: () => void;
    readonly onToggle: () => void;
    readonly onDelete: () => void;
}): ReactNode {
    const { profile } = useActiveProfile();
    const statement = useStatement({ accountId: account.id, period });
    const creditCards = useCreditCards({ profileId: profile.id, period });
    const categories = useCategoryTree({ profileId: profile.id });
    // Só nomeiam o outro lado das transferências entre perfis; sem elas o extrato ainda se monta.
    const otherProfileAccounts = useTransferTargets({ profileId: profile.id });

    return (
        <>
            <header className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                    <span className="text-13 text-muted">{formatAccountHeading(account)}</span>
                    <h2 className="text-22 font-semibold">
                        {account.name} — extrato de {formatMonthLong(period).toLowerCase()}
                    </h2>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="lg" className="px-3.5 font-normal" onClick={onEdit}>
                        Editar conta
                    </Button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="icon-lg" aria-label="Mais ações">
                                ⋯
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={onToggle}>{account.disabled ? 'Reativar conta' : 'Desativar conta'}</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                                Excluir conta…
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </header>
            <QueryState query={statement} loading={<StatementSkeleton />}>
                {(data) => (
                    <>
                        <StatementFigures statement={data} />
                        <QueryState query={creditCards} loading={<Skeleton className="h-60" />}>
                            {(cards) => (
                                <QueryState query={categories} loading={<Skeleton className="h-60" />}>
                                    {(tree) => <StatementMovements statement={data} table={buildStatementTable({ statement: data, accounts, creditCards: cards.creditCards, categories: tree, otherProfileAccounts: otherProfileAccounts.data ?? [] })} />}
                                </QueryState>
                            )}
                        </QueryState>
                    </>
                )}
            </QueryState>
        </>
    );
}

/**
 * Os quatro números do extrato (mockup): saldo inicial, entradas, saídas e saldo final.
 * Regra de negócio (Extrato): todos mostram o consolidado em destaque e o previsto abaixo,
 * com peso menor (decisão de interface 6); inicial + entradas − saídas = final vale nos dois,
 * porque entradas e saídas somam os mesmos movimentos da tabela, pagos no consolidado e todos
 * no previsto.
 *
 * @param props.statement Extrato do mês.
 * @return A faixa com os quatro números.
 */
function StatementFigures({ statement }: { readonly statement: StatementResponse }): ReactNode {
    return (
        <section aria-label="Resumo do extrato" className="grid grid-cols-4 gap-4">
            <Figure label="Saldo inicial" pair={statement.opening} sign="negative" />
            <Figure label="↑ Entradas" pair={statement.inflows} sign="always" tone="in" note="receitas e transferências recebidas" />
            <Figure label="↓ Saídas" pair={statement.outflows} sign="always" tone="out" note="inclui faturas pagas por esta conta" />
            <Figure label="Saldo final" pair={statement.closing} sign="negative" />
        </section>
    );
}

/**
 * Um número do extrato.
 *
 * @param props.label Rótulo; entradas e saídas levam a seta, que diz o sentido sem a cor.
 * @param props.pair Consolidado e previsto.
 * @param props.sign `always` nas entradas e saídas (`+`/`−`), `negative` nos saldos.
 * @param props.tone Cor de entrada ou saída; os saldos ficam na cor do texto.
 * @param props.note Explicação do que entra na soma, como no mockup.
 * @return O cartão do número.
 */
function Figure({
    label,
    pair,
    sign,
    tone,
    note,
}: {
    readonly label: string;
    readonly pair: BalancePairResponse;
    readonly sign: 'negative' | 'always';
    readonly tone?: 'in' | 'out';
    readonly note?: string;
}): ReactNode {
    return (
        <div className="flex flex-col gap-1.5 rounded-10 border border-line bg-surface p-4">
            <span className="text-13 text-muted">{label}</span>
            <span className={cn('text-22 font-semibold tabular-nums', tone === 'in' && 'text-in', tone === 'out' && 'text-out')}>{formatMoney(pair.consolidated, sign)}</span>
            <span className="text-12 text-muted tabular-nums">previsto {formatMoney(pair.projected, sign)}</span>
            {note !== undefined && <span className="text-12 text-muted">{note}</span>}
        </div>
    );
}

/**
 * Tabela de movimentos do mês (mockup): data, movimento, categoria, situação e valor, na
 * ordem da data de caixa. A fatura leva ao cartão ("ver fatura"), e a nota do rodapé explica
 * por que a fatura em aberto não mexe no consolidado.
 *
 * @param props.statement Extrato do mês, para a frase do mês sem movimento.
 * @param props.table Linhas montadas pelo `buildStatementTable`.
 * @return A tabela.
 */
function StatementMovements({ statement, table }: { readonly statement: StatementResponse; readonly table: StatementTable }): ReactNode {
    return (
        <section aria-label="Movimentos" className="overflow-hidden rounded-10 border border-line bg-surface text-13">
            <Table className="text-13">
                <TableHeader className="bg-surface2">
                    <TableRow className="border-line hover:bg-transparent">
                        <TableHead className="w-16 pl-4 text-12 font-normal text-muted">Data</TableHead>
                        <TableHead className="text-12 font-normal text-muted">Movimento</TableHead>
                        <TableHead className="text-12 font-normal text-muted">Categoria › Sub</TableHead>
                        <TableHead className="w-25 text-12 font-normal text-muted">Situação</TableHead>
                        <TableHead className="pr-4 text-right text-12 font-normal text-muted">Valor</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {table.rows.map((row) => (
                        <MovementRow key={row.key} row={row} />
                    ))}
                </TableBody>
            </Table>
            {table.rows.length === 0 && (
                <p className="px-4 py-6 text-center text-muted">
                    Nenhum movimento em {formatMonthLong(statement.period).toLowerCase()}. O saldo final é o mesmo do inicial.
                </p>
            )}
            {table.hasOpenInvoices && <p className="border-t border-line2 bg-surface2 px-4 py-2.5 text-12 text-muted">Fatura em aberto conta só no saldo previsto, no mês do vencimento.</p>}
        </section>
    );
}

/**
 * Uma linha de movimento. O sentido se lê pelo sinal e pelo `⇄`, não só pela cor (decisão de
 * interface 7); o estorno leva a etiqueta.
 *
 * @param props.row Linha montada pelo view-model.
 * @return A linha da tabela.
 */
function MovementRow({ row }: { readonly row: StatementRow }): ReactNode {
    const { invoice } = row;
    return (
        <TableRow className={cn('border-line2', (row.kind === 'paidInvoice' || row.kind === 'openInvoice') && 'text-ink2')}>
            <TableCell className="pl-4 tabular-nums">{row.date}</TableCell>
            <TableCell className="whitespace-normal">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span>{row.name}</span>
                    {row.refund && <StatusTag tone="neutral">estorno</StatusTag>}
                    {row.detail !== null && <span className="text-12 text-muted">{row.detail}</span>}
                    {invoice !== null && (
                        <Link to="/cards" search={{ card: invoice.creditCardId, invoice: invoice.period }} className="text-12 text-accent hover:text-soft-ink">
                            ver fatura
                        </Link>
                    )}
                </span>
            </TableCell>
            <TableCell className="whitespace-normal text-ink2">{row.category}</TableCell>
            <TableCell className={cn(row.situation === 'invoiceOpen' && 'text-warn-ink')}>{row.situationText}</TableCell>
            <TableCell className={cn('pr-4 text-right font-semibold tabular-nums', row.direction === 'in' && 'text-in', row.direction === 'out' && 'text-out')}>{row.amountText}</TableCell>
        </TableRow>
    );
}

/**
 * @return O esqueleto da tela enquanto a lista de contas carrega, com o mesmo desenho dela.
 */
function AccountListSkeleton(): ReactNode {
    return (
        <section aria-label="Lista de contas" className="flex w-95 shrink-0 flex-col gap-3 border-r border-line bg-surface p-5">
            <h1 className="text-20 font-semibold">Contas</h1>
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
        </section>
    );
}

/**
 * @return O esqueleto do extrato enquanto ele carrega: os quatro números e a tabela.
 */
function StatementSkeleton(): ReactNode {
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
