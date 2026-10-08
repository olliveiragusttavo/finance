import {
    buildGoalContributionRows,
    describeGoalListItem,
    formatMoney,
    goalFigures,
    goalPendingNote,
    goalProjectionNote,
    useAccounts,
    useCategoryTree,
    useCreditCards,
    useGoalContributions,
    useGoals,
    type GoalContributionRow,
    type GoalFigure,
} from '@finance/client';
import type { GoalProgressResponse } from '@finance/core';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { EmptyState, QueryState, Skeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { StatusTag } from '@/registry/registryUi';
import { useActiveProfile } from '@/shell/activeProfile';
import { useReferenceMonth } from '@/shell/useReferenceMonth';
import { DeleteGoalDialog, GoalDialog } from './GoalDialogs.tsx';
import { openGoal, parseGoalsSearch } from './goalsSearch.ts';

/** Diálogo aberto na tela: criar, editar ou excluir uma meta. */
type GoalDialogState = { readonly mode: 'create' } | { readonly mode: 'edit'; readonly goal: GoalProgressResponse } | { readonly mode: 'delete'; readonly goal: GoalProgressResponse };

/**
 * Metas (mockup `DesktopMetas`; desktop-mvp-plan Fase 9.3): à esquerda a lista com o progresso
 * de cada meta, à direita o detalhe da meta aberta — progresso, quanto falta, data-alvo, ritmo
 * necessário e as transações que contam. A meta aberta fica na URL (`goal`), como a conta em
 * Contas. O mês de referência só move o ritmo: o progresso é o que já foi pago até hoje.
 *
 * @return A tela de Metas.
 */
export function GoalsScreen(): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const navigate = useNavigate();
    // Lida pelo `parseGoalsSearch`, e não pelo tipo da rota, porque a tela é importada pelo
    // próprio roteador (o mesmo motivo de Contas).
    const search = useSearch({ strict: false, select: (raw: Readonly<Record<string, unknown>>) => parseGoalsSearch(raw) });
    const goals = useGoals({ profileId: profile.id, period });
    const [dialog, setDialog] = useState<GoalDialogState | null>(null);
    const close = (): void => {
        setDialog(null);
    };

    return (
        <div className="-mx-8 -my-6 flex flex-1">
            <QueryState query={goals} loading={<GoalListSkeleton />}>
                {(list) => {
                    const open = openGoal(list, search);
                    return (
                        <>
                            <GoalList
                                goals={list}
                                openId={open?.id ?? null}
                                onCreate={() => {
                                    setDialog({ mode: 'create' });
                                }}
                            />
                            <section aria-label="Detalhe da meta" className="flex min-w-0 flex-1 flex-col gap-5 px-8 py-6">
                                {open === null ? (
                                    <EmptyState title="Nenhuma meta" description="Crie uma meta em “+ Nova meta” e vincule a ela as receitas e transferências que guardam dinheiro para o objetivo." />
                                ) : (
                                    <GoalDetail
                                        key={open.id}
                                        goal={open}
                                        onEdit={() => {
                                            setDialog({ mode: 'edit', goal: open });
                                        }}
                                        onDelete={() => {
                                            setDialog({ mode: 'delete', goal: open });
                                        }}
                                    />
                                )}
                            </section>
                        </>
                    );
                }}
            </QueryState>
            {dialog?.mode === 'create' && (
                <GoalDialog
                    goal={null}
                    onClose={close}
                    onCreated={(created) => {
                        void navigate({ to: '/goals', search: { goal: created.id } });
                    }}
                />
            )}
            {dialog?.mode === 'edit' && <GoalDialog key={dialog.goal.id} goal={dialog.goal} onClose={close} />}
            {dialog?.mode === 'delete' && <DeleteGoalDialog goal={dialog.goal} onClose={close} />}
        </div>
    );
}

/**
 * Lista lateral: cada meta com o percentual, a barra e "quanto de quanto · prazo" (mockup).
 *
 * @param props.goals Metas do perfil, por nome.
 * @param props.openId Meta aberta, marcada na lista.
 * @param props.onCreate Abre o diálogo de nova meta.
 * @return A lista de metas.
 */
function GoalList({ goals, openId, onCreate }: { readonly goals: readonly GoalProgressResponse[]; readonly openId: string | null; readonly onCreate: () => void }): ReactNode {
    return (
        <section aria-label="Lista de metas" className="flex w-90 shrink-0 flex-col border-r border-line bg-surface">
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
                <h1 className="text-20 font-semibold">Metas</h1>
                <Button variant="outline" size="sm" className="text-13 font-normal" onClick={onCreate}>
                    + Nova meta
                </Button>
            </div>
            <ul aria-label="Metas">
                {goals.map((goal) => (
                    <li key={goal.id}>
                        <GoalLink goal={goal} current={goal.id === openId} />
                    </li>
                ))}
            </ul>
        </section>
    );
}

