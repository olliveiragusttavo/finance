import {
    categoryShares,
    formatDate,
    markedPaidMessage,
    overviewAccounts,
    overviewCardRows,
    overviewGoalRow,
    overviewKpis,
    overviewNextInvoicesKpi,
    overviewNotes,
    overviewSpendingKpis,
    pendingBadge,
    pendingPanel,
    spendingChart,
    goalInView,
    useAccounts,
    useCoreMutation,
    useCreditCards,
    useGoals,
    useNextInvoices,
    useNotes,
    useOverviewPending,
    useOverviewSpending,
    type CategoryShareRow,
    type OverviewAccountRow,
    type OverviewCardRow,
    type OverviewKpi,
    type OverviewKpiTone,
    type OverviewNotes,
    type PendingPanel,
    type PendingRow,
    type SpendingChart,
} from '@finance/client';
import type { GoalProgressResponse } from '@finance/core';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ProgressBar } from '@/components/ProgressBar';
import { EmptyState, QueryState, Skeleton } from '@/components/states';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { StatusTag } from '@/components/entityUi';
import { cn } from '@/lib/cn';
import { useActiveProfile } from '@/shell/activeProfile';
import { useReferenceMonth } from '@/shell/useReferenceMonth';

/**
 * Visão geral (mockup `DesktopVisaoGeral2`, que substituiu o `Main`): o selo de atrasados ao lado
 * do título, cinco indicadores, os gastos dos seis meses, para onde foi o dinheiro do mês e os
 * resumos de contas, cartões, metas e anotações. **Diverge do mockup** a pedido do usuário: a
 * lista "Próximos 30 dias" saiu, e o que está em aberto até o fim do mês mora no painel do selo.
 * Cada bloco tem a própria consulta e o próprio estado de carregando e de erro; os números e as
 * frases vêm do `overviewView` do `client`, que o celular também usa.
 *
 * @return A tela da Visão geral.
 */
export function OverviewScreen(): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const scope = { profileId: profile.id, period };

    return (
        <>
            <PendingHeader profileId={profile.id} />
            <OverviewKpis {...scope} currency={profile.currency} />
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <SpendingBlocks {...scope} />
            </div>
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <Panel title="Contas" hint="consolidado · previsto">
                    <AccountsSummary {...scope} />
                </Panel>
                <Panel title="Cartões" action={<PanelLink to="/cards">Faturas →</PanelLink>}>
                    <CardsSummary {...scope} />
                </Panel>
                <div className="flex flex-col gap-4">
                    <Panel title="Metas" action={<PanelLink to="/goals">Todas →</PanelLink>}>
                        <GoalsSummary {...scope} />
                    </Panel>
                    <Panel title="Anotações" action={<PanelLink to="/notes">Todas →</PanelLink>}>
                        <NotesSummary profileId={profile.id} />
                    </Panel>
                </div>
            </div>
        </>
    );
}

/** Perfil e mês de referência, a entrada das consultas que seguem a barra do mês. */
interface MonthScope {
    readonly profileId: string;
    readonly period: string;
}

/** O último lançamento marcado pelo painel, para o "Desfazer". */
interface MarkedPaid {
    readonly transactionId: string;
    readonly message: string;
}

/**
 * Título, selo de atrasados e o dia de hoje. O dia vem do núcleo (`overview.pending`), o mesmo
 * relógio que decide o que está atrasado, para que "hoje" e "há N dias" nunca discordem.
 * Regra de negócio (Visão geral): marcar pelo painel grava o pagamento com a data de hoje
 * (`transactions.setPaid`); o "Desfazer" volta o lançamento a pendente, como estava.
 *
 * @param props.profileId Perfil ativo.
 * @return A linha do título.
 */
