import { describeError, describeReportFilters, describeReportPeriod, useCoreMutation, useReportRun, useReports } from '@finance/client';
import type { ReportDefinitionResponse } from '@finance/core';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { DetailPane, ListPane, PaneLayout } from '@/components/PaneLayout';
import { QueryState, Skeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/cn';
import { useActiveProfile } from '@/shell/activeProfile';
import { useReferenceMonth } from '@/shell/useReferenceMonth';
import { BalanceProjectionReport } from './BalanceProjectionReport.tsx';
import { PartnerReport } from './PartnerReport.tsx';
import { ReportResult } from './ReportResult.tsx';
import { FIXED_REPORT_NAMES, fixedReportsFor, openReport, parseReportsSearch } from './reportsSearch.ts';
import { useReportLookups } from './useReportLookups.ts';

/**
 * Página de Relatórios (reports-design, Fase 15): à esquerda, os relatórios fixos no topo — a
 * projeção de saldo em todo perfil e a distribuição por sócio no empresarial (§8 e §9), que não se
 * montam no editor — e os salvos do perfil, por nome; à direita, o relatório aberto. Sem mockup
 * próprio; segue a lista e o detalhe de Contas e Cartões (decisão de interface 5 dos mockups). O
 * relatório aberto fica na URL (`report`); sem ele, abre o primeiro fixo.
 *
 * @return A página.
 */
export function ReportsScreen(): ReactNode {
    const { profile } = useActiveProfile();
    // Lida pelo `parseReportsSearch`, e não pelo tipo da rota: a tela é importada pelo roteador.
    const search = useSearch({ strict: false, select: (raw: Readonly<Record<string, unknown>>) => parseReportsSearch(raw) });
    const reports = useReports({ profileId: profile.id });
    const fixed = fixedReportsFor(profile.type);
    const open = reports.data === undefined ? null : openReport(reports.data, fixed, search);

    return (
        <PaneLayout>
            <ListPane
                label="Lista de relatórios"
                width="w-95"
                header={
                    <div className="flex items-center justify-between gap-2 px-5 pt-5 pb-3">
                        <h1 className="text-20 font-semibold">Relatórios</h1>
                        <Button asChild size="sm">
                            <Link to="/reports/edit">+ Novo</Link>
                        </Button>
                    </div>
                }
            >
                <ListGroup title="Fixados">
                    <ul aria-label="Relatórios fixos">
                        {fixed.map((report) => (
                            <ReportLink key={report} id={report} name={FIXED_REPORT_NAMES[report]} current={open?.kind === 'fixed' && open.report === report} />
                        ))}
                    </ul>
                </ListGroup>
                <ListGroup title="Meus relatórios">
                    <QueryState query={reports} loading={<Skeleton className="mx-5 h-40" />}>
                        {(list) => <ReportList reports={list} openId={open?.kind === 'saved' ? open.report.id : null} />}
                    </QueryState>
                </ListGroup>
            </ListPane>
            <DetailPane label="Relatório aberto">
                <QueryState query={reports} loading={<Skeleton className="h-60" />}>
                    {() => {
                        if (open === null) {
                            return null;
                        }
                        if (open.kind === 'saved') {
                            return <ReportDetail key={open.report.id} report={open.report} />;
                        }
                        return open.report === 'partners' ? <PartnerReport /> : <BalanceProjectionReport />;
                    }}
                </QueryState>
            </DetailPane>
        </PaneLayout>
    );
}

/**
 * Um grupo da lista, com o título pequeno em caixa alta dos formulários: separa os fixos, que o
 * app mantém, dos que o usuário montou.
 *
 * @param props.title Título do grupo.
 * @param props.children Os itens.
 * @return O grupo.
 */
function ListGroup({ title, children }: { readonly title: string; readonly children: ReactNode }): ReactNode {
    return (
        <section aria-label={title} className="pb-3">
            <h2 className="px-5 pt-2 pb-1.5 text-12 font-semibold tracking-wide text-muted uppercase">{title}</h2>
            {children}
        </section>
    );
}

/**
 * Um item da lista, com o aberto marcado.
 *
 * @param props.id Id do salvo ou chave do fixo, o valor de `report` na URL.
 * @param props.name Nome do relatório.
 * @param props.current Se é o aberto.
 * @return O item.
 */
function ReportLink({ id, name, current }: { readonly id: string; readonly name: string; readonly current: boolean }): ReactNode {
    return (
        <li>
            <Link
                to="/reports"
                search={(previous: Readonly<Record<string, unknown>>) => ({ ...previous, report: id })}
                aria-current={current ? 'page' : undefined}
                className={cn(
                    'block border-t border-line2 px-5 py-3 text-14 text-ink hover:bg-surface2',
                    current && 'bg-soft font-semibold shadow-[inset_3px_0_0_var(--color-accent)] hover:bg-soft',
                )}
            >
                {name}
            </Link>
        </li>
    );
}

/**
 * Os relatórios salvos, com o aberto marcado.
 *
 * @param props.reports Relatórios do perfil, por nome.
 * @param props.openId Relatório salvo aberto; `null` quando o aberto é um fixo.
 * @return A lista, ou o convite a montar o primeiro.
 */
function ReportList({ reports, openId }: { readonly reports: readonly ReportDefinitionResponse[]; readonly openId: string | null }): ReactNode {
    if (reports.length === 0) {
        return <p className="px-5 text-13 text-muted">Nenhum relatório salvo. Use "+ Novo" para montar um escolhendo o período, os lançamentos e como os números aparecem.</p>;
    }
    return (
        <ul aria-label="Relatórios">
            {reports.map((report) => (
                <ReportLink key={report.id} id={report.id} name={report.name} current={report.id === openId} />
            ))}
        </ul>
    );
}

/**
 * O relatório aberto: nome, o que entrou (meses, base de data e filtros), as ações e o resultado
 * no mês de referência.
 *
 * @param props.report Definição aberta.
 * @return O detalhe.
 */
function ReportDetail({ report }: { readonly report: ReportDefinitionResponse }): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const result = useReportRun({ id: report.id, period });
    const lookups = useReportLookups();
    const [deleting, setDeleting] = useState(false);
    const filters = lookups === null ? [] : describeReportFilters(report.filter, lookups, profile.currency);

    return (
        <>
            <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                    <h2 className="text-24 font-semibold">{report.name}</h2>
                    {result.data !== undefined && <p className="text-13 text-muted">{describeReportPeriod(report.filter, result.data.from, result.data.to)}</p>}
                </div>
                <div className="flex shrink-0 gap-2">
                    <Button asChild variant="outline">
                        <Link to="/reports/edit" search={(previous: Readonly<Record<string, unknown>>) => ({ ...previous, report: report.id })}>
                            Editar
                        </Link>
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        className="text-danger"
                        onClick={() => {
                            setDeleting(true);
                        }}
                    >
                        Excluir
                    </Button>
                </div>
            </div>
            {filters.length > 0 && (
                <ul aria-label="Filtros" className="flex flex-wrap gap-2">
                    {filters.map((filter) => (
                        <li key={filter} className="rounded-6 bg-track px-2.5 py-1 text-13 text-ink2">
                            {filter}
                        </li>
                    ))}
                </ul>
            )}
            <QueryState query={result} loading={<Skeleton className="h-60" />}>
                {(data) => <ReportResult result={data} format={report.layout.format} name={report.name} currency={profile.currency} analysis={report.layout.analysis} />}
            </QueryState>
            {deleting && (
                <DeleteReportDialog
                    report={report}
                    onClose={() => {
                        setDeleting(false);
                    }}
                />
            )}
        </>
    );
}

