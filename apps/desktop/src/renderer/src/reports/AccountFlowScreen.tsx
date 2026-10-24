import { buildAccountFlowTable, formatAccountType, useAccountFlow, useAccounts, type AccountFlowCell, type AccountFlowTable, type AccountFlowTone } from '@finance/client';
import type { AccountInPeriodResponse, AccountListResponse } from '@finance/core';
import { Link, useSearch } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { DetailPane, ListPane, NestedPanes } from '@/components/PaneLayout';
import { EmptyState, QueryState, Skeleton } from '@/components/states';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { StatusTag } from '@/registry/registryUi';
import { useActiveProfile } from '@/shell/activeProfile';
import { useReferenceMonth } from '@/shell/useReferenceMonth';
import { ALL_ACCOUNTS, chooseAccountFlow, parseAccountFlowSearch, type AccountFlowChoice } from './accountFlowSearch.ts';

/**
 * Fluxo por conta (mockup `DesktopRelFluxo`, D5; desktop-mvp-plan Fase 12.1): à esquerda as contas
 * e a soma das do total, à direita os extratos encadeados nos 3 meses antes e 1 depois do mês de
 * referência. A escolha fica na URL (`account`), como a conta aberta em Contas.
 * Regra de negócio (Relatórios, F2): os números são os do extrato de cada conta — a tela só os
 * arruma, pelo `accountFlowTable` do `client` (desktop-mvp-plan §3.4).
 *
 * @return A tela do fluxo por conta.
 */
export function AccountFlowScreen(): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    // Lida pelo `parseAccountFlowSearch`, e não pelo tipo da rota, pelo mesmo motivo de Contas:
    // a tela é importada pelo próprio roteador.
    const search = useSearch({ strict: false, select: (raw: Readonly<Record<string, unknown>>) => parseAccountFlowSearch(raw) });
    const accounts = useAccounts({ profileId: profile.id, period });

    return (
        <NestedPanes>
            <QueryState query={accounts} loading={<FlowSkeleton />}>
                {(list) => {
                    const choice = chooseAccountFlow(list.accounts, search);
                    return (
                        <>
                            <AccountChoiceList list={list} choice={choice} />
                            <DetailPane label="Extratos encadeados">
                                {choice === null ? (
                                    <EmptyState title="Nenhuma conta" description="Crie uma conta para ver o fluxo dos extratos." action={<Link to="/accounts">Ir para Contas</Link>} />
                                ) : (
                                    <FlowReport choice={choice} />
                                )}
                            </DetailPane>
                        </>
                    );
                }}
            </QueryState>
        </NestedPanes>
    );
}

/**
 * Lista lateral: cada conta e, por último, a soma das contas do total. Mais estreita que a de
 * Contas porque divide a página com a lista de relatórios (`ReportsLayout`), e a tabela dos cinco
 * meses precisa do espaço.
 * Regra de negócio (Relatórios, F6): a conta fora do total pode ser escolhida, mas aparece apagada
 * e com "fora do total", como em Contas, porque não entra na soma (desktop-mvp-plan §3.4).
 *
 * @param props.list Contas do perfil no mês.
 * @param props.choice O que está aberto, marcado na lista.
 * @return A lista de escolha.
 */
function AccountChoiceList({ list, choice }: { readonly list: AccountListResponse; readonly choice: AccountFlowChoice | null }): ReactNode {
    return (
        <ListPane
            label="Escolher conta"
            width="w-60"
            header={
                <div className="flex flex-col gap-1 px-5 pt-5 pb-3">
                    <span className="text-12 text-muted">Relatórios</span>
                    <h1 className="text-20 font-semibold">Fluxo por conta</h1>
                </div>
            }
        >
            <ul aria-label="Contas">
                {list.accounts.map((account) => (
                    <li key={account.id}>
                        <AccountChoiceLink account={account} current={choice?.kind === 'account' && choice.accountId === account.id} />
                    </li>
                ))}
                <li>
                    <ChoiceLink account={ALL_ACCOUNTS} current={choice?.kind === 'total'} title="Todas as contas do total" detail="somadas" />
                </li>
            </ul>
        </ListPane>
    );
}

/**
 * @param props.account Conta da lista.
 * @param props.current Se é a conta aberta.
 * @return O link que abre o fluxo da conta.
 */
function AccountChoiceLink({ account, current }: { readonly account: AccountInPeriodResponse; readonly current: boolean }): ReactNode {
    const outside = !account.considerBalance;
    return (
        <ChoiceLink
            account={account.id}
            current={current}
            muted={outside}
            title={account.name}
            detail={outside ? 'fora do total' : formatAccountType(account.type)}
            tag={account.disabled ? <StatusTag tone="warn">Desativada</StatusTag> : null}
        />
    );
}

/**
 * Um item da lista, no mesmo desenho da lista de Contas.
 *
 * @param props.account Valor de `account` na URL: o id da conta ou `total`.
 * @param props.current Se é o item aberto.
 * @param props.muted Apaga o item (conta fora do total).
 * @param props.title Nome do item.
 * @param props.detail Linha de baixo: tipo da conta, "fora do total" ou "somadas".
 * @param props.tag Etiqueta ao lado do nome (conta desativada).
 * @return O link.
 */
