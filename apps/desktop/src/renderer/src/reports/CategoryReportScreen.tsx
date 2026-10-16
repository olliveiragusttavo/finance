import {
    buildCategoryReport,
    buildCategoryTransactionList,
    categoryBreadcrumb,
    categoryChart,
    comparisonOptions,
    formatMoney,
    openCategoryId,
    resolveCategorySelection,
    useAccounts,
    useCategoryReport,
    useCategoryTransactions,
    useCategoryTree,
    useCreditCards,
    useTags,
    type CategoryChartBar,
    type CategoryChartView,
    type CategoryReportRow,
    type CategoryReportView,
    type CategorySelection,
    type ResolvedCategorySelection,
    type VariationDirection,
} from '@finance/client';
import type { CategoryReportResponse, CoreInput } from '@finance/core';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import type { MouseHandlerDataParam, YAxisTickContentProps } from 'recharts';
import { Bar, BarChart, ReferenceLine, XAxis, YAxis } from 'recharts';
import { useState, type ReactNode } from 'react';
import { EmptyState, QueryState, Skeleton } from '@/components/states';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ViewToggle } from '@/components/ViewToggle';
import { cn } from '@/lib/cn';
import { useActiveProfile } from '@/shell/activeProfile';
import { useReferenceMonth } from '@/shell/useReferenceMonth';
import { DEFAULT_COMPARISON, parseCategoryReportSearch, selectionFromSearch, transactionsSearchFor, withComparison, withSelection } from './categoryReportSearch.ts';

/**
 * Relatório por categoria (mockup `DesktopRelCategoria`, D4; desktop-mvp-plan Fase 11): a árvore
 * categoria → subcategoria com a comparação, o gráfico do nível aberto e os lançamentos do
 * drill-down. A comparação e o nível ficam na URL (`categoryReportSearch.ts`), para que "Voltar"
 * suba um nível; os números e os textos vêm do `categoryReport` do `client`, que o celular também
 * usa.
 * Regra de negócio (Relatórios, R1): tudo conta no mês do pagamento — a tela só mostra o que o
 * núcleo agregou, sem refazer conta nenhuma (desktop-mvp-plan §3.1).
 *
 * @return A tela do relatório por categoria.
 */
