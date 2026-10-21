import { buildCardImpactGrid, useAccounts, useCardImpact, type CardImpactCell, type CardImpactGrid, type CardImpactKpi, type CardImpactRow, type SituationTone } from '@finance/client';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { EmptyState, QueryState, Skeleton } from '@/components/states';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { StatusTag } from '@/components/entityUi';
import { useActiveProfile } from '@/shell/activeProfile';
import { useReferenceMonth } from '@/shell/useReferenceMonth';

/**
 * Impacto do cartão (mockup `DesktopRelCartao`, D6; desktop-mvp-plan Fase 12): quanto as faturas
 * pesam nas entradas do mês, numa grade mês × cartão com os 3 meses anteriores, o de referência e
 * o seguinte. Os números e as frases vêm do `cardImpactGrid` do `client`, que o celular também
 * usa; a tela só os arruma.
 * Regra de negócio (Relatórios, C1): as faturas de um mês são as pagas nele mais as em aberto que
 * vencem nele — a tela só mostra o que o núcleo agregou, sem refazer conta (reports-design §4).
 *
 * @return A tela do impacto do cartão.
 */
export function CardImpactScreen(): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const report = useCardImpact({ profileId: profile.id, period });
    // Só nomeia a conta pagadora no cabeçalho de cada cartão; a grade não espera por ela.
    const accounts = useAccounts({ profileId: profile.id, period });

    return (
        <>
            <div className="flex flex-col gap-1">
                <span className="text-12 text-muted">Relatórios</span>
                <h1 className="text-24 font-semibold">Impacto do cartão</h1>
            </div>
            <QueryState query={report} loading={<ReportSkeleton />}>
                {(data) => <CardImpactBody grid={buildCardImpactGrid(data, accounts.data?.accounts ?? [])} />}
            </QueryState>
        </>
    );
}

/**
 * O relatório carregado: os indicadores, a grade e a nota sobre onde a fatura pesa. Perfil sem
 * cartão mostra o estado vazio, porque uma grade sem colunas de cartão não diz nada.
 *
 * @param props.grid Grade pronta do `client`.
 * @return O corpo do relatório.
 */
