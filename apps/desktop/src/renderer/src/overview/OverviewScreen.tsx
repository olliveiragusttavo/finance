import {
    balanceEvolutionRows,
    formatMoney,
    overviewAccountRows,
    overviewCardRows,
    overviewKpis,
    topCategories,
    useAccounts,
    useBalanceEvolution,
    useCategoryReport,
    useCreditCards,
    useMonthSummary,
    type BalanceEvolutionRow,
    type OverviewAccountRow,
    type OverviewCardRow,
    type OverviewKpi,
    type OverviewKpiTone,
} from '@finance/client';
import type { XAxisTickContentProps } from 'recharts';
import { Bar, BarChart, ReferenceLine, XAxis, YAxis } from 'recharts';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { EmptyState, QueryState, Skeleton } from '@/components/states';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { StatusTag } from '@/registry/registryUi';
import { useActiveProfile } from '@/shell/activeProfile';
import { useReferenceMonth } from '@/shell/useReferenceMonth';

/**
 * Visão geral (mockup `Main`, D2; desktop-mvp-plan Fase 10): os indicadores do mês, a evolução
 * do saldo, as maiores categorias e os resumos de contas e cartões. Cada bloco tem a própria
 * consulta e o próprio estado de carregando e de erro, para que um relatório lento não segure a
 * tela inteira; os números e as frases vêm do `overviewView` do `client`, que o celular também
 * usa.
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
            <div className="grid grid-cols-3 gap-4">
                <BalanceEvolution profileId={profile.id} period={period} currency={profile.currency} />
                <TopCategories profileId={profile.id} period={period} />
            </div>
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
        </>
    );
}

/** Perfil e mês de referência, a entrada de toda consulta da tela. */
interface MonthScope {
    readonly profileId: string;
    readonly period: string;
}

/**
 * Os cinco indicadores. Dependem de duas consultas — o total das contas e o resumo do mês —, e
 * só aparecem com as duas, para que a fileira não se monte aos pedaços.
 *
 * @param props.profileId Perfil ativo.
 * @param props.period Mês de referência.
 * @return A fileira de indicadores.
 */
function OverviewKpis({ profileId, period }: MonthScope): ReactNode {
    const accounts = useAccounts({ profileId, period });
    const summary = useMonthSummary({ profileId, period });
    const loading = (
        <div role="status" aria-busy="true" aria-label="Carregando indicadores" className="grid grid-cols-5 gap-4">
            {[0, 1, 2, 3, 4].map((index) => (
                <Skeleton key={index} className="h-26.5 rounded-10" />
            ))}
        </div>
    );
    return (
        <QueryState query={accounts} loading={loading}>
            {(list) => (
                <QueryState query={summary} loading={loading}>
                    {(month) => {
                        const kpis = overviewKpis(list, month);
                        return (
                            <section aria-label="Indicadores" className="grid grid-cols-5 gap-4">
                                <KpiCard kpi={kpis.consolidated} />
                                <KpiCard kpi={kpis.projected} />
                                <KpiCard kpi={kpis.income} />
                                <KpiCard kpi={kpis.expenses} />
                                <KpiCard kpi={kpis.openInvoices} />
                            </section>
                        );
                    }}
                </QueryState>
            )}
        </QueryState>
    );
}

/**
 * Classe de cada tom de indicador. O previsto tem peso menor que o consolidado (decisão de
 * interface 6 dos mockups); entrada e saída têm cor, mas o sinal e a seta do rótulo já as
 * distinguem (decisão 7).
 */