function PendingHeader({ profileId }: { readonly profileId: string }): ReactNode {
    const pending = useOverviewPending({ profileId });
    const setPaid = useCoreMutation('transactions.setPaid');
    const [open, setOpen] = useState(false);
    const [marked, setMarked] = useState<MarkedPaid | null>(null);

    /**
     * @param row Linha marcada no painel.
     * @param transactionId Lançamento a marcar.
     */
    const markPaid = (row: PendingRow, transactionId: string): void => {
        const today = pending.data?.today;
        setPaid.mutate(
            { id: transactionId, paid: true },
            {
                onSuccess: () => {
                    setMarked({ transactionId, message: today === undefined ? '' : markedPaidMessage(row, today) });
                },
                onError: (error) => {
                    toast.error(error.message);
                },
            },
        );
    };

    /** Volta o último lançamento marcado a pendente. */
    const undo = (): void => {
        if (marked === null) {
            return;
        }
        setPaid.mutate(
            { id: marked.transactionId, paid: false },
            {
                onSuccess: () => {
                    setMarked(null);
                },
                onError: (error) => {
                    toast.error(error.message);
                },
            },
        );
    };

    const data = pending.data;
    const badge = data === undefined ? null : pendingBadge(data);
    return (
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3.5">
                <h1 className="text-24 font-semibold">Visão geral</h1>
                {pending.isPending && <Skeleton className="h-7.5 w-56 rounded-full" />}
                {pending.isError && <span className="text-13 text-muted">Não foi possível ver os atrasados.</span>}
                {data !== undefined && badge !== null && (
                    <Popover open={open && badge.opens} onOpenChange={setOpen}>
                        <PopoverTrigger asChild>
                            <button
                                type="button"
                                disabled={!badge.opens}
                                className={cn(
                                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-13 font-medium tabular-nums disabled:cursor-default',
                                    badge.tone === 'warn' ? 'border-warn-ink bg-warn-bg text-warn-ink' : 'border-ok-ink bg-ok-bg text-ok-ink',
                                )}
                            >
                                <span aria-hidden="true">{badge.tone === 'warn' ? '⚠' : '✓'}</span>
                                <span>{badge.title}</span>
                                {badge.detail !== null && <span className="opacity-80">· {badge.detail}</span>}
                                {badge.opens && <span aria-hidden="true">{open ? '▴' : '▾'}</span>}
                            </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-130 max-w-[calc(100vw-2rem)] overflow-hidden p-0" aria-label="Lançamentos atrasados e em aberto">
                            <PendingPanelBody panel={pendingPanel(data)} busy={setPaid.isPending} onMarkPaid={markPaid} onNavigate={() => { setOpen(false); }} />
                        </PopoverContent>
                    </Popover>
                )}
                {marked !== null && (
                    <span role="status" className="inline-flex items-center gap-1.5 text-12 text-muted tabular-nums">
                        <span>{marked.message}</span>
                        <button type="button" onClick={undo} disabled={setPaid.isPending} className="rounded-6 px-1.5 py-1 text-12 text-accent hover:bg-soft">
                            Desfazer
                        </button>
                    </span>
                )}
            </div>
            {data !== undefined && <span className="text-12 text-muted">Hoje, {formatDate(data.today)}</span>}
        </div>
    );
}

/**
 * O painel do selo: os atrasados e o que ainda vence até o fim do mês, cada grupo com o título.
 *
 * @param props.panel Linhas e rodapé já formatados.
 * @param props.busy Se uma marcação está em andamento, para não marcar duas vezes.
 * @param props.onMarkPaid Marca a linha como paga ou recebida.
 * @param props.onNavigate Fecha o painel ao seguir um link.
 * @return O conteúdo do painel.
 */
function PendingPanelBody({ panel, busy, onMarkPaid, onNavigate }: {
    readonly panel: PendingPanel;
    readonly busy: boolean;
    readonly onMarkPaid: (row: PendingRow, transactionId: string) => void;
    readonly onNavigate: () => void;
}): ReactNode {
    return (
        <div className="flex flex-col">
            {panel.overdue.length > 0 && <PendingGroup title="Venceram e não foram marcados como pagos" rows={panel.overdue} busy={busy} onMarkPaid={onMarkPaid} onNavigate={onNavigate} />}
            {panel.upcoming.length > 0 && <PendingGroup title="Em aberto até o fim do mês" rows={panel.upcoming} busy={busy} onMarkPaid={onMarkPaid} onNavigate={onNavigate} />}
            <div className="flex items-center justify-between gap-3 bg-surface2 px-3.5 py-2.5 text-12">
                <span className="text-muted tabular-nums">{panel.footer}</span>
                <Link to="/transactions" search={{ situation: 'pending' }} onClick={onNavigate} className="text-accent hover:text-soft-ink">
                    Ver pendentes →
                </Link>
            </div>
        </div>
    );
}

