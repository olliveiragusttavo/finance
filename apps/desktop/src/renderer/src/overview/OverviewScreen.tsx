import {
    describeGoalListItem,
    goalInView,
    overviewAccountRows,
    overviewCardRows,
    overviewKpis,
    overviewNotes,
    useAccounts,
    useCreditCards,
    useGoals,
    useNotes,
    type OverviewAccountRow,
    type OverviewCardRow,
    type OverviewKpi,
    type OverviewKpiTone,
    type OverviewNotes,
} from '@finance/client';
import type { GoalProgressResponse } from '@finance/core';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ProgressBar } from '@/components/ProgressBar';
import { EmptyState, QueryState, Skeleton } from '@/components/states';
import { cn } from '@/lib/cn';
import { StatusTag } from '@/components/entityUi';
import { useActiveProfile } from '@/shell/activeProfile';
import { useReferenceMonth } from '@/shell/useReferenceMonth';

/**
 * Visão geral (mockup `Main`, D2; desktop-mvp-plan Fase 10): os indicadores de saldo, os resumos
 * de contas e cartões e, desde a Fase 13.2 (pedido do usuário, sem mockup), o resumo das metas e
 * os títulos das anotações. Os indicadores de receitas, despesas e faturas, a evolução do saldo e
 * as maiores categorias saíram com os relatórios fixos (reports-design, Fase 15). Cada bloco tem a
 * própria consulta e o próprio estado de carregando e de erro; os números e as frases vêm do
 * `overviewView` do `client`, que o celular também usa.
 *
 * @return A tela da Visão geral.
 */
export function OverviewScreen(): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const accounts = useAccounts({ profileId: profile.id, period });

    return (
        <>
            <h1 className="text-24 font-semibold">Visão geral</h1>
            <OverviewKpis profileId={profile.id} period={period} />
            <div className="grid grid-cols-2 items-start gap-4">
                <Panel title="Contas" hint="consolidado · previsto">
                    <QueryState query={accounts} loading={<PanelRowsSkeleton />}>
                        {(list) => <AccountsSummary rows={overviewAccountRows(list.accounts)} />}
                    </QueryState>
                </Panel>
                <Panel title="Cartões" hint="fatura do mês de referência">
                    <CardsSummary profileId={profile.id} period={period} />
                </Panel>
            </div>
            <div className="grid grid-cols-2 items-start gap-4">
                <Panel title="Metas" hint="guardado até hoje · alvo">
                    <GoalsSummary profileId={profile.id} period={period} />
                </Panel>
                <Panel title="Anotações" hint="as mais recentes">
                    <NotesSummary profileId={profile.id} />
                </Panel>
            </div>
        </>
    );
}

/** Perfil e mês de referência, a entrada de toda consulta da tela. */
interface MonthScope {
    readonly profileId: string;
    readonly period: string;
}

/**
 * Os indicadores de saldo, do total da lista de contas — o mesmo número do rodapé de Contas.
 *
 * @param props.profileId Perfil ativo.
 * @param props.period Mês de referência.
 * @return A fileira de indicadores.
 */
function OverviewKpis({ profileId, period }: MonthScope): ReactNode {
    const accounts = useAccounts({ profileId, period });
    const loading = (
        <div role="status" aria-busy="true" aria-label="Carregando indicadores" className="grid grid-cols-2 gap-4">
            {[0, 1].map((index) => (
                <Skeleton key={index} className="h-26.5 rounded-10" />
            ))}
        </div>
    );
    return (
        <QueryState query={accounts} loading={loading}>
            {(list) => {
                const kpis = overviewKpis(list);
                return (
                    <section aria-label="Indicadores" className="grid grid-cols-2 gap-4">
                        <KpiCard kpi={kpis.consolidated} />
                        <KpiCard kpi={kpis.projected} />
                    </section>
                );
            }}
        </QueryState>
    );
}

/**
 * Classe de cada tom de indicador. O previsto tem peso menor que o consolidado (decisão de
 * interface 6 dos mockups).
 */
const KPI_TONES: Readonly<Record<OverviewKpiTone, string>> = {
    strong: 'font-semibold text-ink',
    projected: 'text-ink2',
};

/**
 * Um indicador: rótulo, valor e a explicação curta embaixo. O rótulo e o valor formam um
 * grupo nomeado, para que o leitor de tela leia "Saldo consolidado" junto do número.
 *
 * @param props.kpi Indicador já formatado.
 * @return O cartão do indicador.
 */
function KpiCard({ kpi }: { readonly kpi: OverviewKpi }): ReactNode {
    return (
        <div role="group" aria-label={kpi.label} className="flex flex-col gap-1.5 rounded-10 border border-line bg-surface p-4">
            <span className="text-13 text-muted">{kpi.label}</span>
            <span className={cn('text-24 tabular-nums', KPI_TONES[kpi.tone])}>{kpi.value}</span>
            <span className="text-12 text-muted">{kpi.sub}</span>
        </div>
    );
}

