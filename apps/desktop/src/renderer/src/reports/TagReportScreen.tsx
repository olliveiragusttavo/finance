import {
    buildTagDetail,
    buildTagList,
    buildTagTransactionList,
    formatMoney,
    openTag,
    tagContainers,
    useAccounts,
    useCategoryTree,
    useCreditCards,
    useTagReport,
    useTags,
    useTagTransactions,
    type TagDetailView,
    type TagKpi,
    type TagListItem,
} from '@finance/client';
import { TAG_REPORT_RANGES, type TagReportRange, type TagReportResponse, type TagSummaryResponse } from '@finance/core';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { Bar, BarChart, ReferenceLine, XAxis, YAxis } from 'recharts';
import { DetailPane, ListPane, NestedPanes } from '@/components/PaneLayout';
import { EmptyState, QueryState, Skeleton } from '@/components/states';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ViewToggle } from '@/components/ViewToggle';
import { cn } from '@/lib/cn';
import { useActiveProfile } from '@/shell/activeProfile';
import { useReferenceMonth } from '@/shell/useReferenceMonth';
import { DEFAULT_TAG_RANGE, parseTagReportSearch, withTagRange } from './tagReportSearch.ts';

/** Rótulo de cada período no seletor, na ordem de `TAG_REPORT_RANGES`. */
const RANGE_LABELS: Readonly<Record<TagReportRange, string>> = {
    all: 'Todo o período',
    month: 'Só o mês de referência',
};

/**
 * Por tag (mockup `DesktopRelTag`, D8; desktop-mvp-plan Fase 12.2): à esquerda as tags com o total
 * líquido do período, à direita a tag aberta — indicadores, divisão por categoria e lançamentos.
 * A tag e o período ficam na URL (`tag`, `range`).
 * Regra de negócio (Relatórios, T1–T5): o total de uma tag é despesas menos receitas, pelo mês do
 * pagamento; "Todo o período" inclui as parcelas futuras. A tela só arruma o que o núcleo agregou,
 * pelo `tagReport` do `client` (desktop-mvp-plan §3.5).
 * A lista das tags é mais estreita que a do mockup porque divide a página com a lista de
 * relatórios (`ReportsLayout`).
 *
 * @return A tela do relatório por tag.
 */