function ChoiceLink({ account, current, muted = false, title, detail, tag = null }: {
    readonly account: string;
    readonly current: boolean;
    readonly muted?: boolean;
    readonly title: string;
    readonly detail: string;
    readonly tag?: ReactNode;
}): ReactNode {
    return (
        <Link
            to="/reports/account-flow"
            search={{ account }}
            aria-current={current ? 'page' : undefined}
            className={cn(
                'flex items-center justify-between gap-3 border-t border-line2 px-5 py-3 text-ink hover:bg-surface2',
                muted && 'text-muted',
                current && 'bg-soft shadow-[inset_3px_0_0_var(--color-accent)] hover:bg-soft',
            )}
        >
            <span className={cn('flex min-w-0 items-center gap-2 text-14', current && 'font-semibold')}>
                <span className="truncate">{title}</span>
                {tag}
            </span>
            <span className="shrink-0 text-12 text-muted">{detail}</span>
        </Link>
    );
}

/**
 * O relatório da escolha aberta: título, tabela e a nota sobre a cadeia de saldos.
 *
 * @param props.choice Conta aberta, ou a soma das do total.
 * @return O relatório.
 */
function FlowReport({ choice }: { readonly choice: AccountFlowChoice }): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const report = useAccountFlow({ profileId: profile.id, period, ...(choice.kind === 'account' ? { accountId: choice.accountId } : {}) });

    return (
        <QueryState query={report} loading={<Skeleton className="h-80 rounded-10" />}>
            {(data) => {
                const table = buildAccountFlowTable(data);
                return (
                    <>
                        <div className="flex flex-col gap-1">
                            <h2 className="text-16 font-semibold">{table.title}</h2>
                            <span className="text-12 text-muted">{table.subtitle}</span>
                        </div>
                        <FlowTable table={table} />
                        <p className="rounded-8 bg-soft px-3 py-2.5 text-13 text-soft-ink">
                            Lançamento não pago e fatura em aberto pesam só no previsto. Editar um lançamento antigo recalcula aquele mês e todos os seguintes.
                        </p>
                    </>
                );
            }}
        </QueryState>
    );
}

/** Classe de cada tom de célula; a direção também está no sinal e na seta da linha (decisão 7). */
const TONES: Readonly<Record<AccountFlowTone, string>> = {
    in: 'text-in',
    out: 'text-out',
    neutral: 'text-ink',
    muted: 'text-muted',
};

/**
 * Tabela mês × linha. A coluna do mês de referência fica destacada; o cabeçalho diz qual mês é o
 * corrente e quais são só previstos.
 *
 * @param props.table Tabela pronta do `client`.
 * @return A tabela.
 */
function FlowTable({ table }: { readonly table: AccountFlowTable }): ReactNode {
    return (
        <section className="overflow-hidden rounded-10 border border-line bg-surface">
            <Table aria-label={table.title} className="text-13">
                <TableHeader>
                    <TableRow className="bg-surface2 hover:bg-surface2">
                        <TableHead className="px-4">
                            <span className="sr-only">Linha</span>
                        </TableHead>
                        {table.columns.map((column) => (
                            <TableHead
                                key={column.period}
                                aria-current={column.isReference ? 'date' : undefined}
                                className={cn('text-right', column.isReference && 'bg-soft font-semibold text-soft-ink')}
                            >
                                {column.label}
                                {column.note !== null && ` · ${column.note}`}
                            </TableHead>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {table.rows.map((row) => (
                        <TableRow key={row.key} className={cn('border-line2 tabular-nums', row.emphasis === 'total' && 'border-t border-line font-semibold')}>
                            <TableCell className={cn('px-4', row.emphasis === 'muted' && 'text-muted')}>{row.label}</TableCell>
                            {row.cells.map((cell, index) => (
                                <FlowCell key={table.columns[index]?.period ?? index} cell={cell} reference={table.columns[index]?.isReference === true} />
                            ))}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </section>
    );
}

/**
 * @param props.cell Célula pronta.
 * @param props.reference Se está na coluna do mês de referência, destacada.
 * @return A célula com o valor e a nota do que está em aberto.
 */
function FlowCell({ cell, reference }: { readonly cell: AccountFlowCell; readonly reference: boolean }): ReactNode {
    return (
        <TableCell className={cn('text-right align-top', reference && 'bg-soft')}>
            <span className="flex flex-col items-end">
                <span className={TONES[cell.tone]}>{cell.text}</span>
                {cell.sub !== null && <span className="text-12 font-normal text-muted">{cell.sub}</span>}
            </span>
        </TableCell>
    );
}

/**
 * Esqueleto da tela: a lista e a tabela.
 *
 * @return O esqueleto marcado como ocupado.
 */
function FlowSkeleton(): ReactNode {
    return (
        <div role="status" aria-busy="true" aria-label="Carregando relatório" className="flex flex-1 gap-5 px-8 py-6">
            <Skeleton className="h-80 w-80 rounded-10" />
            <Skeleton className="h-80 flex-1 rounded-10" />
        </div>
    );
}