/**
 * Item da lista.
 *
 * @param props.goal Meta com o progresso.
 * @param props.current Se é a meta aberta.
 * @return O link que abre o detalhe da meta.
 */
function GoalLink({ goal, current }: { readonly goal: GoalProgressResponse; readonly current: boolean }): ReactNode {
    const item = describeGoalListItem(goal);
    return (
        <Link
            to="/goals"
            search={{ goal: goal.id }}
            aria-current={current ? 'page' : undefined}
            className={cn(
                'flex flex-col gap-2 border-t border-line2 px-5 py-3.5 text-ink hover:bg-surface2',
                current && 'bg-soft shadow-[inset_3px_0_0_var(--color-accent)] hover:bg-soft',
            )}
        >
            <span className="flex items-center justify-between gap-3 text-14">
                <span className={cn('truncate', current && 'font-semibold')}>{goal.name}</span>
                <span className="font-semibold tabular-nums">{item.percentText}</span>
            </span>
            <ProgressBar ratio={item.barRatio} className="h-1.5 rounded-3" />
            <span className="text-12 text-muted tabular-nums">{item.summary}</span>
        </Link>
    );
}

/**
 * Detalhe da meta aberta: cabeçalho com as ações, progresso, os três números, a projeção e a
 * tabela das transações que contam.
 *
 * @param props.goal Meta aberta.
 * @param props.onEdit Abre "Editar meta".
 * @param props.onDelete Abre a confirmação de exclusão.
 * @return O detalhe.
 */
function GoalDetail({ goal, onEdit, onDelete }: { readonly goal: GoalProgressResponse; readonly onEdit: () => void; readonly onDelete: () => void }): ReactNode {
    const item = describeGoalListItem(goal);
    const projection = goalProjectionNote(goal);
    const pending = goalPendingNote(goal);
    return (
        <>
            <header className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                    <span className="text-12 text-muted">Meta de economia</span>
                    <h2 className="flex items-center gap-2 text-22 font-semibold">
                        {goal.name}
                        {goal.reached && <StatusTag tone="neutral">Atingida</StatusTag>}
                    </h2>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="lg" className="px-3.5 font-normal" onClick={onEdit}>
                        Editar meta
                    </Button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="icon-lg" aria-label="Mais ações">
                                ⋯
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                                Excluir meta…
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </header>
            <section aria-label="Progresso" className="flex flex-col gap-2.5 rounded-10 border border-line bg-surface p-5">
                <div className="flex items-baseline justify-between gap-4">
                    <span className="text-28 font-semibold tabular-nums">
                        {formatMoney(goal.saved)} <span className="text-16 font-normal text-muted">de {formatMoney(goal.value)}</span>
                    </span>
                    <span className="text-20 font-semibold tabular-nums">{item.percentText}</span>
                </div>
                <ProgressBar ratio={item.barRatio} className="h-2.5 rounded-6" />
            </section>
            <section aria-label="Prazo e ritmo" className="grid grid-cols-3 gap-4">
                {goalFigures(goal).map((figure) => (
                    <Figure key={figure.label} figure={figure} />
                ))}
            </section>
            {projection !== null && (
                <p role="note" className="rounded-8 bg-soft px-3 py-2.5 text-13 text-soft-ink">
                    {projection}
                </p>
            )}
            <Contributions goal={goal} pendingNote={pending} />
        </>
    );
}

/**
 * Barra de progresso. Decorativa: o percentual ao lado já diz o mesmo em texto.
 *
 * @param props.ratio Preenchimento entre 0 e 1.
 * @param props.className Altura e raio, que mudam entre a lista e o detalhe.
 * @return A barra.
 */
function ProgressBar({ ratio, className }: { readonly ratio: number; readonly className: string }): ReactNode {
    return (
        <span aria-hidden="true" className={cn('block overflow-hidden bg-track', className)}>
            <span className="block h-full bg-accent" style={{ width: `${String(ratio * 100)}%` }} />
        </span>
    );
}

/**
 * Um dos três números do detalhe (`.kpi` do mockup).
 *
 * @param props.figure Rótulo, valor e nota já montados pelo `goalFigures`.
 * @return O cartão do número.
 */
function Figure({ figure }: { readonly figure: GoalFigure }): ReactNode {
    return (
        <div className="flex flex-col gap-1.5 rounded-10 border border-line bg-surface p-4">
            <span className="text-13 text-muted">{figure.label}</span>
            <span className="text-22 font-semibold tabular-nums">{figure.value}</span>
            <span className="text-12 text-muted">{figure.note}</span>
        </div>
    );
}