/**
 * Um grupo do painel.
 *
 * @param props.title Título do grupo, também o nome da lista.
 * @param props.rows Linhas do grupo.
 * @param props.busy Se uma marcação está em andamento.
 * @param props.onMarkPaid Marca a linha.
 * @param props.onNavigate Fecha o painel ao seguir um link.
 * @return O grupo.
 */
function PendingGroup({ title, rows, busy, onMarkPaid, onNavigate }: {
    readonly title: string;
    readonly rows: readonly PendingRow[];
    readonly busy: boolean;
    readonly onMarkPaid: (row: PendingRow, transactionId: string) => void;
    readonly onNavigate: () => void;
}): ReactNode {
    return (
        <section aria-label={title}>
            <h2 className="border-b border-line px-3.5 py-2.5 text-13 font-semibold">{title}</h2>
            <ul>
                {rows.map((row) => (
                    <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-line2 px-3.5 py-2.5 text-13 tabular-nums">
                        <span className="flex min-w-0 flex-col">
                            <span className="truncate font-medium">{row.name}</span>
                            <span className="truncate text-12 text-muted">
                                {row.date} · <span className={cn(row.overdue && 'font-semibold text-warn-ink')}>{row.when}</span> · {row.where}
                            </span>
                        </span>
                        <span className={cn('whitespace-nowrap font-semibold', TONE_TEXT[row.tone])}>{row.value}</span>
                        <PendingActionButton row={row} busy={busy} onMarkPaid={onMarkPaid} onNavigate={onNavigate} />
                    </li>
                ))}
            </ul>
        </section>
    );
}

/** Cor do valor pelo sentido; o sinal e o ⇄ já dizem o mesmo sem a cor (decisão de interface 7). */
const TONE_TEXT: Readonly<Record<PendingRow['tone'], string>> = {
    in: 'text-in',
    out: 'text-out',
    transfer: 'text-ink',
};

/** Classe dos botões de ação do painel. */
const ACTION_CLASS = 'rounded-8 border border-line bg-surface px-2.5 py-1 text-12 text-ink hover:border-accent hover:text-accent disabled:opacity-60';

/**
 * A ação de uma linha: marcar, abrir a fatura ou nada — a transferência que chega de outro perfil
 * só aparece, e a coluna fica vazia para as linhas continuarem alinhadas.
 *
 * @param props.row Linha do painel.
 * @param props.busy Se uma marcação está em andamento.
 * @param props.onMarkPaid Marca a linha.
 * @param props.onNavigate Fecha o painel ao seguir o link da fatura.
 * @return O botão, o link ou um espaço vazio.
 */
function PendingActionButton({ row, busy, onMarkPaid, onNavigate }: {
    readonly row: PendingRow;
    readonly busy: boolean;
    readonly onMarkPaid: (row: PendingRow, transactionId: string) => void;
    readonly onNavigate: () => void;
}): ReactNode {
    const action = row.action;
    if (action === null) {
        return <span className="text-12 text-muted" title="Transferência de outro perfil: marque no perfil de origem.">de outro perfil</span>;
    }
    if (action.kind === 'openInvoice') {
        return (
            <Link to="/cards" search={{ card: action.creditCardId, invoice: action.period }} onClick={onNavigate} className={ACTION_CLASS}>
                {action.label}
            </Link>
        );
    }
    return (
        <button type="button" disabled={busy} className={ACTION_CLASS} aria-label={`${action.label}: ${row.name}`} onClick={() => { onMarkPaid(row, action.transactionId); }}>
            {action.label}
        </button>
    );
}

/**
 * Os cinco indicadores: saldo consolidado (com o previsto) e patrimônio, da lista de contas;
 * gastos e entradas do mês, do resumo de gastos; e as próximas faturas. Cada fonte tem o próprio
 * carregando, para que um bloco lento não esconda os outros.
 *
 * @param props.profileId Perfil ativo.
 * @param props.period Mês de referência.
 * @param props.currency Moeda do perfil, para o total sem fatura.
 * @return A fileira de indicadores.
 */
