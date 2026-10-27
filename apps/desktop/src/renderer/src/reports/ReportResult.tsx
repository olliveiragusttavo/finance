import { buildReportView, formatMoney, type ReportChange, type ReportChartView, type ReportPieView, type ReportTableView } from '@finance/client';
import type { ReportFormat, ReportMeasure, ReportResultResponse } from '@finance/core';
import type { ColorTokenName } from '@finance/tokens';
import { useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, Pie, PieChart, ReferenceLine, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';
import { EmptyState } from '@/components/states';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ViewToggle } from '@/components/ViewToggle';
import { cn } from '@/lib/cn';

/**
 * Cor de cada série, pela posição. São os tokens que a divisão de Sócios já usa para separar
 * quatro grupos (`accent`, `out`, `dot`, `muted`), mais `ink2` para "Outros": os tokens não têm
 * uma paleta de gráfico, e uma cor literal ficaria fora do `packages/tokens`.
 */
const SERIES_COLORS: readonly ColorTokenName[] = ['accent', 'out', 'dot', 'muted', 'ink2'];

/** Altura de cada barra deitada, para que muitos grupos não esmaguem os rótulos. */
const HORIZONTAL_ROW_HEIGHT = 36;

/** Como o gráfico aparece: ele mesmo, ou a tabela equivalente. */
type ChartMode = 'chart' | 'table';

/**
 * Resultado de um relatório personalizado: a tabela agrupada ou o gráfico, com a alternância
 * Gráfico/Tabela dos outros gráficos do app — a tabela é a versão acessível do gráfico
 * (desktop-mvp-plan §2, Gráficos). Os números e os textos vêm do `reportView` do `client`.
 *
 * @param props.result Resultado do núcleo.
 * @param props.format Formato da definição.
 * @param props.name Nome do relatório, para os nomes acessíveis da tabela e do gráfico.
 * @param props.currency Moeda do perfil, para a dica do gráfico.
 * @param props.analysis Se a definição pede a análise (reports-design L9).
 * @return O resultado, ou o estado vazio quando nada entra no filtro.
 */
export function ReportResult({
    result,
    format,
    name,
    currency,
    analysis,
}: {
    readonly result: ReportResultResponse;
    readonly format: ReportFormat;
    readonly name: string;
    readonly currency: string;
    readonly analysis: boolean;
}): ReactNode {
    const [mode, setMode] = useState<ChartMode>('chart');
    const view = buildReportView(result, format, analysis);
    if (view.empty) {
        return <EmptyState title="Nenhum lançamento neste filtro" description="Ajuste o período ou os filtros para ver os números aqui." />;
    }
    const { chart, pie } = view;
    const graphic = chart !== null || pie !== null;
    const showGraphic = graphic && mode === 'chart';
    return (
        <section aria-label="Resultado" className="flex flex-col gap-3 overflow-hidden rounded-10 border border-line bg-surface">
            {graphic && (
                <div className="flex justify-end px-4 pt-3.5">
                    <div role="group" aria-label="Exibição" className="flex gap-1">
                        <ViewToggle pressed={mode === 'chart'} onClick={() => { setMode('chart'); }}>
                            Gráfico
                        </ViewToggle>
                        <ViewToggle pressed={mode === 'table'} onClick={() => { setMode('table'); }}>
                            Tabela
                        </ViewToggle>
                    </div>
                </div>
            )}
            {chart !== null && showGraphic && <ResultChart chart={chart} measure={result.measure} name={name} currency={currency} />}
            {pie !== null && showGraphic && <ResultPie pie={pie} measure={result.measure} name={name} currency={currency} />}
            {!showGraphic && <ResultTable table={view.table} name={name} />}
            {[view.overlapNote, view.flowNote, showGraphic ? view.seriesNote : null, showGraphic ? view.pieNote : null].map((note) =>
                note === null ? null : (
                    <p key={note} className="mx-4 mb-4 rounded-8 bg-soft px-3 py-2.5 text-13 text-soft-ink">
                        {note}
                    </p>
                ),
            )}
        </section>
    );
}

/**
 * A tabela agrupada: uma linha por grupo da primeira divisão, uma coluna por grupo da segunda e
 * os totais na última coluna e no rodapé. Números à direita e com algarismos tabulares (decisão de
 * interface 8 dos mockups).
 *
 * @param props.table Tabela pronta do `client`.
 * @param props.name Nome do relatório.
 * @return A tabela.
 */