export function TagReportScreen(): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const navigate = useNavigate();
    // Lida pelo `parseTagReportSearch`, e não pelo tipo da rota: a tela é importada pelo roteador.
    const search = useSearch({ strict: false, select: (raw: Readonly<Record<string, unknown>>) => parseTagReportSearch(raw) });
    const range = search.range ?? DEFAULT_TAG_RANGE;
    const report = useTagReport({ profileId: profile.id, period, range });
    // Só para saber se o perfil tem alguma tag: o estado vazio muda conforme a resposta.
    const tags = useTags({ profileId: profile.id });

    /**
     * @param value Período escolhido no seletor; o `Select` devolve texto, e só um dos períodos é
     * aceito.
     */
    const changeRange = (value: string): void => {
        const chosen = TAG_REPORT_RANGES.find((candidate) => candidate === value);
        if (chosen !== undefined) {
            void navigate({ to: '/reports/tag', search: (current: Readonly<Record<string, unknown>>) => withTagRange(current, chosen) });
        }
    };

    return (
        <NestedPanes>
            <ListPane
                label="Lista de tags"
                width="w-60"
                header={
                    <div className="flex flex-col gap-2.5 px-5 pt-5 pb-3">
                        <div className="flex flex-col gap-1">
                            <span className="text-12 text-muted">Relatórios</span>
                            <h1 className="text-20 font-semibold">Por tag</h1>
                        </div>
                        <label className="flex flex-col gap-1 text-13">
                            <span className="text-muted">Período</span>
                            <Select value={range} onValueChange={changeRange}>
                                <SelectTrigger aria-label="Período" className="w-full bg-surface">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {TAG_REPORT_RANGES.map((option) => (
                                        <SelectItem key={option} value={option}>
                                            {RANGE_LABELS[option]}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </label>
                    </div>
                }
            >
                <QueryState query={report} loading={<Skeleton className="mx-5 h-40" />}>
                    {(data) => <TagList items={buildTagList(data)} openId={openTag(data, search.tag)?.tagId ?? null} />}
                </QueryState>
            </ListPane>
            <DetailPane label="Tag aberta">
                <QueryState query={report} loading={<DetailSkeleton />}>
                    {(data) => <TagReportBody report={data} tagId={search.tag} range={range} hasTags={(tags.data?.length ?? 1) > 0} />}
                </QueryState>
            </DetailPane>
        </NestedPanes>
    );
}

/**
 * Lista lateral das tags com lançamento no período, pelo total líquido (T3).
 *
 * @param props.items Itens prontos do `client`.
 * @param props.openId Tag aberta, marcada na lista.
 * @return A lista.
 */
function TagList({ items, openId }: { readonly items: readonly TagListItem[]; readonly openId: string | null }): ReactNode {
    if (items.length === 0) {
        return null;
    }
    return (
        <>
            <div aria-hidden="true" className="flex justify-between px-5 py-2 text-12 text-muted">
                <span>Tag</span>
                <span>total</span>
            </div>
            <ul aria-label="Tags">
                {items.map((item) => {
                    const current = item.tagId === openId;
                    return (
                        <li key={item.tagId}>
                            <Link
                                to="/reports/tag"
                                search={(previous: Readonly<Record<string, unknown>>) => ({ ...previous, tag: item.tagId })}
                                aria-current={current ? 'page' : undefined}
                                className={cn(
                                    'flex items-center justify-between gap-3 border-t border-line2 px-5 py-3 text-ink hover:bg-surface2',
                                    current && 'bg-soft shadow-[inset_3px_0_0_var(--color-accent)] hover:bg-soft',
                                )}
                            >
                                <span className="flex min-w-0 flex-col">
                                    <span className={cn('truncate text-14', current && 'font-semibold')}>{item.name}</span>
                                    <span className="text-12 text-muted">{item.detail}</span>
                                </span>
                                <span className="shrink-0 text-14 font-semibold tabular-nums">{item.amount}</span>
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </>
    );
}

/**
 * O lado direito: a tag aberta, ou o estado vazio — perfil sem tag leva a Cadastros; com tag mas
 * sem lançamento no período, o mês de referência sugere olhar o período todo.
 *
 * @param props.report Relatório do núcleo.
 * @param props.tagId Tag pedida pela URL.
 * @param props.range Período do relatório.
 * @param props.hasTags Se o perfil tem alguma tag cadastrada.
 * @return O detalhe da tag ou o estado vazio.
 */
function TagReportBody({ report, tagId, range, hasTags }: { readonly report: TagReportResponse; readonly tagId: string | undefined; readonly range: TagReportRange; readonly hasTags: boolean }): ReactNode {
    const tag = openTag(report, tagId);
    if (tag === null) {
        return hasTags ? (
            <EmptyState
                title="Nenhuma tag com lançamentos"
                description={range === 'month' ? 'Nenhum lançamento com tag pesa no mês de referência. Escolha "Todo o período" para ver as tags de outros meses.' : 'Marque lançamentos com tags para ver aqui quanto cada uma soma.'}
                action={<Link to="/transactions">Ir para Transações</Link>}
            />
        ) : (
            <EmptyState title="Nenhuma tag" description="Crie tags em Cadastros e marque os lançamentos para ver quanto cada uma soma." action={<Link to="/registry" search={{ kind: 'tags' }}>Ir para Tags</Link>} />
        );
    }
    return <TagDetail key={`${tag.tagId}:${range}`} tag={tag} range={range} />;
}

/**
 * Detalhe da tag aberta. Busca os lançamentos aqui porque o indicador de lançamentos ("em 2 contas
 * e 1 cartão") e a lista vêm deles.
 *
 * @param props.tag Tag aberta, do relatório do núcleo.
 * @param props.range Período do relatório.
 * @return Indicadores, divisão por categoria e lançamentos.
 */
function TagDetail({ tag, range }: { readonly tag: TagSummaryResponse; readonly range: TagReportRange }): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const transactions = useTagTransactions({ profileId: profile.id, period, range, tagId: tag.tagId });
    const detail = buildTagDetail(tag, range, transactions.data === undefined ? null : tagContainers(transactions.data));

    return (
        <>
            <h2 className="text-20 font-semibold">{detail.name}</h2>
            <section aria-label="Indicadores" className="grid grid-cols-3 gap-4">
                <KpiCard kpi={detail.kpis.total} />
                <KpiCard kpi={detail.kpis.count} />
                <KpiCard kpi={detail.kpis.categories} />
            </section>
            <CategoryPanel detail={detail} currency={profile.currency} />
            <TransactionsSection tagId={tag.tagId} range={range} query={transactions} />
        </>
    );
}

/**
 * Um indicador: rótulo, valor e a explicação curta embaixo, num grupo nomeado para que o leitor
 * de tela leia o rótulo junto do número.
 *
 * @param props.kpi Indicador já formatado.
 * @return O cartão do indicador.
 */
function KpiCard({ kpi }: { readonly kpi: TagKpi }): ReactNode {
    return (
        <div role="group" aria-label={kpi.label} className="flex flex-col gap-1.5 rounded-10 border border-line bg-surface p-4">
            <span className="text-13 text-muted">{kpi.label}</span>
            <span className="text-22 font-semibold tabular-nums">{kpi.value}</span>
            <span className="text-12 text-muted">{kpi.sub}</span>
        </div>
    );
}

/** Como a divisão por categoria aparece: a tabela do mockup ou o gráfico equivalente. */
type CategoryMode = 'table' | 'chart';

/** Altura de cada linha do gráfico. */
const CHART_ROW_HEIGHT = 40;

/**
 * Divisão por categoria, com a alternância Tabela/Gráfico dos outros relatórios. O mockup abre na
 * tabela, com a barra da participação, e oferece o gráfico ("Ver como gráfico").
 *
 * @param props.detail Detalhe pronto do `client`.
 * @param props.currency Moeda do perfil, para a dica do gráfico.
 * @return O bloco por categoria.
 */
function CategoryPanel({ detail, currency }: { readonly detail: TagDetailView; readonly currency: string }): ReactNode {
    const [mode, setMode] = useState<CategoryMode>('table');
    return (
        <section aria-labelledby="tag-categories-title" className="overflow-hidden rounded-10 border border-line bg-surface">
            <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                <h2 id="tag-categories-title" className="text-16 font-semibold">
                    Por categoria
                </h2>
                <div role="group" aria-label="Exibição" className="flex gap-1">
                    <ViewToggle pressed={mode === 'table'} onClick={() => { setMode('table'); }}>
                        Tabela
                    </ViewToggle>
                    <ViewToggle pressed={mode === 'chart'} onClick={() => { setMode('chart'); }}>
                        Gráfico
                    </ViewToggle>
                </div>
            </div>
            {mode === 'table' ? <CategoryTable detail={detail} /> : <CategoryChart detail={detail} currency={currency} />}
        </section>
    );
}

/**
 * Tabela por categoria: total líquido, participação em barra e em percentual (T4). A categoria
 * sem gasto líquido não tem barra, e o valor dela sai como entrada (`+`).
 *
 * @param props.detail Detalhe pronto do `client`.
 * @return A tabela.
 */
function CategoryTable({ detail }: { readonly detail: TagDetailView }): ReactNode {
    return (
        <Table aria-label={`Categorias de ${detail.name}`} className="text-13">
            <TableHeader>
                <TableRow className="bg-surface2 hover:bg-surface2">
                    <TableHead className="px-4">Categoria</TableHead>
                    <TableHead className="w-2/5">Participação</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="w-16 px-4 text-right">%</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {detail.categories.map((category) => (
                    <TableRow key={category.categoryId} className="border-line2 tabular-nums">
                        <TableCell className="px-4">{category.name}</TableCell>
                        <TableCell>
                            <span aria-hidden="true" className="block h-2 overflow-hidden rounded-4 bg-track">
                                <span className="block h-full rounded-4 bg-accent" style={{ width: `${String(Math.round((category.share ?? 0) * 1000) / 10)}%` }} />
                            </span>
                        </TableCell>
                        <TableCell className="text-right">{category.amount}</TableCell>
                        <TableCell className="px-4 text-right">{category.percent}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
            <TableFooter className="bg-surface2">
                <TableRow className="font-semibold tabular-nums hover:bg-surface2">
                    <TableCell className="px-4">Total</TableCell>
                    <TableCell />
                    <TableCell className="text-right">{detail.total.amount}</TableCell>
                    <TableCell className="px-4 text-right">{detail.total.percent}</TableCell>
                </TableRow>
            </TableFooter>
        </Table>
    );
}

/**
 * Barras horizontais do total líquido de cada categoria, na mesma cor de destaque dos outros
 * relatórios. A categoria em que as receitas superam as despesas desenha a barra para a esquerda
 * do zero; os valores exatos ficam na dica e na tabela.
 *
 * @param props.detail Detalhe pronto do `client`.
 * @param props.currency Moeda do perfil.
 * @return O gráfico.
 */
function CategoryChart({ detail, currency }: { readonly detail: TagDetailView; readonly currency: string }): ReactNode {
    const series = { chartAmount: { label: 'Total líquido', color: 'accent' } } as const satisfies ChartConfig;
    return (
        <div className="px-4 pb-4">
            <ChartContainer
                config={series}
                className="aspect-auto"
                style={{ height: detail.categories.length * CHART_ROW_HEIGHT + 8 }}
                role="img"
                aria-label={`Gráfico das categorias de ${detail.name}; os valores estão na tabela`}
            >
                <BarChart layout="vertical" data={[...detail.categories]} barCategoryGap="25%" margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                    <XAxis type="number" hide domain={detail.hasNegative ? ['auto', 'auto'] : [0, 'auto']} />
                    <YAxis type="category" dataKey="name" width={140} tickLine={false} axisLine={false} interval={0} className="text-13" />
                    {detail.hasNegative && <ReferenceLine x={0} stroke="var(--color-line)" />}
                    <ChartTooltip cursor={{ fill: 'var(--color-track)' }} content={(props) => <ChartTooltipContent {...props} formatValue={(amount) => formatMoney({ amount, currency })} />} />
                    <Bar dataKey="chartAmount" fill="var(--color-chartAmount)" radius={[0, 3, 3, 0]} isAnimationActive={false} />
                </BarChart>
            </ChartContainer>
        </div>
    );
}

/**
 * Lançamentos da tag no período, com o total líquido e o link que abre Transações filtrada pela
 * tag no mês de referência — a tela de Transações é mensal, então em "Todo o período" o link
 * mostra só o mês.
 *
 * @param props.tagId Tag aberta.
 * @param props.range Período do relatório, que decide a data das linhas.
 * @param props.query Consulta dos lançamentos, compartilhada com o indicador.
 * @return A lista com o total.
 */
function TransactionsSection({ tagId, range, query }: { readonly tagId: string; readonly range: TagReportRange; readonly query: ReturnType<typeof useTagTransactions> }): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const accounts = useAccounts({ profileId: profile.id, period });
    const creditCards = useCreditCards({ profileId: profile.id, period });
    const categories = useCategoryTree({ profileId: profile.id });
    const tags = useTags({ profileId: profile.id });

    return (
        <section aria-labelledby="tag-transactions-title" className="overflow-hidden rounded-10 border border-line bg-surface">
            <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                <h2 id="tag-transactions-title" className="text-16 font-semibold">
                    Lançamentos com esta tag
                </h2>
                <Link to="/transactions" search={{ tag: tagId }} className="text-13 text-accent hover:text-soft-ink">
                    Abrir em Transações →
                </Link>
            </div>
            <QueryState query={query} loading={<Skeleton className="mx-4 mb-4 h-32" />}>
                {(data) => {
                    if (accounts.data === undefined || creditCards.data === undefined || categories.data === undefined || tags.data === undefined) {
                        return <Skeleton className="mx-4 mb-4 h-32" />;
                    }
                    const list = buildTagTransactionList(data, range, {
                        profileId: profile.id,
                        accounts: accounts.data.accounts,
                        creditCards: creditCards.data.creditCards,
                        categories: categories.data,
                        tags: tags.data,
                    });
                    return (
                        <Table aria-label="Lançamentos com esta tag" className="text-13">
                            <TableHeader>
                                <TableRow className="bg-surface2 hover:bg-surface2">
                                    <TableHead className={cn('px-4', range === 'all' ? 'w-24' : 'w-16')}>Data</TableHead>
                                    <TableHead>Nome</TableHead>
                                    <TableHead>Categoria › Sub</TableHead>
                                    <TableHead>Conta / fatura</TableHead>
                                    <TableHead className="px-4 text-right">Valor</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {list.rows.map((row) => (
                                    <TableRow key={row.id} className="border-line2">
                                        <TableCell className="px-4 tabular-nums">{row.date}</TableCell>
                                        <TableCell>{row.name}</TableCell>
                                        <TableCell className="text-ink2">{row.category}</TableCell>
                                        <TableCell>{row.container}</TableCell>
                                        <TableCell className={cn('px-4 text-right tabular-nums', row.direction === 'out' ? 'text-out' : row.direction === 'in' ? 'text-in' : 'text-ink2')}>{row.amountText}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                            <TableFooter className="bg-surface2">
                                <TableRow className="font-semibold hover:bg-surface2">
                                    <TableCell className="px-4" />
                                    <TableCell colSpan={3}>Total</TableCell>
                                    <TableCell className="px-4 text-right tabular-nums">{list.totalText}</TableCell>
                                </TableRow>
                            </TableFooter>
                        </Table>
                    );
                }}
            </QueryState>
        </section>
    );
}

/**
 * Esqueleto do detalhe: os três indicadores e os dois blocos.
 *
 * @return O esqueleto marcado como ocupado.
 */
function DetailSkeleton(): ReactNode {
    return (
        <div role="status" aria-busy="true" aria-label="Carregando relatório" className="flex flex-col gap-5">
            <div className="grid grid-cols-3 gap-4">
                {[0, 1, 2].map((index) => (
                    <Skeleton key={index} className="h-26.5 rounded-10" />
                ))}
            </div>
            <Skeleton className="h-60 rounded-10" />
        </div>
    );
}