export function CategoryReportScreen(): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const navigate = useNavigate();
    const search = useSearch({ strict: false, select: (raw: Readonly<Record<string, unknown>>) => parseCategoryReportSearch(raw) });
    const comparison = search.comparison ?? DEFAULT_COMPARISON;
    const report = useCategoryReport({ profileId: profile.id, period, comparison });
    const options = comparisonOptions(period);

    /**
     * @param value Modo escolhido no seletor; o `Select` devolve texto, e só um modo das opções é
     * aceito.
     */
    const changeComparison = (value: string): void => {
        const option = options.find((item) => item.mode === value);
        if (option !== undefined) {
            void navigate({ to: '/reports/category', search: (current: Readonly<Record<string, unknown>>) => withComparison(current, option.mode) });
        }
    };

    /**
     * Abre um nível do drill-down. Cada nível é uma entrada no histórico, para que "Voltar" suba
     * de volta.
     *
     * @param target Nível a abrir.
     */
    const select = (target: CategorySelection): void => {
        void navigate({ to: '/reports/category', search: (current: Readonly<Record<string, unknown>>) => withSelection(current, target) });
    };

    return (
        <>
            <div className="flex items-end justify-between gap-4">
                <div className="flex flex-col gap-1">
                    <span className="text-12 text-muted">Relatórios</span>
                    <h1 className="text-24 font-semibold">Por categoria</h1>
                </div>
                <label className="flex items-center gap-2.5 text-13">
                    <span className="text-muted">Comparar com</span>
                    <Select value={comparison} onValueChange={changeComparison}>
                        <SelectTrigger aria-label="Comparar com" className="w-60 bg-surface">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {options.map((option) => (
                                <SelectItem key={option.mode} value={option.mode}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </label>
            </div>
            <QueryState query={report} loading={<ReportSkeleton />}>
                {(data) => <CategoryReportBody key={`${period}:${comparison}`} report={data} selection={selectionFromSearch(search)} currency={profile.currency} onSelect={select} />}
            </QueryState>
        </>
    );
}

/**
 * O relatório carregado. É um componente à parte para que a abertura das categorias comece do
 * relatório já recebido — a categoria do nível aberto vem aberta — e recomece a cada mês ou
 * comparação.
 *
 * @param props.report Relatório do núcleo.
 * @param props.selection Nível guardado na URL; resolvido aqui contra o relatório.
 * @param props.currency Moeda do perfil, para a dica do gráfico.
 * @param props.onSelect Abre um nível do drill-down.
 * @return A trilha, a tabela, o gráfico e os lançamentos.
 */
function CategoryReportBody({ report, selection, currency, onSelect }: {
    readonly report: CategoryReportResponse;
    readonly selection: CategorySelection;
    readonly currency: string;
    readonly onSelect: (target: CategorySelection) => void;
}): ReactNode {
    // Só o que o usuário abriu ou fechou à mão; sem escolha, abre a categoria do nível aberto.
    const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
    const resolved = resolveCategorySelection(report, selection);
    const open = openCategoryId(resolved);
    const expanded = new Set(report.categories.map((category) => category.categoryId).filter((id) => toggled.get(id) ?? id === open));
    const view = buildCategoryReport(report, expanded, selection);

    if (view.empty) {
        return (
            <EmptyState
                title={`Nenhuma despesa em ${view.periodLabel}`}
                description={`Nem na comparação (${view.comparisonLabel}). As despesas aparecem aqui no mês em que o dinheiro sai da conta.`}
                action={<Link to="/transactions">Ir para Transações</Link>}
            />
        );
    }

    /**
     * @param categoryId Categoria cuja abertura o usuário trocou.
     * @param isOpen Se ela está aberta agora.
     */
    const toggle = (categoryId: string, isOpen: boolean): void => {
        setToggled((current) => new Map(current).set(categoryId, !isOpen));
    };

    /**
     * Abrir um nível pelo drill-down também expande na tabela a categoria dele — a própria, ou a
     * dona da subcategoria —, mesmo que tenha sido fechada à mão antes: a linha selecionada
     * precisa estar à vista.
     *
     * @param target Nível a abrir.
     */
    const selectAndExpand = (target: CategorySelection): void => {
        const categoryId = openCategoryId(resolveCategorySelection(report, target));
        if (categoryId !== null) {
            setToggled((current) => {
                const next = new Map(current);
                next.delete(categoryId);
                return next;
            });
        }
        onSelect(target);
    };

    return (
        <>
            <Breadcrumb resolved={resolved} onSelect={selectAndExpand} />
            {view.periodWithoutExpenses && (
                <p role="status" className="rounded-8 bg-warn-bg px-3.5 py-2.5 text-13 text-warn-ink">
                    Nenhuma despesa em {view.periodLabel}. As linhas mostram o que houve na comparação ({view.comparisonLabel}).
                </p>
            )}
            <div className="grid grid-cols-5 items-start gap-4">
                <section aria-label="Tabela por categoria" className="col-span-3 overflow-hidden rounded-10 border border-line bg-surface">
                    <CategoryTable view={view} onToggle={toggle} onSelect={selectAndExpand} />
                </section>
                <CategoryChartPanel chart={categoryChart(resolved, report)} view={view} currency={currency} onSelect={selectAndExpand} />
            </div>
            {resolved.kind !== 'all' && <TransactionsSection resolved={resolved} periodLabel={view.periodLabel} comparisonLabel={view.comparisonLabel} />}
        </>
    );
}

/**
 * Esqueleto do relatório: a trilha, a tabela e o gráfico lado a lado.
 *
 * @return O esqueleto marcado como ocupado.
 */
function ReportSkeleton(): ReactNode {
    return (
        <div role="status" aria-busy="true" aria-label="Carregando relatório" className="flex flex-col gap-5">
            <Skeleton className="h-5 w-56" />
            <div className="grid grid-cols-5 gap-4">
                <Skeleton className="col-span-3 h-80" />
                <Skeleton className="col-span-2 h-80" />
            </div>
        </div>
    );
}

/**
 * Busca de um nível do drill-down para os `Link`s: trocar de nível sem perder o mês e a
 * comparação.
 *
 * @param target Nível a abrir.
 * @return A função de busca que o `Link` aplica sobre a busca atual.
 */
function searchFor(target: CategorySelection): (current: Readonly<Record<string, unknown>>) => Record<string, unknown> {
    return (current) => withSelection(current, target);
}

/**
 * Link que desce ou sobe no drill-down. O `href` continua o da busca, para abrir noutra janela e
 * para o leitor de tela, mas o clique passa pela tela, que também expande a categoria do nível na
 * tabela — sem isso, a tabela do gráfico e a trilha abririam o nível com a linha escondida.
 *
 * @param props.target Nível que o link abre.
 * @param props.onSelect Abre o nível e expande a categoria dele.
 * @param props.current Se o link aponta o nível aberto, para o `aria-current`.
 * @param props.className Estilo do link em cada lugar.
 * @param props.children Texto do link.
 * @return O link.
 */
function DrillDownLink({ target, onSelect, current = false, className, children }: {
    readonly target: CategorySelection;
    readonly onSelect: (target: CategorySelection) => void;
    readonly current?: boolean;
    readonly className: string;
    readonly children: ReactNode;
}): ReactNode {
    return (
        <Link
            to="/reports/category"
            search={searchFor(target)}
            aria-current={current ? 'true' : undefined}
            onClick={(event) => {
                // O `Link` navegaria sozinho; a tela intercepta para também expandir a categoria.
                event.preventDefault();
                onSelect(target);
            }}
            className={className}
        >
            {children}
        </Link>
    );
}

/**
 * Trilha "Todas as categorias › Alimentação › Restaurantes". Os níveis acima do atual são links,
 * e o atual é texto, como no mockup. A chave é o tipo do nível, e não o nome: a subcategoria pode
 * ter o mesmo nome da categoria ("Outros › Outros").
 *
 * @param props.resolved Nível aberto, já resolvido.
 * @param props.onSelect Abre o nível de um item da trilha.
 * @return A trilha.
 */
function Breadcrumb({ resolved, onSelect }: { readonly resolved: ResolvedCategorySelection; readonly onSelect: (target: CategorySelection) => void }): ReactNode {
    const items = categoryBreadcrumb(resolved);
    return (
        <nav aria-label="Nível do detalhamento">
            <ol className="flex items-center gap-1.5 text-14">
                {items.map((item, index) => (
                    <li key={item.target.kind} className="flex items-center gap-1.5">
                        {index > 0 && (
                            <span aria-hidden="true" className="text-muted">
                                ›
                            </span>
                        )}
                        {index === items.length - 1 ? (
                            <span aria-current="page" className="font-semibold">
                                {item.label}
                            </span>
                        ) : (
                            <DrillDownLink target={item.target} onSelect={onSelect} className="text-accent hover:text-soft-ink">
                                {item.label}
                            </DrillDownLink>
                        )}
                    </li>
                ))}
            </ol>
        </nav>
    );
}

/**
 * Cor da variação. Regra de negócio (Relatórios): numa despesa, subir é ruim — `out` — e cair é
 * bom — `in`; a seta e o sinal já dizem a direção, e a cor só reforça (decisão de interface 7).
 */
const VARIATION_TONES: Readonly<Record<VariationDirection, string>> = {
    up: 'text-out',
    down: 'text-in',
    flat: 'text-muted',
};

/**
 * Tabela expansível categoria → subcategoria. O ▸/▾ só abre e fecha as subcategorias; o nome é o
 * link que desce no drill-down — duas ações, dois controles, para que abrir a lista não troque o
 * gráfico nem a lista de lançamentos.
 *
 * @param props.view Relatório pronto para a tela.
 * @param props.onToggle Abre ou fecha as subcategorias de uma categoria.
 * @param props.onSelect Abre um nível do drill-down.
 * @return A tabela com o total de despesas.
 */
function CategoryTable({ view, onToggle, onSelect }: {
    readonly view: CategoryReportView;
    readonly onToggle: (categoryId: string, isOpen: boolean) => void;
    readonly onSelect: (target: CategorySelection) => void;
}): ReactNode {
    return (
        <Table aria-label="Despesas por categoria" className="text-13">
            <TableHeader>
                <TableRow className="bg-surface2 hover:bg-surface2">
                    <TableHead className="px-4">Categoria › Subcategoria</TableHead>
                    <TableHead className="text-right">{view.periodLabel}</TableHead>
                    <TableHead className="text-right">{view.comparisonLabel}</TableHead>
                    <TableHead className="text-right">Variação</TableHead>
                    <TableHead className="px-4 text-right">%</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {view.rows.map((row) => (
                    <TableRow key={`${row.kind}:${row.id}`} className={cn('border-line2', row.selected && 'bg-soft hover:bg-soft')}>
                        <TableCell className="px-4">
                            <RowName row={row} onToggle={onToggle} onSelect={onSelect} />
                        </TableCell>
                        <TableCell className={cn('text-right tabular-nums', (row.selected || (row.kind === 'category' && row.expanded)) && 'font-semibold')}>{row.amount}</TableCell>
                        <TableCell className="text-right text-muted tabular-nums">{row.comparison}</TableCell>
                        <TableCell className={cn('text-right tabular-nums', VARIATION_TONES[row.variation.direction])}>
                            {row.variation.arrow} {row.variation.absolute}
                        </TableCell>
                        <TableCell className={cn('px-4 text-right tabular-nums', VARIATION_TONES[row.variation.direction])}>{row.variation.percent}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
            <TableFooter className="bg-surface2">
                <TableRow className="font-semibold hover:bg-surface2">
                    <TableCell className="px-4">Total de despesas</TableCell>
                    <TableCell className="text-right tabular-nums">{view.total.amount}</TableCell>
                    <TableCell className="text-right tabular-nums">{view.total.comparison}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', VARIATION_TONES[view.total.variation.direction])}>
                        {view.total.variation.arrow} {view.total.variation.absolute}
                    </TableCell>
                    <TableCell className={cn('px-4 text-right tabular-nums', VARIATION_TONES[view.total.variation.direction])}>{view.total.variation.percent}</TableCell>
                </TableRow>
            </TableFooter>
        </Table>
    );
}

/**
 * Primeira coluna de uma linha: na categoria, o ▸/▾ e o nome; na subcategoria, o nome recuado.
 *
 * @param props.row Linha da árvore.
 * @param props.onToggle Abre ou fecha as subcategorias.
 * @param props.onSelect Abre o nível da linha.
 * @return O conteúdo da célula.
 */
function RowName({ row, onToggle, onSelect }: {
    readonly row: CategoryReportRow;
    readonly onToggle: (categoryId: string, isOpen: boolean) => void;
    readonly onSelect: (target: CategorySelection) => void;
}): ReactNode {
    const link = (
        <DrillDownLink
            target={row.target}
            onSelect={onSelect}
            current={row.selected}
            className={cn('text-ink hover:text-accent', (row.selected || (row.kind === 'category' && row.expanded)) && 'font-semibold')}
        >
            {row.name}
        </DrillDownLink>
    );
    if (row.kind === 'subCategory') {
        return <span className="block pl-5">{link}</span>;
    }
    return (
        <span className="flex items-center gap-1">
            <button
                type="button"
                aria-expanded={row.expanded}
                aria-label={`${row.expanded ? 'Esconder' : 'Mostrar'} subcategorias de ${row.name}`}
                disabled={!row.hasChildren}
                onClick={() => {
                    onToggle(row.id, row.expanded);
                }}
                className="w-4 rounded-4 text-muted outline-none hover:text-ink focus-visible:ring-[3px] focus-visible:ring-accent/50 disabled:invisible"
            >
                <span aria-hidden="true">{row.expanded ? '▾' : '▸'}</span>
            </button>
            {link}
        </span>
    );
}

/** Como o gráfico do nível aberto aparece: o gráfico ou a tabela equivalente. */
type ChartMode = 'chart' | 'table';

/** Altura de cada linha do gráfico: as duas barras e o respiro entre as linhas. */
const CHART_ROW_HEIGHT = 48;

/**
 * Bloco do gráfico do nível aberto, com a alternância Gráfico/Tabela do mockup. A tabela é a
 * mesma informação do gráfico, para quem não lê o gráfico (desktop-mvp-plan §2, Gráficos), e
 * também desce no drill-down pelo teclado, o que o clique na barra não faz.
 *
 * @param props.chart Gráfico do nível aberto.
 * @param props.view Relatório pronto, para os rótulos das séries.
 * @param props.currency Moeda do perfil.
 * @param props.onSelect Abre o nível de uma barra.
 * @return O bloco do gráfico.
 */
function CategoryChartPanel({ chart, view, currency, onSelect }: {
    readonly chart: CategoryChartView;
    readonly view: CategoryReportView;
    readonly currency: string;
    readonly onSelect: (target: CategorySelection) => void;
}): ReactNode {
    const [mode, setMode] = useState<ChartMode>('chart');
    return (
        <section aria-labelledby="category-chart-title" className="col-span-2 flex flex-col gap-3.5 rounded-10 border border-line bg-surface p-5">
            <div className="flex items-center justify-between gap-3">
                <h2 id="category-chart-title" className="text-16 font-semibold">
                    {chart.title}
                </h2>
                <div role="group" aria-label="Exibição" className="flex gap-1">
                    <ViewToggle pressed={mode === 'chart'} onClick={() => { setMode('chart'); }}>
                        Gráfico
                    </ViewToggle>
                    <ViewToggle pressed={mode === 'table'} onClick={() => { setMode('table'); }}>
                        Tabela
                    </ViewToggle>
                </div>
            </div>
            {mode === 'chart' ? (
                <>
                    <div className="flex gap-4 text-12 text-muted">
                        <span className="flex items-center gap-1.5">
                            <span aria-hidden="true" className="size-3 rounded-2 bg-accent" />
                            {view.periodLabel}
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span aria-hidden="true" className="size-3 rounded-2 border-[1.5px] border-dashed border-accent" />
                            {view.comparisonLabel}
                        </span>
                    </div>
                    <CategoryBarChart chart={chart} view={view} currency={currency} onSelect={onSelect} />
                    <span className="text-12 text-muted">{chart.hint}</span>
                </>
            ) : (
                <ChartTable chart={chart} view={view} onSelect={onSelect} />
            )}
        </section>
    );
}

/**
 * Barras agrupadas horizontais, como no mockup: o período cheio e a comparação tracejada, na
 * mesma cor — a diferença não depende só da cor. O clique em qualquer ponto da linha (não só na
 * barra, que pode ter largura zero) abre o nível dela.
 *
 * @param props.chart Gráfico do nível aberto.
 * @param props.view Relatório pronto, para os rótulos das séries na dica.
 * @param props.currency Moeda do perfil.
 * @param props.onSelect Abre o nível de uma barra.
 * @return O gráfico.
 */
function CategoryBarChart({ chart, view, currency, onSelect }: {
    readonly chart: CategoryChartView;
    readonly view: CategoryReportView;
    readonly currency: string;
    readonly onSelect: (target: CategorySelection) => void;
}): ReactNode {
    const series = {
        amount: { label: view.periodLabel, color: 'accent' },
        comparison: { label: view.comparisonLabel, color: 'accent' },
    } as const satisfies ChartConfig;

    /**
     * @param state Estado do gráfico no clique; o índice é o da linha sob o cursor.
     */
    const pick = (state: MouseHandlerDataParam): void => {
        // O Recharts 3 guarda o índice da dica como texto ("0"); o 2 guardava como número.
        const raw = state.activeTooltipIndex;
        const index = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN;
        const bar = chart.bars[index];
        if (bar !== undefined) {
            onSelect(bar.target);
        }
    };

    return (
        <ChartContainer
            config={series}
            className="aspect-auto cursor-pointer"
            style={{ height: chart.bars.length * CHART_ROW_HEIGHT + 8 }}
            role="img"
            aria-label={`Gráfico de ${chart.title.toLowerCase()}; os valores estão na tabela`}
        >
            <BarChart layout="vertical" data={[...chart.bars]} barGap={3} barCategoryGap="20%" margin={{ top: 4, right: 8, bottom: 4, left: 0 }} onClick={pick}>
                <XAxis type="number" hide domain={chart.hasNegative ? ['auto', 'auto'] : [0, 'auto']} />
                <YAxis type="category" dataKey="name" width={120} tickLine={false} axisLine={false} interval={0} tick={(props: YAxisTickContentProps) => <CategoryTick {...props} bars={chart.bars} />} />
                {chart.hasNegative && <ReferenceLine x={0} stroke="var(--color-line)" />}
                <ChartTooltip
                    cursor={{ fill: 'var(--color-track)' }}
                    content={(props) => <ChartTooltipContent {...props} formatValue={(amount) => formatMoney({ amount, currency })} />}
                />
                <Bar dataKey="amount" fill="var(--color-amount)" radius={[0, 3, 3, 0]} isAnimationActive={false} />
                <Bar dataKey="comparison" fill="transparent" stroke="var(--color-comparison)" strokeWidth={1.5} strokeDasharray="4 3" radius={[0, 3, 3, 0]} isAnimationActive={false} />
            </BarChart>
        </ChartContainer>
    );
}

/** Nomes mais longos que isso são cortados no eixo; o nome inteiro fica na dica e na tabela. */
const TICK_MAX_CHARS = 16;

/**
 * Rótulo do eixo das categorias, com a subcategoria selecionada em destaque, como no mockup.
 *
 * @param props.x Posição horizontal calculada pelo Recharts.
 * @param props.y Posição vertical calculada pelo Recharts.
 * @param props.payload Item do eixo; o índice aponta a barra.
 * @param props.bars Barras do gráfico.
 * @return O texto do rótulo.
 */
function CategoryTick({ x, y, payload, bars }: YAxisTickContentProps & { readonly bars: readonly CategoryChartBar[] }): ReactNode {
    const bar = bars[payload.index];
    const name = bar?.name ?? '';
    const shown = name.length > TICK_MAX_CHARS ? `${name.slice(0, TICK_MAX_CHARS - 1)}…` : name;
    return (
        <text x={x} y={y} dx={-6} dy={4} textAnchor="end" className={cn('text-13', bar?.selected === true ? 'fill-ink font-semibold' : 'fill-ink2')}>
            {shown}
        </text>
    );
}

/**
 * Tabela equivalente ao gráfico: o mesmo nível, com os nomes como links que descem no
 * drill-down — pelo mesmo caminho do clique na barra, para que a tabela principal também abra
 * a categoria escolhida.
 *
 * @param props.chart Gráfico do nível aberto.
 * @param props.view Relatório pronto, para os rótulos das colunas.
 * @param props.onSelect Abre o nível de uma linha.
 * @return A tabela.
 */
function ChartTable({ chart, view, onSelect }: {
    readonly chart: CategoryChartView;
    readonly view: CategoryReportView;
    readonly onSelect: (target: CategorySelection) => void;
}): ReactNode {
    return (
        <Table aria-label={chart.title} className="text-13">
            <TableHeader>
                <TableRow>
                    <TableHead>{chart.bars[0]?.target.kind === 'category' ? 'Categoria' : 'Subcategoria'}</TableHead>
                    <TableHead className="text-right">{view.periodLabel}</TableHead>
                    <TableHead className="text-right">{view.comparisonLabel}</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {chart.bars.map((bar) => (
                    <TableRow key={bar.name} className={cn(bar.selected && 'font-semibold')}>
                        <TableCell>
                            <DrillDownLink target={bar.target} onSelect={onSelect} current={bar.selected} className="text-ink hover:text-accent">
                                {bar.name}
                            </DrillDownLink>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{bar.amountText}</TableCell>
                        <TableCell className="text-right text-muted tabular-nums">{bar.comparisonText}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}

/**
 * Lançamentos do nível aberto, pela rota própria do drill-down (mês do pagamento), com o link
 * que abre Transações já filtrada. O mockup mostra a lista na subcategoria; na categoria inteira
 * ela também aparece, com a subcategoria de cada lançamento, porque a rota aceita os dois níveis.
 *
 * @param props.resolved Categoria ou subcategoria aberta.
 * @param props.periodLabel Mês do relatório, `out/2026`.
 * @param props.comparisonLabel Coluna da comparação, para o aviso da lista vazia.
 * @return A lista com o total.
 */
function TransactionsSection({ resolved, periodLabel, comparisonLabel }: {
    readonly resolved: Exclude<ResolvedCategorySelection, { readonly kind: 'all' }>;
    readonly periodLabel: string;
    readonly comparisonLabel: string;
}): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const target: Exclude<CategorySelection, { readonly kind: 'all' }> =
        resolved.kind === 'category' ? { kind: 'category', categoryId: resolved.category.categoryId } : { kind: 'subCategory', subCategoryId: resolved.subCategory.subCategoryId };
    const input: CoreInput<'reports.categoryTransactions'> =
        target.kind === 'category' ? { profileId: profile.id, period, categoryId: target.categoryId } : { profileId: profile.id, period, subCategoryId: target.subCategoryId };
    const transactions = useCategoryTransactions(input);
    const accounts = useAccounts({ profileId: profile.id, period });
    const creditCards = useCreditCards({ profileId: profile.id, period });
    const categories = useCategoryTree({ profileId: profile.id });
    const tags = useTags({ profileId: profile.id });
    const name = resolved.kind === 'category' ? resolved.category.name : resolved.subCategory.name;
    const wholeCategory = resolved.kind === 'category';

    return (
        <section aria-labelledby="category-transactions-title" className="overflow-hidden rounded-10 border border-line bg-surface">
            <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                <h2 id="category-transactions-title" className="text-16 font-semibold">
                    Lançamentos em {name} · {periodLabel}
                </h2>
                <Link to="/transactions" search={transactionsSearchFor(target)} className="text-13 text-accent hover:text-soft-ink">
                    Abrir em Transações →
                </Link>
            </div>
            <QueryState query={transactions} loading={<Skeleton className="mx-4 mb-4 h-32" />}>
                {(data) => {
                    if (accounts.data === undefined || creditCards.data === undefined || categories.data === undefined || tags.data === undefined) {
                        return <Skeleton className="mx-4 mb-4 h-32" />;
                    }
                    const list = buildCategoryTransactionList(data, {
                        profileId: profile.id,
                        accounts: accounts.data.accounts,
                        creditCards: creditCards.data.creditCards,
                        categories: categories.data,
                        tags: tags.data,
                    });
                    if (list.rows.length === 0) {
                        return (
                            <p className="border-t border-line px-4 py-4 text-13 text-muted">
                                Nenhum lançamento em {name} em {periodLabel}. A linha aparece pelo gasto da comparação ({comparisonLabel}).
                            </p>
                        );
                    }
                    return (
                        <Table aria-label={`Lançamentos em ${name}`} className="text-13">
                            <TableHeader>
                                <TableRow className="bg-surface2 hover:bg-surface2">
                                    <TableHead className="w-16 px-4">Data</TableHead>
                                    <TableHead>Nome</TableHead>
                                    {wholeCategory && <TableHead>Subcategoria</TableHead>}
                                    <TableHead>Conta / fatura</TableHead>
                                    <TableHead>Tags</TableHead>
                                    <TableHead className="px-4 text-right">Valor</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {list.rows.map((row) => (
                                    <TableRow key={row.id} className="border-line2">
                                        <TableCell className="px-4 tabular-nums">{row.date}</TableCell>
                                        <TableCell>{row.name}</TableCell>
                                        {wholeCategory && <TableCell className="text-ink2">{row.category}</TableCell>}
                                        <TableCell>{row.container}</TableCell>
                                        <TableCell>
                                            <span className="flex flex-wrap gap-1">
                                                {row.tags.map((tag) => (
                                                    <span key={tag} className="rounded-full bg-track px-2 py-0.5 text-12">
                                                        {tag}
                                                    </span>
                                                ))}
                                            </span>
                                        </TableCell>
                                        <TableCell className={cn('px-4 text-right tabular-nums', row.direction === 'out' ? 'text-out' : row.direction === 'in' ? 'text-in' : 'text-ink2')}>{row.amountText}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                            <TableFooter className="bg-surface2">
                                <TableRow className="font-semibold hover:bg-surface2">
                                    <TableCell className="px-4" />
                                    <TableCell colSpan={wholeCategory ? 4 : 3}>Total</TableCell>
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