function ResultTable({ table, name }: { readonly table: ReportTableView; readonly name: string }): ReactNode {
    return (
        <div className="overflow-x-auto">
            <Table aria-label={name} className="text-13">
                <TableHeader>
                    <TableRow className="bg-surface2 hover:bg-surface2">
                        <TableHead className="px-4">{table.rowHeader}</TableHead>
                        {table.columns.map((column) => (
                            <TableHead key={column.key} className="text-right">
                                {column.label}
                            </TableHead>
                        ))}
                        <TableHead className="px-4 text-right">{table.totalHeader}</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {table.rows.map((row) => (
                        <TableRow key={row.key} className="border-line2 tabular-nums">
                            <TableCell className="px-4">{row.label}</TableCell>
                            {row.cells.map((cell, index) => (
                                <TableCell key={table.columns[index]?.key ?? index} className="text-right">
                                    {cell}
                                    <Change change={row.cellChanges[index] ?? null} />
                                </TableCell>
                            ))}
                            <TableCell className={cn('px-4 text-right', table.columns.length > 0 && 'font-semibold')}>
                                {row.total}
                                <Change change={row.totalChange} />
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
                <TableFooter className="bg-surface2">
                    <TableRow className="font-semibold tabular-nums hover:bg-surface2">
                        <TableCell className="px-4">{table.footerLabel}</TableCell>
                        {table.columnTotals.map((total, index) => (
                            <TableCell key={table.columns[index]?.key ?? index} className="text-right">
                                {total}
                                <Change change={table.columnTotalChanges[index] ?? null} />
                            </TableCell>
                        ))}
                        <TableCell className="px-4 text-right">{table.total}</TableCell>
                    </TableRow>
                </TableFooter>
            </Table>
        </div>
    );
}

/** Seta de cada direção da variação: aumento e redução não dependem só da cor (decisão de interface dos mockups). */
const CHANGE_ARROWS: Readonly<Record<ReportChange['direction'], string>> = { up: '▲', down: '▼', same: '=' };

/**
 * Cor de cada direção: os tokens `in` e `out`, que o app já usa para o sinal + e −, e não verde e
 * vermelho — se subir é bom depende do que se mede (receita ou despesa), e o par azul e laranja
 * continua distinguível para quem não separa verde de vermelho.
 */
const CHANGE_TONES: Readonly<Record<ReportChange['direction'], string>> = { up: 'text-in', down: 'text-out', same: 'text-muted' };

/**
 * Variação de um valor sobre o mês anterior, embaixo do número (reports-design L9), com a seta, o
 * sinal e a cor da direção.
 *
 * @param props.change Variação; `null` quando não há o que comparar.
 * @return A variação, ou nada.
 */
function Change({ change }: { readonly change: ReportChange | null }): ReactNode {
    if (change === null) {
        return null;
    }
    return (
        <span className={cn('block text-12 font-medium', CHANGE_TONES[change.direction])}>
            <span aria-hidden="true">{CHANGE_ARROWS[change.direction]} </span>
            {change.text}
            <span className="sr-only"> em relação ao mês anterior</span>
        </span>
    );
}

/**
 * O gráfico do resultado: barras (em pé sobre os meses, deitadas e empilhadas sobre nomes) ou
 * linha, uma série por grupo da segunda divisão. O valor exato fica na dica e na tabela; a linha
 * do zero aparece quando algum valor fica negativo. O eixo é pela chave do grupo, e não pelo
 * rótulo, porque o Recharts junta categorias de mesmo texto: dois "jan" numa janela de 13 meses
 * mostravam os números de um ano nos dois.
 *
 * @param props.chart Gráfico pronto do `client`.
 * @param props.measure Medida, que decide como a dica formata o número.
 * @param props.name Nome do relatório.
 * @param props.currency Moeda do perfil.
 * @return O gráfico.
 */
export function ResultChart({ chart, measure, name, currency }: { readonly chart: ReportChartView; readonly measure: ReportMeasure; readonly name: string; readonly currency: string }): ReactNode {
    const config: ChartConfig = Object.fromEntries(chart.series.map((series) => [series.key, { label: series.label, color: SERIES_COLORS[series.color] ?? 'accent' }]));
    const formatValue = (value: number): string => (measure === 'sum' ? formatMoney({ amount: value, currency }) : String(value));
    // O eixo é a chave do grupo (`group`), única; o rótulo só entra na hora de escrever.
    const labels = new Map(chart.data.map((point) => [String(point['group']), String(point['label'])]));
    /**
     * O eixo e a dica recebem a chave do grupo, e não o rótulo, porque o Recharts junta categorias
     * de mesmo texto; o rótulo só entra na hora de escrever.
     *
     * @param group Chave do grupo que o Recharts repassa (`unknown` na tipagem dele).
     * @return O rótulo do grupo; vazio quando a chave não é de nenhum ponto.
     */
    const labelOf =(group: unknown): string => labels.get(String(group)) ?? '';
    const tooltip = <ChartTooltip cursor={{ fill: 'var(--color-track)' }} content={(props) => <ChartTooltipContent {...props} label={labelOf(props.label)} formatValue={formatValue} />} />;
    const legend = chart.series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null;
    const data = [...chart.data];
    const aria = `Gráfico de ${name}; os valores estão na tabela`;
    if (chart.kind === 'line') {
        return (
            <div className="px-4 pb-4">
                <ChartContainer config={config} className="aspect-auto h-72" role="img" aria-label={aria}>
                    <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 16 }}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="group" tickFormatter={labelOf} tickLine={false} axisLine={{ stroke: 'var(--color-line)' }} interval="preserveStartEnd" />
                        <YAxis hide domain={chart.hasNegative ? ['auto', 'auto'] : [0, 'auto']} />
                        {chart.hasNegative && <ReferenceLine y={0} stroke="var(--color-line)" />}
                        {tooltip}
                        {legend}
                        {chart.series.map((series) => (
                            <Line key={series.key} dataKey={series.key} stroke={`var(--color-${series.key})`} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                        ))}
                    </LineChart>
                </ChartContainer>
            </div>
        );
    }
    if (chart.horizontal) {
        return (
            <div className="px-4 pb-4">
                <ChartContainer config={config} className="aspect-auto" style={{ height: chart.data.length * HORIZONTAL_ROW_HEIGHT + 48 }} role="img" aria-label={aria}>
                    <BarChart layout="vertical" data={data} barCategoryGap="20%" margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                        <XAxis type="number" hide domain={chart.hasNegative ? ['auto', 'auto'] : [0, 'auto']} />
                        <YAxis type="category" dataKey="group" tickFormatter={labelOf} width={160} tickLine={false} axisLine={false} interval={0} className="text-13" />
                        {chart.hasNegative && <ReferenceLine x={0} stroke="var(--color-line)" />}
                        {tooltip}
                        {legend}
                        {chart.series.map((series) => (
                            <Bar key={series.key} dataKey={series.key} {...(chart.series.length > 1 && series.key !== 'result' ? { stackId: 'stack' } : {})} fill={`var(--color-${series.key})`} isAnimationActive={false} />
                        ))}
                    </BarChart>
                </ChartContainer>
            </div>
        );
    }
    return (
        <div className="px-4 pb-4">
            <ChartContainer config={config} className="aspect-auto h-72" role="img" aria-label={aria}>
                <BarChart data={data} barCategoryGap="20%" margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                    <XAxis dataKey="group" tickFormatter={labelOf} tickLine={false} axisLine={{ stroke: 'var(--color-line)' }} interval="preserveStartEnd" />
                    <YAxis hide domain={chart.hasNegative ? ['auto', 'auto'] : [0, 'auto']} />
                    {chart.hasNegative && <ReferenceLine y={0} stroke="var(--color-line)" />}
                    {tooltip}
                    {legend}
                    {chart.series.map((series) => (
                        <Bar key={series.key} dataKey={series.key} fill={`var(--color-${series.key})`} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    ))}
                </BarChart>
            </ChartContainer>
        </div>
    );
}

/**
 * A pizza do resultado: uma fatia por grupo da dimensão principal, ao lado da legenda com o
 * valor e a participação de cada uma. A legenda escreve os números porque ângulos parecidos não
 * se distinguem a olho, e a cor nunca é a única pista de qual fatia é qual. O contorno na cor
 * da superfície separa as fatias vizinhas.
 *
 * @param props.pie Fatias prontas do `client`.
 * @param props.measure Medida, que decide como o valor é formatado.
 * @param props.name Nome do relatório.
 * @param props.currency Moeda do perfil.
 * @return O gráfico, ou um aviso quando nenhum grupo virou fatia.
 */
function ResultPie({ pie, measure, name, currency }: { readonly pie: ReportPieView; readonly measure: ReportMeasure; readonly name: string; readonly currency: string }): ReactNode {
    if (pie.slices.length === 0) {
        return <p className="mx-4 text-13 text-ink2">Nenhum grupo tem soma positiva para dividir a pizza; veja os números na tabela.</p>;
    }
    const config: ChartConfig = Object.fromEntries(pie.slices.map((slice) => [slice.key, { label: slice.label, color: SERIES_COLORS[slice.color] ?? 'accent' }]));
    /**
     * A legenda e a dica escrevem o valor de cada fatia pela medida: na soma é dinheiro, na
     * quantidade é um número de lançamentos.
     *
     * @param value Valor da fatia.
     * @return O valor formatado.
     */
    const formatValue =(value: number): string => (measure === 'sum' ? formatMoney({ amount: value, currency }) : String(value));
    // A cor vai no próprio dado (`fill`), que o Recharts 3 aplica a cada fatia no lugar do `Cell`, obsoleto.
    const data = pie.slices.map((slice) => ({ key: slice.key, label: slice.label, value: slice.value, fill: `var(--color-${slice.key})` }));
    return (
        <div className="flex flex-wrap items-center gap-6 px-4 pb-4">
            <ChartContainer config={config} className="aspect-square h-64" role="img" aria-label={`Gráfico de ${name}; os valores estão na legenda e na tabela`}>
                <PieChart>
                    <Tooltip content={(props) => <PieTooltip {...props} pie={pie} formatValue={formatValue} />} />
                    <Pie data={data} dataKey="value" nameKey="key" outerRadius="90%" stroke="var(--surface)" strokeWidth={2} isAnimationActive={false} />
                </PieChart>
            </ChartContainer>
            <ul aria-label="Legenda" className="flex min-w-48 flex-1 flex-col gap-2 text-13">
                {pie.slices.map((slice) => (
                    <li key={slice.key} className="flex items-center gap-2 tabular-nums">
                        <span aria-hidden="true" className="size-2.5 shrink-0 rounded-2" style={{ backgroundColor: `var(--${SERIES_COLORS[slice.color] ?? 'accent'})` }} />
                        <span className="min-w-0 flex-1 truncate text-ink">{slice.label}</span>
                        <span className="whitespace-nowrap text-ink2">{formatValue(slice.value)}</span>
                        <span className="w-14 text-right font-medium text-ink">{slice.share}</span>
                    </li>
                ))}
                {pie.result !== null && (
                    <li className="flex items-center gap-2 border-t border-line2 pt-2 font-semibold tabular-nums">
                        <span className="flex-1 text-ink">Resultado</span>
                        <span className="whitespace-nowrap text-ink">{pie.result}</span>
                    </li>
                )}
            </ul>
        </div>
    );
}

/**
 * Dica da pizza. Não usa a `ChartTooltipContent` dos outros gráficos, que acha a série pela
 * chave do dado: na pizza todas as fatias têm a mesma chave (`value`), e a fatia sob o cursor só
 * se reconhece pelo nome — que é a chave da fatia (`s0`...), e não o rótulo, porque dois grupos
 * podem ter o mesmo rótulo.
 *
 * @param props.active Se a dica está visível; o Recharts controla.
 * @param props.payload A fatia sob o cursor.
 * @param props.pie Fatias, de onde vêm a participação e a cor.
 * @param props.formatValue Formata o valor da fatia.
 * @return A dica, ou nada quando inativa.
 */
function PieTooltip({
    active,
    payload,
    pie,
    formatValue,
}: Pick<TooltipContentProps, 'active' | 'payload'> & { readonly pie: ReportPieView; readonly formatValue: (value: number) => string }): ReactNode {
    const name = payload[0]?.name;
    const slice = pie.slices.find((entry) => entry.key === name);
    if (!active || slice === undefined) {
        return null;
    }
    return (
        <div className="grid min-w-32 gap-1.5 rounded-10 border border-line bg-surface px-2.5 py-1.5 text-12 shadow-xl">
            <div className="flex items-center gap-2">
                <span aria-hidden="true" className="size-2.5 shrink-0 rounded-2" style={{ backgroundColor: `var(--color-${slice.key})` }} />
                <span className="font-medium">{slice.label}</span>
            </div>
            <div className="flex gap-3 tabular-nums">
                <span className="flex-1 text-ink">{formatValue(slice.value)}</span>
                <span className="text-muted">{slice.share}</span>
            </div>
        </div>
    );
}