function OverviewKpis({ profileId, period, currency }: MonthScope & { readonly currency: string }): ReactNode {
    const accounts = useAccounts({ profileId, period });
    const spending = useOverviewSpending({ profileId, period });
    const next = useNextInvoices({ profileId });
    return (
        <section aria-label="Indicadores" className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-5">
            <QueryState query={accounts} loading={<KpiSkeletons count={2} />}>
                {(list) => {
                    const kpis = overviewKpis(list);
                    return (
                        <>
                            <KpiCard kpi={kpis.balance} />
                            <KpiCard kpi={kpis.netWorth} />
                        </>
                    );
                }}
            </QueryState>
            <QueryState query={spending} loading={<KpiSkeletons count={2} />}>
                {(summary) => overviewSpendingKpis(summary).map((kpi) => <KpiCard key={kpi.label} kpi={kpi} />)}
            </QueryState>
            <QueryState query={next} loading={<KpiSkeletons count={1} />}>
                {(invoices) => <KpiCard kpi={overviewNextInvoicesKpi(invoices, currency)} />}
            </QueryState>
        </section>
    );
}

/**
 * @param props.count Quantos indicadores estão carregando.
 * @return Os esqueletos, com a altura dos cartões.
 */
function KpiSkeletons({ count }: { readonly count: number }): ReactNode {
    return Array.from({ length: count }, (_, index) => <Skeleton key={index} className="h-24 rounded-10" />);
}

/** Classe de cada tom de indicador; entradas e gastos levam também a seta no rótulo. */
const KPI_TONES: Readonly<Record<OverviewKpiTone, string>> = {
    strong: 'text-ink',
    in: 'text-in',
    out: 'text-out',
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
        <div role="group" aria-label={kpi.label} className="flex min-w-0 flex-col gap-1 rounded-10 border border-line bg-surface px-4.5 py-3.5">
            <span className="text-13 text-muted">{kpi.label}</span>
            <span className={cn('truncate text-24 font-semibold tabular-nums', KPI_TONES[kpi.tone])}>{kpi.value}</span>
            <span className="text-12 text-muted tabular-nums">{kpi.sub}</span>
        </div>
    );
}

/**
 * "Gastos por mês" e "Para onde foi no mês", da mesma consulta. Sem links para relatórios: o
 * resumo é próprio da Visão geral (pedido do usuário).
 *
 * @param props.profileId Perfil ativo.
 * @param props.period Mês de referência.
 * @return Os dois blocos.
 */
function SpendingBlocks({ profileId, period }: MonthScope): ReactNode {
    const spending = useOverviewSpending({ profileId, period });
    const loading = <Skeleton className="h-72 rounded-10" />;
    return (
        <QueryState query={spending} loading={<>{loading}{loading}</>}>
            {(summary) => {
                const shares = categoryShares(summary);
                return (
                    <>
                        <Panel title="Gastos por mês" hint="despesas da conta e dos cartões" divided={false}>
                            <SpendingBars chart={spendingChart(summary)} />
                        </Panel>
                        <Panel title={shares.title} divided={false}>
                            {shares.rows.length === 0 ? (
                                <p className="px-5 pb-4 text-13 text-muted">Nenhum gasto neste mês.</p>
                            ) : (
                                <ul aria-label="Categorias" className="flex flex-col pb-3">
                                    {shares.rows.map((row) => (
                                        <CategoryShare key={row.categoryId ?? row.name} row={row} />
                                    ))}
                                    {shares.others !== null && <CategoryShare row={shares.others} />}
                                </ul>
                            )}
                        </Panel>
                    </>
                );
            }}
        </QueryState>
    );
}

/** Espaço do rótulo de valor acima de cada barra, descontado da altura disponível para a barra. */
const BAR_LABEL_SPACE = '1.5rem';