/**
 * Tabela "Transações vinculadas" (mockup): as que contam no progresso, com o total, que é o
 * próprio progresso. Contas, cartões e categorias só dão nome às linhas.
 *
 * @param props.goal Meta aberta.
 * @param props.pendingNote Frase sobre as vinculadas que ainda não contam, ou `null`.
 * @return A tabela.
 */
function Contributions({ goal, pendingNote }: { readonly goal: GoalProgressResponse; readonly pendingNote: string | null }): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const contributions = useGoalContributions({ id: goal.id });
    const accounts = useAccounts({ profileId: profile.id, period });
    const creditCards = useCreditCards({ profileId: profile.id, period });
    const categories = useCategoryTree({ profileId: profile.id });

    return (
        <section aria-label="Transações vinculadas" className="overflow-hidden rounded-10 border border-line bg-surface text-13">
            <div className="flex items-center justify-between px-4 py-3.5">
                <h3 className="text-16 font-semibold">Transações vinculadas</h3>
                <span className="text-12 text-muted">O progresso é a soma delas</span>
            </div>
            <QueryState query={contributions} loading={<Skeleton className="m-4 h-24" />}>
                {(list) => (
                    <QueryState query={accounts} loading={<Skeleton className="m-4 h-24" />}>
                        {(accountList) => (
                            <QueryState query={creditCards} loading={<Skeleton className="m-4 h-24" />}>
                                {(cardList) => (
                                    <QueryState query={categories} loading={<Skeleton className="m-4 h-24" />}>
                                        {(tree) => (
                                            <ContributionTable
                                                rows={buildGoalContributionRows({ contributions: list, accounts: accountList.accounts, creditCards: cardList.creditCards, categories: tree })}
                                                total={formatMoney(goal.saved)}
                                            />
                                        )}
                                    </QueryState>
                                )}
                            </QueryState>
                        )}
                    </QueryState>
                )}
            </QueryState>
            {pendingNote !== null && <p className="border-t border-line2 bg-surface2 px-4 py-2.5 text-12 text-muted">{pendingNote}</p>}
        </section>
    );
}

/**
 * @param props.rows Linhas montadas pelo view-model.
 * @param props.total Progresso formatado, para a linha de total.
 * @return A tabela, ou a frase da meta sem transação que conte.
 */
function ContributionTable({ rows, total }: { readonly rows: readonly GoalContributionRow[]; readonly total: string }): ReactNode {
    if (rows.length === 0) {
        return <p className="border-t border-line2 px-4 py-6 text-center text-muted">Nenhuma transação paga vinculada ainda. Vincule receitas ou transferências pelo campo “Meta” do lançamento.</p>;
    }
    return (
        <Table className="text-13">
            <TableHeader className="bg-surface2">
                <TableRow className="border-line hover:bg-transparent">
                    <TableHead className="w-16 pl-4 text-12 font-normal text-muted">Data</TableHead>
                    <TableHead className="text-12 font-normal text-muted">Nome</TableHead>
                    <TableHead className="text-12 font-normal text-muted">Categoria › Sub</TableHead>
                    <TableHead className="text-12 font-normal text-muted">Conta</TableHead>
                    <TableHead className="pr-4 text-right text-12 font-normal text-muted">Valor</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {rows.map((row) => (
                    <TableRow key={row.id} className="border-line2">
                        <TableCell className="pl-4 tabular-nums">{row.date}</TableCell>
                        <TableCell className="whitespace-normal">
                            <span className="flex flex-wrap items-center gap-2">
                                {row.name}
                                {row.refund && <StatusTag tone="neutral">estorno</StatusTag>}
                            </span>
                        </TableCell>
                        <TableCell className="whitespace-normal text-ink2">{row.category}</TableCell>
                        <TableCell className="whitespace-normal">{row.account}</TableCell>
                        <TableCell className="pr-4 text-right tabular-nums">{row.amountText}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
            <TableFooter className="bg-surface2">
                <TableRow className="border-line font-semibold hover:bg-transparent">
                    <TableCell />
                    <TableCell>Total</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell className="pr-4 text-right tabular-nums">{total}</TableCell>
                </TableRow>
            </TableFooter>
        </Table>
    );
}

/**
 * @return O esqueleto da lista enquanto as metas carregam, com o mesmo desenho dela.
 */
function GoalListSkeleton(): ReactNode {
    return (
        <section aria-label="Lista de metas" className="flex w-90 shrink-0 flex-col gap-3 border-r border-line bg-surface p-5">
            <h1 className="text-20 font-semibold">Metas</h1>
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
        </section>
    );
}