/**
 * Moldura dos resumos de contas e cartões: título, a dica do que os números são e a lista.
 *
 * @param props.title Título do bloco, também o nome da região.
 * @param props.hint O que os valores à direita representam.
 * @param props.children A lista ou o estado dela.
 * @return O bloco.
 */
function Panel({ title, hint, children }: { readonly title: string; readonly hint: string; readonly children: ReactNode }): ReactNode {
    return (
        <section aria-label={title} className="overflow-hidden rounded-10 border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                <h2 className="text-16 font-semibold">{title}</h2>
                <span className="text-12 text-muted">{hint}</span>
            </div>
            {children}
        </section>
    );
}

/** Classe comum das linhas dos resumos, que levam ao detalhe na tela própria. */
const SUMMARY_ROW = 'flex items-center justify-between gap-3 border-t border-line2 px-5 py-3 text-ink first:border-t-0 hover:bg-surface2';

/**
 * Resumo de contas: cada linha leva ao extrato do mês da conta, na tela Contas.
 *
 * @param props.rows Contas já formatadas.
 * @return A lista de contas.
 */
function AccountsSummary({ rows }: { readonly rows: readonly OverviewAccountRow[] }): ReactNode {
    return (
        <ul aria-label="Contas">
            {rows.map((row) => (
                <li key={row.accountId} className="border-t border-line2 first:border-t-0">
                    <Link to="/accounts" search={{ account: row.accountId }} className={cn(SUMMARY_ROW, 'border-t-0', row.outsideTotal && 'text-muted')}>
                        <span className="flex min-w-0 flex-col">
                            <span className="flex items-center gap-2 text-14">
                                <span className="truncate">{row.name}</span>
                                {row.disabled && <StatusTag tone="warn">Desativada</StatusTag>}
                            </span>
                            <span className="text-12 text-muted">{row.detail}</span>
                        </span>
                        {row.projected === null ? (
                            <span className="shrink-0 text-14 tabular-nums">{row.consolidated}</span>
                        ) : (
                            <span className="flex shrink-0 flex-col items-end">
                                <span className="text-14 font-semibold tabular-nums">{row.consolidated}</span>
                                <span className="text-12 text-muted tabular-nums">{row.projected}</span>
                            </span>
                        )}
                    </Link>
                </li>
            ))}
        </ul>
    );
}

/**
 * Resumo de cartões com a fatura do mês de referência: cada linha leva à fatura, na tela
 * Cartões. As contas só dão nome à conta que paga cada cartão.
 *
 * @param props.profileId Perfil ativo.
 * @param props.period Mês de referência.
 * @return A lista de cartões, ou o aviso de que o perfil não tem cartão.
 */
function CardsSummary({ profileId, period }: MonthScope): ReactNode {
    const creditCards = useCreditCards({ profileId, period });
    const accounts = useAccounts({ profileId, period });
    return (
        <QueryState query={creditCards} loading={<PanelRowsSkeleton />}>
            {(list) => {
                if (list.creditCards.length === 0) {
                    return (
                        <div className="px-5 py-4">
                            <EmptyState title="Nenhum cartão" description="Cadastre um cartão para acompanhar a fatura do mês aqui." action={<Link to="/cards">Ir para Cartões</Link>} />
                        </div>
                    );
                }
                return <CardsList rows={overviewCardRows(list, accounts.data?.accounts ?? [])} />;
            }}
        </QueryState>
    );
}

/**
 * @param props.rows Cartões já formatados.
 * @return A lista de cartões.
 */
function CardsList({ rows }: { readonly rows: readonly OverviewCardRow[] }): ReactNode {
    return (
        <ul aria-label="Cartões">
            {rows.map((row) => (
                <li key={row.creditCardId} className="border-t border-line2 first:border-t-0">
                    <Link to="/cards" search={{ card: row.creditCardId }} className={cn(SUMMARY_ROW, 'border-t-0')}>
                        <span className="flex min-w-0 flex-col">
                            <span className="flex items-center gap-2 text-14">
                                <span className="truncate">{row.name}</span>
                                {row.disabled && <StatusTag tone="warn">Desativado</StatusTag>}
                            </span>
                            <span className="text-12 text-muted">{row.detail}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-3">
                            {row.status !== null && (
                                <span className={cn('rounded-full px-2 py-0.5 text-12', row.status.tone === 'warn' ? 'bg-warn-bg text-warn-ink' : 'bg-ok-bg text-ok-ink')}>{row.status.text}</span>
                            )}
                            <span className="text-14 font-semibold tabular-nums">{row.amount}</span>
                        </span>
                    </Link>
                </li>
            ))}
        </ul>
    );
}