/**
 * Barras dos seis meses com a linha tracejada da média. É uma imagem para o leitor de tela, com
 * todos os valores na descrição, porque as barras sozinhas não dizem nada sem a vista. O valor da
 * média fica numa legenda embaixo, e não sobre a linha como no mockup: sobre a linha ele cobria a
 * barra do mês de referência sempre que a média passava por ela.
 *
 * @param props.chart Barras, média e descrição já calculadas.
 * @return O gráfico.
 */
function SpendingBars({ chart }: { readonly chart: SpendingChart }): ReactNode {
    return (
        <div className="px-4.5 pb-3.5">
            <div role="img" aria-label={chart.description} className="relative mt-2 grid h-50 grid-cols-6 items-end gap-4.5 border-b border-line">
                {chart.average !== null && (
                    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 border-t-[1.5px] border-dashed border-muted" style={{ bottom: `calc(${String(chart.average.ratio)} * (100% - ${BAR_LABEL_SPACE}))` }} />
                )}
                {chart.bars.map((bar) => (
                    <div key={bar.period} aria-hidden="true" className="flex h-full flex-col items-center justify-end gap-1.5">
                        <span className={cn('relative z-1 bg-surface px-1 text-12 tabular-nums', bar.current ? 'font-semibold text-ink' : 'text-muted')}>{bar.value}</span>
                        <div className={cn('w-full max-w-16 rounded-t-4', bar.current ? 'bg-accent' : 'bg-accent/30')} style={{ height: `calc(${String(bar.ratio)} * (100% - ${BAR_LABEL_SPACE}))` }} />
                    </div>
                ))}
            </div>
            <div aria-hidden="true" className="mt-1.5 grid grid-cols-6 gap-4.5 text-center text-12 text-muted">
                {chart.bars.map((bar) => (
                    <span key={bar.period} className={cn(bar.current && 'font-semibold text-ink')}>{bar.label}</span>
                ))}
            </div>
            {chart.average !== null && (
                <div aria-hidden="true" className="mt-2 flex items-center justify-end gap-2 text-11 text-muted tabular-nums">
                    <span className="w-6 border-t-[1.5px] border-dashed border-muted" />
                    <span>{chart.average.text}</span>
                </div>
            )}
        </div>
    );
}

/**
 * Uma categoria com o valor, a participação e a barra; a linha das outras categorias vem sem
 * barra e esmaecida.
 *
 * @param props.row Linha já formatada.
 * @return A linha.
 */
function CategoryShare({ row }: { readonly row: CategoryShareRow }): ReactNode {
    const others = row.categoryId === null;
    return (
        <li className="flex flex-col gap-1.5 px-4.5 py-1.5">
            <span className={cn('flex justify-between gap-3 text-13', others && 'text-muted')}>
                <span className="truncate">{row.name}</span>
                <span className="whitespace-nowrap tabular-nums">
                    {row.amount} <span className="text-muted">· {row.share}</span>
                </span>
            </span>
            {!others && <ProgressBar ratio={row.barRatio} className="h-2 rounded-4" fill="out" />}
        </li>
    );
}

/**
 * Moldura dos blocos: título, a dica do que os números são (ou um link) e o conteúdo.
 *
 * @param props.title Título do bloco, também o nome da região.
 * @param props.hint O que os valores representam.
 * @param props.action Link do cabeçalho, no lugar da dica.
 * @param props.divided Se o cabeçalho tem a linha embaixo; os gráficos ficam sem ela, como no mockup.
 * @param props.children O conteúdo ou o estado dele.
 * @return O bloco.
 */
function Panel({ title, hint, action, divided = true, children }: {
    readonly title: string;
    readonly hint?: string;
    readonly action?: ReactNode;
    readonly divided?: boolean;
    readonly children: ReactNode;
}): ReactNode {
    return (
        <section aria-label={title} className="min-w-0 overflow-hidden rounded-10 border border-line bg-surface">
            <div className={cn('flex items-center justify-between gap-2.5 px-4.5 pt-3.5 pb-2.5', divided && 'border-b border-line2')}>
                <h2 className="text-15 font-semibold">{title}</h2>
                {action ?? (hint !== undefined && <span className="text-12 text-muted">{hint}</span>)}
            </div>
            {children}
        </section>
    );
}