function CardImpactBody({ grid }: { readonly grid: CardImpactGrid }): ReactNode {
    if (grid.empty) {
        return (
            <EmptyState
                title="Nenhum cartão"
                description="Cadastre um cartão para ver quanto as faturas pesam nas entradas de cada mês."
                action={<Link to="/cards">Ir para Cartões</Link>}
            />
        );
    }
    return (
        <>
            <section aria-label="Indicadores" className="grid grid-cols-3 gap-4">
                <KpiCard kpi={grid.kpis.invoices} />
                <KpiCard kpi={grid.kpis.weight} />
                <KpiCard kpi={grid.kpis.average} />
            </section>
            <InvoiceGrid grid={grid} />
            <p className="rounded-8 bg-soft px-3 py-2.5 text-13 text-soft-ink">
                Fatura em aberto pesa no saldo previsto da conta pagadora no mês do vencimento. Ao pagar, ela passa a contar no extrato do mês do pagamento.
            </p>
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
function KpiCard({ kpi }: { readonly kpi: CardImpactKpi }): ReactNode {
    return (
        <div role="group" aria-label={kpi.label} className="flex flex-col gap-1.5 rounded-10 border border-line bg-surface p-4">
            <span className="text-13 text-muted">{kpi.label}</span>
            <span className="text-22 font-semibold tabular-nums">{kpi.value}</span>
            <span className="text-12 text-muted">{kpi.sub}</span>
        </div>
    );
}

/**
 * Grade mês × cartão, com o total e o peso de cada mês. O mês de referência fica destacado e o
 * seguinte, apagado, porque ainda é só o que já está comprometido (C5).
 *
 * @param props.grid Grade pronta do `client`.
 * @return A tabela das faturas por mês.
 */
function InvoiceGrid({ grid }: { readonly grid: CardImpactGrid }): ReactNode {
    return (
        <section className="overflow-hidden rounded-10 border border-line bg-surface">
            <Table aria-label="Faturas por mês">
                <TableHeader>
                    <TableRow>
                        <TableHead>Mês</TableHead>
                        {grid.columns.map((column) => (
                            <TableHead key={column.creditCardId}>
                                <span className="flex items-center gap-2">
                                    <span>{column.title}</span>
                                    {column.disabled && <StatusTag tone="warn">Desativado</StatusTag>}
                                </span>
                            </TableHead>
                        ))}
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Peso nas entradas</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {grid.rows.map((row) => (
                        <MonthRow key={row.period} row={row} columns={grid.columns} />
                    ))}
                </TableBody>
            </Table>
        </section>
    );
}

/**
 * Uma linha da grade (um mês).
 *
 * @param props.row Mês já formatado.
 * @param props.columns Cartões das colunas, na ordem das células, para nomear os links.
 * @return A linha.
 */
function MonthRow({ row, columns }: { readonly row: CardImpactRow; readonly columns: CardImpactGrid['columns'] }): ReactNode {
    return (
        <TableRow aria-current={row.isReference ? 'date' : undefined} className={cn('tabular-nums', row.isReference && 'bg-soft hover:bg-soft')}>
            <TableCell className={cn(row.isReference && 'font-semibold', row.isNext && 'text-muted')}>{row.label}</TableCell>
            {row.cells.map((cell, index) => (
                <TableCell key={cell.creditCardId} className="align-top">
                    <InvoiceCell cell={cell} creditCardName={columns[index]?.name ?? ''} compact={row.isReference || row.isNext} />
                </TableCell>
            ))}
            <TableCell className="text-right">{row.total}</TableCell>
            <TableCell>
                <span className="flex items-center gap-3">
                    <span aria-hidden="true" className="h-2 grow overflow-hidden rounded-4 bg-track">
                        <span className="block h-full rounded-4 bg-accent" style={{ width: `${String(Math.round((row.weightShare ?? 0) * 1000) / 10)}%` }} />
                    </span>
                    <span className="w-14 shrink-0 text-right">{row.weight}</span>
                </span>
            </TableCell>
        </TableRow>
    );
}

/**
 * Classe de cada tom da situação. A fatura paga nos meses anteriores é só uma nota discreta; as
 * outras são etiquetas. O texto da situação já a distingue, sem depender só da cor (decisão de
 * interface 7 dos mockups).
 */
const NOTE_TONES: Readonly<Record<SituationTone, string>> = {
    muted: 'text-12 text-muted',
    warn: 'whitespace-nowrap rounded-full bg-warn-bg px-2 py-0.5 text-12 text-warn-ink',
    ok: 'whitespace-nowrap rounded-full bg-ok-bg px-2 py-0.5 text-12 text-ok-ink',
    neutral: 'whitespace-nowrap rounded-full bg-track px-2 py-0.5 text-12 text-ink2',
};

/**
 * Uma célula mês × cartão: o total das faturas que pesam no mês e a situação de cada uma, como
 * link para a fatura em Cartões. O link fica em cada situação, e não na célula, porque a célula
 * pode ter duas faturas — a do mês anterior paga com atraso e a do mês (reports-design §4).
 *
 * @param props.cell Célula já formatada; sem fatura, fica vazia.
 * @param props.creditCardName Cartão da coluna, para o nome do link.
 * @param props.compact No mês de referência e no seguinte a situação vai ao lado do valor, em
 * etiqueta, como no mockup; nos anteriores, embaixo, em texto discreto.
 * @return O conteúdo da célula.
 */
function InvoiceCell({ cell, creditCardName, compact }: { readonly cell: CardImpactCell; readonly creditCardName: string; readonly compact: boolean }): ReactNode {
    if (cell.notes.length === 0) {
        return null;
    }
    return (
        <span className={cn('flex', compact ? 'flex-wrap items-center gap-2' : 'flex-col')}>
            <span>{cell.amount}</span>
            {cell.notes.map((note) => (
                <Link
                    key={note.invoiceId}
                    to="/cards"
                    search={{ card: cell.creditCardId, invoice: note.invoicePeriod }}
                    aria-label={`${note.text} — abrir ${note.invoiceLabel} do ${creditCardName}`}
                    className={cn(NOTE_TONES[note.tone], 'hover:underline')}
                >
                    {note.text}
                </Link>
            ))}
        </span>
    );
}

/**
 * Esqueleto da tela: os três indicadores e a grade.
 *
 * @return O esqueleto marcado como ocupado.
 */
function ReportSkeleton(): ReactNode {
    return (
        <div role="status" aria-busy="true" aria-label="Carregando relatório" className="flex flex-col gap-5">
            <div className="grid grid-cols-3 gap-4">
                {[0, 1, 2].map((index) => (
                    <Skeleton key={index} className="h-26.5 rounded-10" />
                ))}
            </div>
            <Skeleton className="h-80 rounded-10" />
        </div>
    );
}