/**
 * Confirmação de excluir o relatório. Diz que os lançamentos não mudam, porque o relatório é só a
 * pergunta salva: nada além da definição se perde.
 *
 * @param props.report Relatório a excluir.
 * @param props.onClose Fecha o alerta, depois de excluir ou ao desistir.
 * @return O alerta.
 */
function DeleteReportDialog({ report, onClose }: { readonly report: ReportDefinitionResponse; readonly onClose: () => void }): ReactNode {
    const remove = useCoreMutation('reports.delete');
    const navigate = useNavigate();
    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
        >
            <DialogContent showCloseButton={false} role="alertdialog">
                <DialogHeader>
                    <DialogTitle>Excluir o relatório {report.name}?</DialogTitle>
                    <DialogDescription>Só a configuração do relatório é apagada; os lançamentos continuam como estão.</DialogDescription>
                </DialogHeader>
                {remove.error !== null && (
                    <p role="alert" className="text-13 text-danger">
                        {describeError(remove.error.error).message}
                    </p>
                )}
                <DialogFooter>
                    <Button type="button" variant="outline" autoFocus onClick={onClose}>
                        Cancelar
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        disabled={remove.isPending}
                        onClick={() => {
                            remove.mutate(
                                { id: report.id },
                                {
                                    onSuccess: () => {
                                        toast.success(`Relatório ${report.name} excluído.`);
                                        onClose();
                                        void navigate({ to: '/reports', search: (previous: Readonly<Record<string, unknown>>) => ({ ...previous, report: undefined }) });
                                    },
                                },
                            );
                        }}
                    >
                        {remove.isPending ? 'Excluindo…' : 'Excluir relatório'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