/**
 * Link do cabeçalho de um bloco para a tela completa.
 *
 * @param props.to Tela de destino.
 * @param props.children Texto do link.
 * @return O link.
 */
function PanelLink({ to, children }: { readonly to: '/cards' | '/goals' | '/notes'; readonly children: ReactNode }): ReactNode {
    return (
        <Link to={to} className="text-12 text-accent hover:text-soft-ink">
            {children}
        </Link>
    );
}

/** Classe comum das linhas dos resumos, que levam ao detalhe na tela própria. */
const SUMMARY_ROW = 'flex items-center justify-between gap-3 px-4.5 py-2.5 text-13 text-ink hover:bg-surface2';

/**
 * Resumo de contas, compacto: as do total, com o previsto embaixo; a zerada esmaecida e com um
 * valor só; as fora do total num grupo próprio; e o total do saldo no rodapé.
 *
 * @param props.profileId Perfil ativo.
 * @param props.period Mês de referência.
 * @return As listas de contas.
 */
function AccountsSummary({ profileId, period }: MonthScope): ReactNode {
    const accounts = useAccounts({ profileId, period });
    return (
        <QueryState query={accounts} loading={<PanelRowsSkeleton />}>
            {(list) => {
                const summary = overviewAccounts(list);
                return (
                    <>
                        <AccountList label="Contas no saldo" rows={summary.inTotal} />
                        {summary.outsideTotal.length > 0 && (
                            <>
                                <div className="border-t border-line2 px-4.5 pt-2.5 pb-1 text-11 font-semibold tracking-wide text-muted uppercase">Fora do total</div>
                                <AccountList label="Contas fora do total" rows={summary.outsideTotal} />
                            </>
                        )}
                        <div className="flex justify-between border-t border-line bg-surface2 px-4.5 py-2.5 text-13 tabular-nums">
                            <span className="text-muted">Total no saldo</span>
                            <b>{summary.total}</b>
                        </div>
                    </>
                );
            }}
        </QueryState>
    );
}

/**
 * @param props.label Nome da lista, para o leitor de tela.
 * @param props.rows Contas já formatadas.
 * @return A lista; cada linha leva ao extrato do mês da conta, na tela Contas.
 */