const KPI_TONES: Readonly<Record<OverviewKpiTone, string>> = {
    strong: 'font-semibold text-ink',
    projected: 'text-ink2',
    in: 'font-semibold text-in',
    out: 'font-semibold text-out',
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

/** Como a evolução do saldo aparece: o gráfico ou a tabela equivalente. */
type EvolutionView = 'chart' | 'table';

/**
 * Séries do gráfico. As duas usam o `accent`: o previsto se distingue pelo contorno tracejado,
 * e não por outra cor, como no mockup — a diferença não depende só da cor.
 */
const EVOLUTION_SERIES = {
    consolidated: { label: 'Consolidado', color: 'accent' },
    projected: { label: 'Previsto', color: 'accent' },
} as const satisfies ChartConfig;

/**
 * Evolução do saldo: consolidado e previsto do perfil no fim de cada um dos 6 meses até o de
 * referência (reports-design §5), com a alternância Gráfico/Tabela do mockup. A tabela é a
 * mesma informação do gráfico, para quem não lê o gráfico (desktop-mvp-plan §2, Gráficos).
 *
 * @param props.profileId Perfil ativo.
 * @param props.period Mês de referência.
 * @param props.currency Moeda do perfil, para formatar o valor da dica do gráfico.
 * @return O bloco da evolução do saldo.
 */
function BalanceEvolution({ profileId, period, currency }: MonthScope & { readonly currency: string }): ReactNode {
    // A quantidade de meses é a padrão do núcleo, a do mockup.
    const evolution = useBalanceEvolution({ profileId, period });
    const [view, setView] = useState<EvolutionView>('chart');
    return (
        <section aria-labelledby="overview-evolution" className="col-span-2 flex flex-col gap-3.5 rounded-10 border border-line bg-surface p-5">
            <div className="flex items-center justify-between">
                <h2 id="overview-evolution" className="text-16 font-semibold">
                    Evolução do saldo
                </h2>
                <div role="group" aria-label="Exibição" className="flex gap-1">
                    <ViewToggle pressed={view === 'chart'} onClick={() => { setView('chart'); }}>
                        Gráfico
                    </ViewToggle>
                    <ViewToggle pressed={view === 'table'} onClick={() => { setView('table'); }}>
                        Tabela
                    </ViewToggle>
                </div>
            </div>
            <QueryState query={evolution} loading={<Skeleton className="h-65" />}>
                {(data) => {
                    const rows = balanceEvolutionRows(data);
                    return view === 'chart' ? <EvolutionChart rows={rows} currency={currency} /> : <EvolutionTable rows={rows} />;
                }}
            </QueryState>
        </section>
    );
}

/**
 * Botão da alternância Gráfico/Tabela. `aria-pressed`, e não abas, porque as duas opções
 * mostram o mesmo conteúdo de dois jeitos.
 *
 * @param props.pressed Se é a opção escolhida.
 * @param props.onClick Escolhe a opção.
 * @param props.children Rótulo.
 * @return O botão.
 */
function ViewToggle({ pressed, onClick, children }: { readonly pressed: boolean; readonly onClick: () => void; readonly children: string }): ReactNode {
    return (
        <button
            type="button"
            aria-pressed={pressed}
            onClick={onClick}
            className={cn(
                'rounded-6 border px-2.5 py-1.25 text-13 outline-none focus-visible:ring-[3px] focus-visible:ring-accent/50',
                pressed ? 'border-accent bg-soft text-soft-ink' : 'border-line bg-surface text-ink hover:bg-surface2',
            )}
        >
            {children}
        </button>
    );
}

/**
 * Gráfico de barras agrupadas: consolidado cheio e previsto tracejado, lado a lado por mês, com
 * o mês de referência em destaque no eixo. Sem eixo de valores, como no mockup: o valor exato
 * está na dica e na tabela. A linha do zero aparece quando algum saldo fica negativo.
 *
 * @param props.rows Meses da série, já formatados.
 * @param props.currency Moeda do perfil.
 * @return A legenda e o gráfico.
 */
function EvolutionChart({ rows, currency }: { readonly rows: readonly BalanceEvolutionRow[]; readonly currency: string }): ReactNode {
    const negative = rows.some((row) => row.consolidated < 0 || row.projected < 0);
    return (
        <>
            <div className="flex gap-4 text-12 text-muted">
                <span className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="size-3 rounded-2 bg-accent" />
                    Consolidado
                </span>
                <span className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="size-3 rounded-2 border-[1.5px] border-dashed border-accent" />
                    Previsto
                </span>
            </div>
            <ChartContainer config={EVOLUTION_SERIES} className="aspect-auto h-60" role="img" aria-label="Gráfico da evolução do saldo; os valores estão na tabela">
                <BarChart data={[...rows]} barGap={6} barCategoryGap="20%" margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                    <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--color-line)' }} interval={0} tick={(props: XAxisTickContentProps) => <EvolutionTick {...props} rows={rows} />} />
                    <YAxis hide domain={negative ? ['auto', 'auto'] : [0, 'auto']} />
                    {negative && <ReferenceLine y={0} stroke="var(--color-line)" />}
                    <ChartTooltip
                        cursor={{ fill: 'var(--color-track)' }}
                        content={(props) => <ChartTooltipContent {...props} formatValue={(amount) => formatMoney({ amount, currency })} />}
                    />
                    <Bar dataKey="consolidated" fill="var(--color-consolidated)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    <Bar dataKey="projected" fill="transparent" stroke="var(--color-projected)" strokeWidth={1.5} strokeDasharray="4 3" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
            </ChartContainer>
        </>
    );
}

