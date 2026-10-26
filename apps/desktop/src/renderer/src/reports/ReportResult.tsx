import { buildReportView, formatMoney, type ReportChartView, type ReportTableView } from '@finance/client';
import type { ReportFormat, ReportMeasure, ReportResultResponse } from '@finance/core';
import type { ColorTokenName } from '@finance/tokens';
import { useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts';
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
 * @return O resultado, ou o estado vazio quando nada entra no filtro.
 */
export function ReportResult({ result, format, name, currency }: { readonly result: ReportResultResponse; readonly format: ReportFormat; readonly name: string; readonly currency: string }): ReactNode {
    const [mode, setMode] = useState<ChartMode>('chart');
    const view = buildReportView(result, format);
    if (view.empty) {
        return <EmptyState title="Nenhum lançamento neste filtro" description="Ajuste o período ou os filtros para ver os números aqui." />;
    }
    const chart = view.chart;
    return (
        <section aria-label="Resultado" className="flex flex-col gap-3 overflow-hidden rounded-10 border border-line bg-surface">
            {chart !== null && (
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
            {chart !== null && mode === 'chart' ? <ResultChart chart={chart} measure={result.measure} name={name} currency={currency} /> : <ResultTable table={view.table} name={name} />}
            {[view.overlapNote, chart !== null && mode === 'chart' ? view.seriesNote : null].map((note) =>
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
                                </TableCell>
                            ))}
                            <TableCell className={cn('px-4 text-right', table.columns.length > 0 && 'font-semibold')}>{row.total}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
                <TableFooter className="bg-surface2">
                    <TableRow className="font-semibold tabular-nums hover:bg-surface2">
                        <TableCell className="px-4">Total</TableCell>
                        {table.columnTotals.map((total, index) => (
                            <TableCell key={table.columns[index]?.key ?? index} className="text-right">
                                {total}
                            </TableCell>
                        ))}
                        <TableCell className="px-4 text-right">{table.total}</TableCell>
                    </TableRow>
                </TableFooter>
            </Table>
        </div>
    );
}

/**
 * O gráfico do resultado: barras (em pé sobre os meses, deitadas e empilhadas sobre nomes) ou
 * linha, uma série por grupo da segunda divisão. O valor exato fica na dica e na tabela; a linha do zero aparece
 * quando algum valor fica negativo.
 *
 * @param props.chart Gráfico pronto do `client`.
 * @param props.measure Medida, que decide como a dica formata o número.
 * @param props.name Nome do relatório.
 * @param props.currency Moeda do perfil.
 * @return O gráfico.
 */
function ResultChart({ chart, measure, name, currency }: { readonly chart: ReportChartView; readonly measure: ReportMeasure; readonly name: string; readonly currency: string }): ReactNode {
    const config: ChartConfig = Object.fromEntries(chart.series.map((series) => [series.key, { label: series.label, color: SERIES_COLORS[series.color] ?? 'accent' }]));
    const formatValue = (value: number): string => (measure === 'sum' ? formatMoney({ amount: value, currency }) : String(value));
    const tooltip = <ChartTooltip cursor={{ fill: 'var(--color-track)' }} content={(props) => <ChartTooltipContent {...props} formatValue={formatValue} />} />;
    const legend = chart.series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null;
    const data = [...chart.data];
    const aria = `Gráfico de ${name}; os valores estão na tabela`;
    if (chart.kind === 'line') {
        return (
            <div className="px-4 pb-4">
                <ChartContainer config={config} className="aspect-auto h-72" role="img" aria-label={aria}>
                    <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 16 }}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--color-line)' }} interval="preserveStartEnd" />
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
                        <YAxis type="category" dataKey="label" width={160} tickLine={false} axisLine={false} interval={0} className="text-13" />
                        {chart.hasNegative && <ReferenceLine x={0} stroke="var(--color-line)" />}
                        {tooltip}
                        {legend}
                        {chart.series.map((series) => (
                            <Bar key={series.key} dataKey={series.key} {...(chart.series.length > 1 ? { stackId: 'stack' } : {})} fill={`var(--color-${series.key})`} isAnimationActive={false} />
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
                    <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--color-line)' }} interval="preserveStartEnd" />
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
