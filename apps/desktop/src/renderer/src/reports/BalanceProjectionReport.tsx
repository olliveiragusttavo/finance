import {
    BALANCE_PROJECTION_BASIS_LABELS,
    buildBalanceProjectionView,
    useBalanceProjection,
    type BalanceProjectionHistoryRow,
    type BalanceProjectionKpi,
    type BalanceProjectionRow,
} from '@finance/client';
import { BALANCE_PROJECTION_BASES, type BalanceProjectionBasis } from '@finance/core';
import { useState, type ReactNode } from 'react';
import { QueryState, Skeleton } from '@/components/states';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ViewToggle } from '@/components/ViewToggle';
import { cn } from '@/lib/cn';
import { useActiveProfile } from '@/shell/activeProfile';
import { ResultChart } from './ReportResult.tsx';

/** Como a projeção aparece: a linha do saldo, ou a tabela equivalente. */
type ProjectionMode = 'chart' | 'table';

/**
 * Projeção de saldo, fixada no topo dos Relatórios de todo perfil (reports-design §9): o saldo
 * consolidado de hoje e, mês a mês, o que já está lançado mais a estimativa dos avulsos, com os
 * cenários pessimista e otimista. A janela da estimativa é escolhida aqui e não é gravada: é uma
 * pergunta de agora, e o padrão é o ano inteiro. Não segue o mês de referência da barra: projeta a
 * partir de hoje.
 *
 * @return O relatório de projeção.
 */
export function BalanceProjectionReport(): ReactNode {
    const { profile } = useActiveProfile();
    const [basis, setBasis] = useState<BalanceProjectionBasis>(12);
    const [mode, setMode] = useState<ProjectionMode>('chart');
    const projection = useBalanceProjection({ profileId: profile.id, basis });

    return (
        <>
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="flex flex-col gap-1">
                    <span className="text-12 text-muted">Relatório fixo · a partir de hoje</span>
                    <h2 className="text-24 font-semibold">Projeção de saldo</h2>
                </div>
                <div role="group" aria-label="Média dos últimos" className="flex items-center gap-1">
                    <span className="mr-1 text-13 text-muted">Média dos últimos</span>
                    {BALANCE_PROJECTION_BASES.map((option) => (
                        <ViewToggle key={option} pressed={basis === option} onClick={() => { setBasis(option); }}>
                            {BALANCE_PROJECTION_BASIS_LABELS[option]}
                        </ViewToggle>
                    ))}
                </div>
            </div>
            <QueryState query={projection} loading={<Skeleton className="h-80" />}>
                {(data) => {
                    const view = buildBalanceProjectionView(data);
                    return (
                        <>
                            <section aria-label="Indicadores" className="grid grid-cols-3 gap-4">
                                {view.kpis.map((kpi) => (
                                    <KpiCard key={kpi.label} kpi={kpi} />
                                ))}
                            </section>
                            {[view.historyNote, view.rangeNote].map((note) =>
                                note === null ? null : (
                                    <p key={note} role="status" className="rounded-8 bg-warn-bg px-3.5 py-2.5 text-13 text-warn-ink">
                                        {note}
                                    </p>
                                ),
                            )}
                            <section aria-label="Projeção" className="flex flex-col gap-3 overflow-hidden rounded-10 border border-line bg-surface">
                                <div className="flex items-center justify-between gap-3 px-4 pt-3.5">
                                    <h3 className="text-16 font-semibold">Saldo projetado</h3>
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
                                    <ResultChart chart={view.chart} measure="sum" name="Projeção de saldo" currency={profile.currency} />
                                ) : (
                                    <ProjectionTable rows={view.projection} />
                                )}
                                <p className="mx-4 mb-4 rounded-8 bg-soft px-3 py-2.5 text-13 text-soft-ink">
                                    Cada mês soma ao saldo o que já está lançado — parcelas, séries fixas, contas em aberto, faturas e transferências — e a estimativa dos avulsos, a média do que não estava lançado nos meses da janela. A faixa mostra quanto os avulsos costumam variar e abre com o horizonte.
                                </p>
                            </section>
                            {view.history.length > 0 && (
                                <section aria-label="Meses da estimativa" className="overflow-hidden rounded-10 border border-line bg-surface">
                                    <h3 className="px-4 py-3.5 text-16 font-semibold">Meses da estimativa</h3>
                                    <HistoryTable rows={view.history} />
                                </section>
                            )}
                        </>
                    );
                }}
            </QueryState>
        </>
    );
}