/**
 * Resumo das metas (desktop-mvp-plan Fase 13.2): nome, percentual, barra e "quanto de quanto ·
 * prazo", como na lista da tela Metas (`describeGoalListItem`), e cada linha leva ao detalhe.
 * Regra de negócio (Metas, desktop-mvp-plan Fase 9.3): o guardado soma as vinculadas pagas até
 * hoje, o mesmo número da tela Metas. Só as **ativas** entram (Fase 13.4, pedido do usuário) —
 * as mesmas da visualização padrão da tela Metas (`goalInView`): a atingida já não pede
 * acompanhamento, e a arquivada foi tirada de vista.
 *
 * @param props.profileId Perfil ativo.
 * @param props.period Mês de referência, de que o ritmo das metas depende.
 * @return A lista de metas, ou o aviso de que o perfil não tem meta.
 */
function GoalsSummary({ profileId, period }: MonthScope): ReactNode {
    const goals = useGoals({ profileId, period });
    return (
        <QueryState query={goals} loading={<PanelRowsSkeleton />}>
            {(all) => {
                const list = all.filter((goal) => goalInView(goal, 'active'));
                return list.length === 0 ? (
                    <div className="px-5 py-4">
                        {all.length === 0 ? (
                            <EmptyState title="Nenhuma meta" description="Crie uma meta para acompanhar quanto já guardou." action={<Link to="/goals">Ir para Metas</Link>} />
                        ) : (
                            <EmptyState title="Nenhuma meta ativa" description="As atingidas e as arquivadas estão na tela Metas." action={<Link to="/goals">Ir para Metas</Link>} />
                        )}
                    </div>
                ) : (
                    <ul aria-label="Metas">
                        {list.map((goal) => (
                            <li key={goal.id} className="border-t border-line2 first:border-t-0">
                                <GoalRow goal={goal} />
                            </li>
                        ))}
                    </ul>
                );
            }}
        </QueryState>
    );
}

/**
 * @param props.goal Meta com o progresso.
 * @return A linha que abre a meta na tela Metas.
 */
function GoalRow({ goal }: { readonly goal: GoalProgressResponse }): ReactNode {
    const item = describeGoalListItem(goal);
    return (
        <Link to="/goals" search={{ goal: goal.id }} className="flex flex-col gap-2 px-5 py-3 text-ink hover:bg-surface2">
            <span className="flex items-center justify-between gap-3 text-14">
                <span className="truncate">{goal.name}</span>
                <span className="font-semibold tabular-nums">{item.percentText}</span>
            </span>
            <ProgressBar ratio={item.barRatio} className="h-1.5 rounded-3" />
            <span className="text-12 text-muted tabular-nums">{item.summary}</span>
        </Link>
    );
}

/**
 * Títulos das anotações (desktop-mvp-plan Fase 13.2): só o nome de cada uma, e o clique abre a
 * anotação no editor da tela Anotações. Num perfil com muitas, mostra as mais recentes e
 * leva às outras pelo "Ver todas".
 *
 * @param props.profileId Perfil ativo.
 * @return A lista de títulos, ou o aviso de que o perfil não tem anotação.
 */
function NotesSummary({ profileId }: { readonly profileId: string }): ReactNode {
    const notes = useNotes({ profileId });
    return (
        <QueryState query={notes} loading={<PanelRowsSkeleton />}>
            {(list) =>
                list.length === 0 ? (
                    <div className="px-5 py-4">
                        <EmptyState title="Nenhuma anotação" description="Anote o que não cabe num lançamento." action={<Link to="/notes">Ir para Anotações</Link>} />
                    </div>
                ) : (
                    <NotesList notes={overviewNotes(list)} total={list.length} />
                )
            }
        </QueryState>
    );
}

/**
 * @param props.notes Títulos mostrados e quantos ficaram de fora.
 * @param props.total Quantas anotações o perfil tem, para o "Ver todas".
 * @return A lista de títulos.
 */
function NotesList({ notes, total }: { readonly notes: OverviewNotes; readonly total: number }): ReactNode {
    return (
        <>
            <ul aria-label="Anotações">
                {notes.rows.map((row) => (
                    <li key={row.noteId} className="border-t border-line2 first:border-t-0">
                        <Link to="/notes" search={{ note: row.noteId }} className={SUMMARY_ROW}>
                            <span className="truncate text-14">{row.title}</span>
                        </Link>
                    </li>
                ))}
            </ul>
            {notes.hiddenCount > 0 && (
                <Link to="/notes" className="block border-t border-line2 px-5 py-2.5 text-13 text-accent hover:bg-surface2">
                    Ver todas as {total} anotações
                </Link>
            )}
        </>
    );
}

/**
 * Esqueleto das listas dos blocos (contas, cartões, metas, anotações), com a altura de três linhas.
 *
 * @return O esqueleto marcado como ocupado.
 */
function PanelRowsSkeleton(): ReactNode {
    return (
        <div role="status" aria-busy="true" aria-label="Carregando" className="flex flex-col gap-3 px-5 py-4">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
        </div>
    );
}