/**
 * Rótulo do eixo dos meses: só o mês abreviado, com o de referência em destaque — o ano está
 * na dica e na tabela.
 *
 * @param props.x Posição horizontal calculada pelo Recharts.
 * @param props.y Posição vertical calculada pelo Recharts.
 * @param props.payload Item do eixo; o índice aponta a linha da série.
 * @param props.rows Meses da série.
 * @return O texto do rótulo.
 */
function EvolutionTick({ x, y, payload, rows }: XAxisTickContentProps & { readonly rows: readonly BalanceEvolutionRow[] }): ReactNode {
    const row = rows[payload.index];
    return (
        <text x={x} y={y} dy={14} textAnchor="middle" className={cn('text-12', row?.isReference === true ? 'fill-ink font-semibold' : 'fill-muted')}>
            {row?.axisLabel}
        </text>
    );
}

/**
 * Tabela equivalente ao gráfico, com o mês de referência em destaque.
 *
 * @param props.rows Meses da série, já formatados.
 * @return A tabela.
 */
function EvolutionTable({ rows }: { readonly rows: readonly BalanceEvolutionRow[] }): ReactNode {
    return (
        <Table aria-label="Evolução do saldo">
            <TableHeader>
                <TableRow>
                    <TableHead>Mês</TableHead>
                    <TableHead className="text-right">Consolidado</TableHead>
                    <TableHead className="text-right">Previsto</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {rows.map((row) => (
                    <TableRow key={row.period} aria-current={row.isReference ? 'date' : undefined} className={cn(row.isReference && 'font-semibold')}>
                        <TableCell>{row.label}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.consolidatedText}</TableCell>
                        <TableCell className="text-right text-ink2 tabular-nums">{row.projectedText}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}

/**
 * Maiores categorias de despesa do mês, lidas do relatório por categoria, com o link para ele.
 * A comparação é a padrão do relatório, para que a consulta seja a mesma que a tela do
 * relatório abre primeiro.
 *
 * @param props.profileId Perfil ativo.
 * @param props.period Mês de referência.
 * @return O bloco das maiores categorias.
 */
function TopCategories({ profileId, period }: MonthScope): ReactNode {
    const report = useCategoryReport({ profileId, period, comparison: 'previousMonth' });
    return (
        <section aria-labelledby="overview-top-categories" className="flex flex-col gap-3.5 rounded-10 border border-line bg-surface p-5">
            <h2 id="overview-top-categories" className="text-16 font-semibold">
                Maiores categorias
            </h2>
            <QueryState query={report} loading={<Skeleton className="h-40" />}>
                {(data) => {
                    const top = topCategories(data);
                    if (top.length === 0) {
                        return <p className="text-13 text-muted">Nenhuma despesa neste mês.</p>;
                    }
                    return (
                        <ul aria-label="Maiores categorias" className="flex flex-col gap-3.5">
                            {top.map((category) => (
                                <li key={category.categoryId} className="flex flex-col gap-1">
                                    <span className="flex justify-between gap-3 text-14">
                                        <span className="truncate">{category.name}</span>
                                        <span className="shrink-0 tabular-nums">{category.amount}</span>
                                    </span>
                                    <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-3 bg-track">
                                        <span className="block h-full rounded-3 bg-out" style={{ width: `${String(Math.round(category.barRatio * 1000) / 10)}%` }} />
                                    </span>
                                </li>
                            ))}
                        </ul>
                    );
                }}
            </QueryState>
            <Link to="/reports/category" className="mt-auto text-13 text-accent hover:text-soft-ink">
                Abrir relatório por categoria →
            </Link>
        </section>
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
 * Esqueleto das listas de contas e cartões, com a altura de três linhas.
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