/**
 * Um indicador: rótulo, valor e a explicação curta embaixo, num grupo nomeado para que o leitor
 * de tela leia o rótulo junto do número. A média leva a cor da entrada ou da saída junto do sinal.
 *
 * @param props.kpi Indicador já formatado.
 * @return O cartão do indicador.
 */
function KpiCard({ kpi }: { readonly kpi: BalanceProjectionKpi }): ReactNode {
    return (
        <div role="group" aria-label={kpi.label} className="flex flex-col gap-1.5 rounded-10 border border-line bg-surface p-4">
            <span className="text-13 text-muted">{kpi.label}</span>
            <span className={cn('text-22 font-semibold tabular-nums', kpi.tone === 'in' && 'text-in', kpi.tone === 'out' && 'text-out')}>{kpi.value}</span>
            <span className="text-12 text-muted">{kpi.sub}</span>
        </div>
    );
}

/**
 * O saldo de cada mês com as duas partes do resultado e a faixa, com os números à direita e em
 * algarismos tabulares (decisão de interface 8 dos mockups); o saldo negativo leva a cor da saída
 * junto do sinal.
 *
 * @param props.rows Meses da projeção, já formatados.
 * @return A tabela.
 */
function ProjectionTable({ rows }: { readonly rows: readonly BalanceProjectionRow[] }): ReactNode {
    return (
        <Table aria-label="Saldo projetado" className="text-13">
            <TableHeader>
                <TableRow className="bg-surface2 hover:bg-surface2">
                    <TableHead className="px-4">Mês</TableHead>
                    <TableHead className="text-right">Já lançado</TableHead>
                    <TableHead className="text-right">Avulsos estimados</TableHead>
                    <TableHead className="text-right">Saldo projetado</TableHead>
                    <TableHead className="px-4 text-right">Faixa</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {rows.map((row) => (
                    <TableRow key={row.period} className="border-line2 tabular-nums">
                        <TableCell className="px-4">{row.label}</TableCell>
                        <TableCell className="text-right">{row.scheduled}</TableCell>
                        <TableCell className="text-right">{row.estimated}</TableCell>
                        <TableCell className={cn('text-right font-semibold', row.negative && 'text-out')}>{row.balance}</TableCell>
                        <TableCell className="px-4 text-right text-ink2">{row.range}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}

/**
 * Os meses que formaram a estimativa, com o resultado separado em séries e avulsos: mostra por que
 * a estimativa usa só os avulsos — as séries já estão no "já lançado".
 *
 * @param props.rows Meses do histórico, já formatados.
 * @return A tabela.
 */
function HistoryTable({ rows }: { readonly rows: readonly BalanceProjectionHistoryRow[] }): ReactNode {
    return (
        <Table aria-label="Meses da estimativa" className="text-13">
            <TableHeader>
                <TableRow className="bg-surface2 hover:bg-surface2">
                    <TableHead className="px-4">Mês</TableHead>
                    <TableHead className="text-right">Resultado</TableHead>
                    <TableHead className="text-right">Séries</TableHead>
                    <TableHead className="px-4 text-right">Avulsos</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {rows.map((row) => (
                    <TableRow key={row.period} className="border-line2 tabular-nums">
                        <TableCell className="px-4">{row.label}</TableCell>
                        <TableCell className="text-right">{row.result}</TableCell>
                        <TableCell className="text-right text-ink2">{row.recurring}</TableCell>
                        <TableCell className="px-4 text-right font-semibold">{row.nonRecurring}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}