function AccountList({ label, rows }: { readonly label: string; readonly rows: readonly OverviewAccountRow[] }): ReactNode {
    return (
        <ul aria-label={label}>
            {rows.map((row) => (
                <li key={row.accountId} className="border-t border-line2 first:border-t-0">
                    <Link to="/accounts" search={{ account: row.accountId }} className={cn(SUMMARY_ROW, row.empty && 'text-muted')}>
                        <span className="flex min-w-0 flex-col">
                            <span className="flex items-center gap-2">
                                <span className={cn('truncate', !row.empty && 'font-medium')}>{row.name}</span>
                                {row.disabled && <StatusTag tone="warn">Desativada</StatusTag>}
                            </span>
                            {!row.empty && <span className="text-12 text-muted">{row.detail}</span>}
                        </span>
                        {row.projected === null ? (
                            <span className="shrink-0 tabular-nums">{row.consolidated}</span>
                        ) : (
                            <span className="flex shrink-0 flex-col items-end">
                                <span className="font-semibold tabular-nums">{row.consolidated}</span>
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
 * Resumo de cartões: a fatura do mês de referência e a próxima em aberto de cada um. Cada cartão
 * leva à tela Cartões; as contas só dão nome à conta que paga.
 *
 * @param props.profileId Perfil ativo.
 * @param props.period Mês de referência.
 * @return A lista de cartões, ou o aviso de que o perfil não tem cartão.
 */
function CardsSummary({ profileId, period }: MonthScope): ReactNode {
    const creditCards = useCreditCards({ profileId, period });
    const accounts = useAccounts({ profileId, period });
    const next = useNextInvoices({ profileId });
    return (
        <QueryState query={creditCards} loading={<PanelRowsSkeleton />}>
            {(list) => {
                if (list.creditCards.length === 0) {
                    return (
                        <div className="px-4.5 py-4">
                            <EmptyState title="Nenhum cartão" description="Cadastre um cartão para acompanhar as faturas aqui." action={<Link to="/cards">Ir para Cartões</Link>} />
                        </div>
                    );
                }
                return <CardsList rows={overviewCardRows(list, accounts.data?.accounts ?? [], next.data ?? null)} />;
            }}
        </QueryState>
    );
}

/**
 * @param props.rows Cartões já formatados.
 * @return A lista de cartões, cada um com as linhas das faturas.
 */
function CardsList({ rows }: { readonly rows: readonly OverviewCardRow[] }): ReactNode {
    return (
        <ul aria-label="Cartões">
            {rows.map((row) => (
                <li key={row.creditCardId} className="border-t border-line2 first:border-t-0">
                    <Link to="/cards" search={{ card: row.creditCardId }} className="flex flex-col gap-2 px-4.5 py-3 text-13 text-ink hover:bg-surface2">
                        <span className="flex items-center justify-between gap-3">
                            <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate font-medium">{row.name}</span>
                                {row.disabled && <StatusTag tone="warn">Desativado</StatusTag>}
                            </span>
                            <span className="truncate text-12 text-muted">{row.payer}</span>
                        </span>
                        {row.invoices.map((invoice) => (
                            <span key={invoice.period} className="flex items-center justify-between gap-3">
                                <span className="text-12 text-muted">{invoice.label}</span>
                                <span className="flex items-center gap-2">
                                    {invoice.status !== null && (
                                        <span className={cn('rounded-full px-2 py-0.5 text-11', invoice.status.tone === 'warn' ? 'bg-warn-bg text-warn-ink' : 'bg-ok-bg text-ok-ink')}>{invoice.status.text}</span>
                                    )}
                                    <span className={cn('tabular-nums', invoice.next && 'font-semibold')}>{invoice.amount}</span>
                                </span>
                            </span>
                        ))}
                    </Link>
                </li>
            ))}
        </ul>
    );
}

/**
 * Resumo das metas ativas: nome, percentual, barra, "quanto de quanto · prazo", o ritmo
 * necessário e o alerta de prazo vencido; cada linha leva ao detalhe na tela Metas.
 * Regra de negócio (Metas, desktop-mvp-plan Fase 9.3): o guardado soma as vinculadas pagas até
 * hoje, o mesmo número da tela Metas. Só as **ativas** entram (Fase 13.4) — as mesmas da
 * visualização padrão da tela Metas (`goalInView`).
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
                    <div className="px-4.5 py-4">
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
    const row = overviewGoalRow(goal);
    return (
        <Link to="/goals" search={{ goal: goal.id }} className="flex flex-col gap-1.5 px-4.5 py-3 text-13 text-ink hover:bg-surface2">
            <span className="flex items-center justify-between gap-3">
                <span className="truncate font-medium">{goal.name}</span>
                <span className="flex items-center gap-2">
                    {row.overdue && <span className="rounded-full bg-warn-bg px-2 py-0.5 text-11 text-warn-ink">Prazo vencido</span>}
                    <span className="font-semibold tabular-nums">{row.percentText}</span>
                </span>
            </span>
            <ProgressBar ratio={row.barRatio} className="h-1.5 rounded-3" />
            <span className="text-12 text-muted tabular-nums">{row.summary}</span>
            {row.pace !== null && <span className="text-12 text-muted tabular-nums">{row.pace}</span>}
        </Link>
    );
}

/**
 * Títulos das anotações mais recentes: o clique abre a anotação no editor da tela Anotações, e o
 * "Ver todas" leva às outras.
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
                    <p className="px-4.5 py-3 text-13 text-muted">
                        Nenhuma anotação. <Link to="/notes" className="text-accent">Ir para Anotações</Link>
                    </p>
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
                            <span className="truncate">{row.title}</span>
                            <span aria-hidden="true" className="text-muted">›</span>
                        </Link>
                    </li>
                ))}
            </ul>
            {notes.hiddenCount > 0 && (
                <Link to="/notes" className="block border-t border-line2 px-4.5 py-2.5 text-13 text-accent hover:bg-surface2">
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
        <div role="status" aria-busy="true" aria-label="Carregando" className="flex flex-col gap-3 px-4.5 py-4">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
        </div>
    );
}
