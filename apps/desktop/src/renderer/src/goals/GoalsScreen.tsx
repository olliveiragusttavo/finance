import {
    describeGoalFunding,
    describeGoalListItem,
    formatGoalListView,
    formatMoney,
    GOAL_LIST_VIEWS,
    goalFigures,
    goalPendingNote,
    goalProjectionNote,
    movementsFromGoalContributions,
    useAccounts,
    useCategoryTree,
    useCreditCards,
    useGoalContributions,
    useGoals,
    useRecurrences,
    type GoalFigure,
    type GoalListView,
    type MovementColumn,
} from '@finance/client';
import type { GoalProgressResponse } from '@finance/core';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { ListViewSwitch } from '@/components/ListViewSwitch';
import { DetailPane, ListPane, PaneLayout } from '@/components/PaneLayout';
import { ProgressBar } from '@/components/ProgressBar';
import { EmptyState, QueryState, Skeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/cn';
import { StatusTag } from '@/registry/registryUi';
import { useActiveProfile } from '@/shell/activeProfile';
import { useReferenceMonth } from '@/shell/useReferenceMonth';
import { MovementGrid } from '@/transactions/MovementGrid';
import { useTransactionActions } from '@/transactions/useTransactionActions';
import { DeleteGoalDialog, GoalDialog, useToggleGoalArchive } from './GoalDialogs.tsx';
import { goalListView, openGoal, parseGoalsSearch } from './goalsSearch.ts';

/** Diálogo aberto na tela: criar, editar ou excluir uma meta. */
type GoalDialogState = { readonly mode: 'create' } | { readonly mode: 'edit'; readonly goal: GoalProgressResponse } | { readonly mode: 'delete'; readonly goal: GoalProgressResponse };

/**
 * Metas (mockup `DesktopMetas`; desktop-mvp-plan Fase 9.3): à esquerda a lista com o progresso
 * de cada meta, à direita o detalhe da meta aberta — progresso, quanto falta, data-alvo, ritmo
 * necessário e as transações que contam. A meta aberta fica na URL (`goal`), como a conta em
 * Contas. O mês de referência só move o ritmo: o progresso é o que já foi pago até hoje. A lista
 * mostra por padrão só as ativas; as atingidas e as arquivadas ficam no seletor de visualização
 * (`view`, desktop-mvp-plan Fase 13.4).
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
    const toggleArchive = useToggleGoalArchive();
    const close = (): void => {
        setDialog(null);
    };

    return (
        <PaneLayout>
            <QueryState query={goals} loading={<GoalListSkeleton />}>
                {(list) => {
                    const { view, goals: visible } = goalListView(list, search);
                    const open = openGoal(list, search);
                    return (
                        <>
                            <GoalList
                                goals={visible}
                                view={view}
                                onViewChange={(next) => {
                                    void navigate({ to: '/goals', search: { view: next } });
                                }}
                                openId={open?.id ?? null}
                                onCreate={() => {
                                    setDialog({ mode: 'create' });
                                }}
                            />
                            <DetailPane label="Detalhe da meta">
                                {open === null ? (
                                    list.length === 0 ? (
                                        <EmptyState title="Nenhuma meta" description="Crie uma meta em “+ Nova meta” e vincule a ela as receitas e transferências que guardam dinheiro para o objetivo." />
                                    ) : (
                                        <EmptyState title={EMPTY_VIEW[view]} description="Troque a visualização na lista para ver as outras metas." />
                                    )
                                ) : (
                                    <GoalDetail
                                        key={open.id}
                                        goal={open}
                                        onEdit={() => {
                                            setDialog({ mode: 'edit', goal: open });
                                        }}
                                        onToggleArchive={() => {
                                            toggleArchive(open);
                                        }}
                                        onDelete={() => {
                                            setDialog({ mode: 'delete', goal: open });
                                        }}
                                    />
                                )}
                            </DetailPane>
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
        </PaneLayout>
    );
}

/** Frase da visualização sem meta, na lista e no detalhe. */
const EMPTY_VIEW: Readonly<Record<GoalListView, string>> = { active: 'Nenhuma meta ativa', reached: 'Nenhuma meta atingida', archived: 'Nenhuma meta arquivada' };

/**
 * Lista lateral: cada meta com o percentual, a barra e "quanto de quanto · prazo" (mockup).
 *
 * @param props.goals Metas da visualização escolhida, por nome.
 * @param props.view Visualização escolhida: ativas, atingidas ou arquivadas.
 * @param props.onViewChange Troca a visualização.
 * @param props.openId Meta aberta, marcada na lista.
 * @param props.onCreate Abre o diálogo de nova meta.
 * @return A lista de metas.
 */
function GoalList({
    goals,
    view,
    onViewChange,
    openId,
    onCreate,
}: {
    readonly goals: readonly GoalProgressResponse[];
    readonly view: GoalListView;
    readonly onViewChange: (view: GoalListView) => void;
    readonly openId: string | null;
    readonly onCreate: () => void;
}): ReactNode {
    return (
        <ListPane
            label="Lista de metas"
            width="w-90"
            header={
                <>
                    <div className="flex items-center justify-between px-5 pt-5 pb-3">
                        <h1 className="text-20 font-semibold">Metas</h1>
                        <Button variant="outline" size="sm" className="text-13 font-normal" onClick={onCreate}>
                            + Nova meta
                        </Button>
                    </div>
                    <ListViewSwitch views={GOAL_LIST_VIEWS} value={view} format={formatGoalListView} onChange={onViewChange} />
                </>
            }
        >
            {goals.length === 0 && <p className="px-5 py-3.5 text-13 text-muted">{EMPTY_VIEW[view]}.</p>}
            <ul aria-label="Metas">
                {goals.map((goal) => (
                    <li key={goal.id}>
                        <GoalLink goal={goal} current={goal.id === openId} />
                    </li>
                ))}
            </ul>
        </ListPane>
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
                <span className="flex min-w-0 items-center gap-2">
                    <span className={cn('truncate', current && 'font-semibold')}>{goal.name}</span>
                    {/* A atingida e arquivada aparece também em "Atingidas"; a etiqueta diz qual é. */}
                    {goal.archived && <StatusTag tone="warn">Arquivada</StatusTag>}
                </span>
                <span className="font-semibold tabular-nums">{item.percentText}</span>
            </span>
            <ProgressBar ratio={item.barRatio} className="h-1.5 rounded-3" />
            <span className="text-12 text-muted tabular-nums">{item.summary}</span>
        </Link>
    );
}

/**
 * Detalhe da meta aberta: cabeçalho com as ações, progresso, os três números, a projeção e a
 * tabela das transações que contam — ou, na meta vinculada a conta, de onde vem o saldo
 * (desktop-mvp-plan Fase 13.3).
 *
 * @param props.goal Meta aberta.
 * @param props.onEdit Abre "Editar meta".
 * @param props.onToggleArchive Arquiva a meta, ou a reativa quando já está arquivada.
 * @param props.onDelete Abre a confirmação de exclusão.
 * @return O detalhe.
 */
function GoalDetail({
    goal,
    onEdit,
    onToggleArchive,
    onDelete,
}: {
    readonly goal: GoalProgressResponse;
    readonly onEdit: () => void;
    readonly onToggleArchive: () => void;
    readonly onDelete: () => void;
}): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const accounts = useAccounts({ profileId: profile.id, period });
    const funding = describeGoalFunding(goal, accounts.data?.accounts ?? []);
    const item = describeGoalListItem(goal);
    const projection = goalProjectionNote(goal);
    const pending = goalPendingNote(goal);
    return (
        <>
            <header className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                    <span className="text-12 text-muted">Meta de economia · {funding}</span>
                    <h2 className="flex items-center gap-2 text-22 font-semibold">
                        {goal.name}
                        {goal.reached && <StatusTag tone="neutral">Atingida</StatusTag>}
                        {goal.archived && <StatusTag tone="warn">Arquivada</StatusTag>}
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
                            <DropdownMenuItem onSelect={onToggleArchive}>{goal.archived ? 'Reativar meta' : 'Arquivar meta'}</DropdownMenuItem>
                            <DropdownMenuSeparator />
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
            {goal.funding.kind === 'account' ? <AccountSource accountId={goal.funding.accountId} name={funding} /> : <Contributions goal={goal} pendingNote={pending} />}
        </>
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

/** Colunas das vinculadas: a conta importa (de onde veio o dinheiro guardado); a situação não, porque só as pagas contam. */
const CONTRIBUTION_COLUMNS: readonly MovementColumn[] = ['date', 'name', 'category', 'container', 'amount'];

/**
 * "Transações vinculadas" (mockup) na listagem comum de movimentos, com o total, que é o próprio
 * progresso. Editar, marcar pago e excluir funcionam como em Transações (pedido do usuário,
 * desktop-mvp-plan Fase 13.3): é aqui que se nota a vinculada errada. Contas, cartões e categorias
 * só dão nome às linhas.
 *
 * @param props.goal Meta aberta.
 * @param props.pendingNote Frase sobre as vinculadas que ainda não contam, ou `null`.
 * @return A listagem.
 */
function Contributions({ goal, pendingNote }: { readonly goal: GoalProgressResponse; readonly pendingNote: string | null }): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const contributions = useGoalContributions({ id: goal.id });
    const accounts = useAccounts({ profileId: profile.id, period });
    const creditCards = useCreditCards({ profileId: profile.id, period });
    const categories = useCategoryTree({ profileId: profile.id });
    const recurrences = useRecurrences({ profileId: profile.id });
    const actions = useTransactionActions();

    return (
        <section aria-label="Transações vinculadas" className="overflow-clip rounded-10 border border-line bg-surface text-13">
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
                                            <MovementGrid
                                                rows={movementsFromGoalContributions({
                                                    contributions: list,
                                                    accounts: accountList.accounts,
                                                    creditCards: cardList.creditCards,
                                                    categories: tree,
                                                    recurrences: recurrences.data ?? [],
                                                    profileId: profile.id,
                                                })}
                                                columns={CONTRIBUTION_COLUMNS}
                                                actions={actions}
                                                label="Transações vinculadas"
                                                empty={<p className="px-4 py-6 text-center text-muted">Nenhuma transação paga vinculada ainda. Vincule receitas ou transferências pelo campo “Meta” do lançamento.</p>}
                                                total={list.length === 0 ? undefined : { label: 'Total', amountText: formatMoney(goal.saved) }}
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
            {actions.dialogs}
        </section>
    );
}

/**
 * No lugar da tabela, na meta vinculada a conta: não há transações vinculadas — o progresso é o
 * saldo consolidado de hoje da conta (database-design §4.11) —, e o extrato dela explica cada
 * movimento.
 *
 * @param props.accountId Conta vinculada.
 * @param props.name "Saldo de Tesouro", o subtítulo do detalhe.
 * @return A nota com o link para o extrato.
 */
function AccountSource({ accountId, name }: { readonly accountId: string; readonly name: string }): ReactNode {
    return (
        <p role="note" className="flex flex-wrap items-center justify-between gap-2 rounded-10 border border-line bg-surface px-4 py-3.5 text-13 text-ink2">
            <span>{name}: o progresso é o saldo consolidado de hoje da conta, com tudo o que entrou e saiu dela.</span>
            <Link to="/accounts" search={{ account: accountId }} className="text-accent hover:text-soft-ink">
                Ver extrato da conta →
            </Link>
        </p>
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
