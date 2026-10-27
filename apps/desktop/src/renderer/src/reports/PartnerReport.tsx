import {
    buildPartnerReportView,
    buildUnassignedEntryList,
    describeError,
    useAccounts,
    useCategoryTree,
    useCoreMutation,
    useCreditCards,
    useEntriesWithoutPartner,
    usePartnerReport,
    useTags,
    useTransferTargets,
    type PartnerKpi,
    type PartnerReportView,
    type UnassignedEntryRow,
} from '@finance/client';
import type { PartnerLineResponse } from '@finance/core';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { QueryState, Skeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ViewToggle } from '@/components/ViewToggle';
import { cn } from '@/lib/cn';
import { useActiveProfile } from '@/shell/activeProfile';
import { useReferenceMonth } from '@/shell/useReferenceMonth';

/**
 * Distribuição por sócio, fixada no topo dos Relatórios do perfil empresarial (reports-design §8;
 * desktop-mvp-plan Fases 13.6 e 13.8): quanto cada sócio aportou contra quanto deveria pela
 * participação no total de aportes, o acerto e as entradas do mês sem sócio, que podem ser
 * atribuídas ali mesmo.
 * Regra de negócio (Sócios — aportes, reports-design §8): toda despesa é paga pela empresa; os
 * aportes são as receitas e as transferências vindas de outro perfil com sócio, de todos os
 * períodos. O mês de referência só recorta os indicadores do mês e a lista de entradas sem sócio.
 * Diverge do mockup `DesktopRelSocio`, desenhado sobre despesas, por decisão do usuário. A tela só
 * arruma o que o núcleo agregou, pelo `partnerReport` do `client`. Só é oferecida no perfil
 * empresarial (`fixedReportsFor`), e por isso não trata o pessoal, que o núcleo recusaria.
 *
 * @return O relatório por sócio.
 */
export function PartnerReport(): ReactNode {
    return (
        <>
            <div className="flex items-end justify-between gap-4">
                <div className="flex flex-col gap-1">
                    <span className="text-12 text-muted">Relatório fixo · só no perfil empresarial</span>
                    <h2 className="text-24 font-semibold">Distribuição por sócio</h2>
                </div>
                <Button asChild variant="outline">
                    <Link to="/partners">Editar sócios e participações</Link>
                </Button>
            </div>
            <PartnerReportBody />
        </>
    );
}

/**
 * O corpo do relatório, com as consultas.
 *
 * @return Indicadores, tabela, gráfico com o acerto e as entradas sem sócio.
 */
function PartnerReportBody(): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const report = usePartnerReport({ profileId: profile.id, period });

    return (
        <QueryState query={report} loading={<ReportSkeleton />}>
            {(data) => {
                const view = buildPartnerReportView(data);
                return (
                    <>
                        <section aria-label="Indicadores" className="grid grid-cols-3 gap-4">
                            <KpiCard kpi={view.kpis.contributions} />
                            <KpiCard kpi={view.kpis.month} />
                            <KpiCard kpi={view.kpis.unassigned} />
                        </section>
                        {view.sharesWarning !== null && (
                            <p role="status" className="rounded-8 bg-warn-bg px-3.5 py-2.5 text-13 text-warn-ink">
                                {view.sharesWarning}
                            </p>
                        )}
                        {/* Empilhados: ao lado da lista de relatórios, a tabela e o gráfico lado a lado não cabem. */}
                        <div className="flex flex-col gap-4">
                            <PartnerTable view={view} />
                            <ContributedVersusExpected view={view} />
                        </div>
                        {data.unassignedCount > 0 && <UnassignedSection partners={data.partners} />}
                    </>
                );
            }}
        </QueryState>
    );
}

/**
 * Um indicador: rótulo, valor e a explicação curta embaixo, num grupo nomeado para que o leitor
 * de tela leia o rótulo junto do número. A entrada sem sócio não pede atenção: a receita de serviço
 * é lucro e fica sem sócio mesmo.
 *
 * @param props.kpi Indicador já formatado.
 * @return O cartão do indicador.
 */
function KpiCard({ kpi }: { readonly kpi: PartnerKpi }): ReactNode {
    return (
        <div role="group" aria-label={kpi.label} className="flex flex-col gap-1.5 rounded-10 border border-line bg-surface p-4">
            <span className="text-13 text-muted">{kpi.label}</span>
            <span className="text-22 font-semibold tabular-nums">{kpi.value}</span>
            <span className="text-12 text-muted">{kpi.sub}</span>
        </div>
    );
}

/**
 * Tabela dos sócios com o total de aportes. As entradas sem sócio não entram: não são aporte. A
 * diferença leva seta, sinal e palavras, para não depender só da cor (decisão de interface 7).
 *
 * @param props.view Relatório pronto do `client`.
 * @return A tabela.
 */
function PartnerTable({ view }: { readonly view: PartnerReportView }): ReactNode {
    return (
        <section className="overflow-hidden rounded-10 border border-line bg-surface">
            <Table aria-label="Sócios" className="text-13">
                <TableHeader>
                    <TableRow className="bg-surface2 hover:bg-surface2">
                        <TableHead className="px-4">Sócio</TableHead>
                        <TableHead className="text-right">Participação</TableHead>
                        <TableHead className="text-right">Deveria ter aportado</TableHead>
                        <TableHead className="text-right">Aportou</TableHead>
                        <TableHead className="px-4 text-right">Diferença</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {view.rows.map((row) => (
                        <TableRow key={row.partnerId} className="border-line2 tabular-nums">
                            <TableCell className="px-4 font-semibold">{row.name}</TableCell>
                            <TableCell className="text-right">{row.share}</TableCell>
                            <TableCell className="text-right">{row.expected}</TableCell>
                            <TableCell className="text-right">{row.contributed}</TableCell>
                            <TableCell className={cn('px-4 text-right', row.balance === 'more' ? 'text-in' : row.balance === 'less' ? 'text-out' : 'text-muted')}>{row.difference}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
                <TableFooter className="bg-surface2">
                    <TableRow className="font-semibold tabular-nums hover:bg-surface2">
                        <TableCell className="px-4">Total</TableCell>
                        <TableCell className="text-right">{view.total.share}</TableCell>
                        <TableCell className="text-right">{view.total.expected}</TableCell>
                        <TableCell className="text-right">{view.total.contributed}</TableCell>
                        <TableCell className="px-4" />
                    </TableRow>
                </TableFooter>
            </Table>
        </section>
    );
}

/** Como "Aportou × deveria" aparece: as barras do mockup ou a tabela equivalente. */
type ComparisonMode = 'chart' | 'table';

/**
 * "Aportou × deveria": as barras do mockup (aportou cheia, deveria tracejada, na mesma cor — a
 * diferença não depende da cor) com a alternância Gráfico/Tabela dos outros relatórios, e embaixo
 * o acerto dos aportes.
 *
 * @param props.view Relatório pronto do `client`.
 * @return O bloco do gráfico com o acerto.
 */
function ContributedVersusExpected({ view }: { readonly view: PartnerReportView }): ReactNode {
    const [mode, setMode] = useState<ComparisonMode>('chart');
    return (
        <section aria-labelledby="partner-chart-title" className="flex flex-col gap-3.5 rounded-10 border border-line bg-surface p-5">
            <div className="flex items-center justify-between gap-3">
                <h2 id="partner-chart-title" className="text-16 font-semibold">
                    Aportou × deveria
                </h2>
                {view.hasPartners && (
                    <div role="group" aria-label="Exibição" className="flex gap-1">
                        <ViewToggle pressed={mode === 'chart'} onClick={() => { setMode('chart'); }}>
                            Gráfico
                        </ViewToggle>
                        <ViewToggle pressed={mode === 'table'} onClick={() => { setMode('table'); }}>
                            Tabela
                        </ViewToggle>
                    </div>
                )}
            </div>
            {view.hasPartners && (mode === 'chart' ? <PartnerBarsChart view={view} /> : <PartnerBarsTable view={view} />)}
            <Settlement view={view} />
        </section>
    );
}

/**
 * Duas barras por sócio, proporcionais ao maior valor. Desenho com `div`, e não com o Recharts,
 * porque são poucas barras sem eixo nem dica; os valores exatos estão na tabela.
 *
 * @param props.view Relatório pronto do `client`.
 * @return O gráfico, com a legenda.
 */
function PartnerBarsChart({ view }: { readonly view: PartnerReportView }): ReactNode {
    return (
        <>
            <div className="flex gap-4 text-12 text-muted">
                <span className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="size-3 rounded-2 bg-accent" />
                    Aportou
                </span>
                <span className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="size-3 rounded-2 border-[1.5px] border-dashed border-accent" />
                    Deveria
                </span>
            </div>
            <div role="img" aria-label="Aportou e deveria de cada sócio; os valores estão na tabela" className="flex flex-col gap-3.5">
                {view.bars.map((bar) => (
                    <div key={bar.partnerId} className="flex flex-col gap-1.5">
                        <span className="text-13">{bar.name}</span>
                        <span className="block h-2.5 rounded-r-3 bg-accent" style={{ width: `${String(bar.contributedWidth)}%` }} />
                        <span className="block h-2.5 rounded-r-3 border-[1.5px] border-dashed border-accent" style={{ width: `${String(bar.expectedWidth)}%` }} />
                    </div>
                ))}
            </div>
        </>
    );
}

/**
 * A alternativa em tabela do gráfico, para quem prefere ler os números lado a lado.
 *
 * @param props.view Relatório pronto do `client`.
 * @return A tabela aportou × deveria.
 */
function PartnerBarsTable({ view }: { readonly view: PartnerReportView }): ReactNode {
    return (
        <Table aria-label="Aportou × deveria" className="text-13">
            <TableHeader>
                <TableRow className="hover:bg-transparent">
                    <TableHead>Sócio</TableHead>
                    <TableHead className="text-right">Aportou</TableHead>
                    <TableHead className="text-right">Deveria</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {view.rows.map((row) => (
                    <TableRow key={row.partnerId} className="border-line2 tabular-nums">
                        <TableCell>{row.name}</TableCell>
                        <TableCell className="text-right">{row.contributed}</TableCell>
                        <TableCell className="text-right">{row.expected}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}

/**
 * O quadro do acerto: as transferências que equilibram os aportes, ou por que não há nenhuma.
 *
 * @param props.view Relatório pronto do `client`.
 * @return O quadro.
 */
function Settlement({ view }: { readonly view: PartnerReportView }): ReactNode {
    if (view.transfers.length === 0) {
        return <p className="rounded-8 bg-soft px-3.5 py-3 text-14 text-soft-ink">{view.note}</p>;
    }
    return (
        <div className="rounded-8 bg-soft px-3.5 py-3 text-14 text-soft-ink">
            <p>Para equilibrar os aportes:</p>
            <ul aria-label="Acerto dos aportes" className="mt-1 flex flex-col gap-0.5">
                {view.transfers.map((transfer) => (
                    <li key={`${transfer.from}:${transfer.to}`}>
                        {transfer.from} transfere <b className="tabular-nums">{transfer.amount}</b> para {transfer.to}.
                    </li>
                ))}
            </ul>
        </div>
    );
}

/**
 * Entradas do mês sem sócio — receitas e transferências vindas de outro perfil —, com a escolha de
 * quem aportou em cada linha. Atribuir grava só aquele lançamento (numa série, só a ocorrência), e
 * o relatório se refaz pela invalidação do `client`. A receita de serviço fica sem sócio: é lucro.
 * As contas dos outros perfis entram para nomear a origem das transferências recebidas.
 *
 * @param props.partners Sócios do perfil, as opções de "Quem aportou".
 * @return A seção com a lista.
 */
function UnassignedSection({ partners }: { readonly partners: readonly PartnerLineResponse[] }): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const entries = useEntriesWithoutPartner({ profileId: profile.id, period });
    const accounts = useAccounts({ profileId: profile.id, period });
    const creditCards = useCreditCards({ profileId: profile.id, period });
    const categories = useCategoryTree({ profileId: profile.id });
    const tags = useTags({ profileId: profile.id });
    const otherAccounts = useTransferTargets({ profileId: profile.id });

    return (
        <section aria-labelledby="unassigned-title" className="overflow-hidden rounded-10 border border-line bg-surface">
            <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                <h2 id="unassigned-title" className="text-16 font-semibold">
                    Entradas sem sócio
                </h2>
                <span className="text-12 text-muted">{partners.length > 0 ? 'Atribua as que são aporte; receita de serviço fica sem sócio' : 'Cadastre os sócios do perfil para atribuir'}</span>
            </div>
            <QueryState query={entries} loading={<Skeleton className="mx-4 mb-4 h-24" />}>
                {(data) => {
                    if (accounts.data === undefined || creditCards.data === undefined || categories.data === undefined || tags.data === undefined || otherAccounts.data === undefined) {
                        return <Skeleton className="mx-4 mb-4 h-24" />;
                    }
                    const list = buildUnassignedEntryList(data, {
                        profileId: profile.id,
                        accounts: accounts.data.accounts,
                        creditCards: creditCards.data.creditCards,
                        categories: categories.data,
                        tags: tags.data,
                        otherProfileAccounts: otherAccounts.data,
                    });
                    return (
                        <Table aria-label="Entradas sem sócio" className="text-13">
                            <TableHeader>
                                <TableRow className="bg-surface2 hover:bg-surface2">
                                    <TableHead className="w-16 px-4">Data</TableHead>
                                    <TableHead>Nome</TableHead>
                                    <TableHead>Categoria › Sub</TableHead>
                                    <TableHead>Conta</TableHead>
                                    <TableHead className="text-right">Valor</TableHead>
                                    <TableHead className="w-52 px-4">Quem aportou</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {list.rows.map((row) => (
                                    <UnassignedRow key={row.id} row={row} partners={partners} />
                                ))}
                            </TableBody>
                            <TableFooter className="bg-surface2">
                                <TableRow className="font-semibold tabular-nums hover:bg-surface2">
                                    <TableCell className="px-4" colSpan={4}>
                                        Total
                                    </TableCell>
                                    <TableCell className="text-right">{list.totalText}</TableCell>
                                    <TableCell className="px-4" />
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
 * Uma entrada sem sócio. A escolha grava na hora: é um campo só, e um botão "Salvar" por linha
 * seria um passo a mais para a mesma decisão.
 *
 * @param props.row Linha pronta do `client`.
 * @param props.partners Sócios do perfil.
 * @return A linha da tabela.
 */
function UnassignedRow({ row, partners }: { readonly row: UnassignedEntryRow; readonly partners: readonly PartnerLineResponse[] }): ReactNode {
    const setPartner = useCoreMutation('transactions.setPartner');

    /**
     * @param partnerId Sócio escolhido; o `Select` devolve texto, e só um dos sócios é aceito.
     */
    const assign = (partnerId: string): void => {
        const partner = partners.find((candidate) => candidate.partnerId === partnerId);
        if (partner === undefined) {
            return;
        }
        setPartner.mutate(
            { id: row.id, partnerId: partner.partnerId },
            {
                onSuccess: () => {
                    toast.success(`“${row.name}” atribuído a ${partner.name}.`);
                },
                onError: (error) => {
                    toast.error(describeError(error.error).message);
                },
            },
        );
    };

    return (
        <TableRow className="border-line2">
            <TableCell className="px-4 tabular-nums">{row.date}</TableCell>
            <TableCell>{row.name}</TableCell>
            <TableCell className="text-ink2">{row.category}</TableCell>
            <TableCell>{row.container}</TableCell>
            <TableCell className={cn('text-right tabular-nums', row.direction === 'out' ? 'text-out' : row.direction === 'in' ? 'text-in' : 'text-ink2')}>{row.amountText}</TableCell>
            <TableCell className="px-4">
                {partners.length === 0 ? (
                    <span className="text-muted">—</span>
                ) : (
                    <Select value="" onValueChange={assign} disabled={setPartner.isPending}>
                        <SelectTrigger aria-label={`Quem aportou: ${row.name}`} className="h-8 w-full bg-bg text-13">
                            <SelectValue placeholder="Escolher sócio" />
                        </SelectTrigger>
                        <SelectContent>
                            {partners.map((partner) => (
                                <SelectItem key={partner.partnerId} value={partner.partnerId}>
                                    {partner.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
            </TableCell>
        </TableRow>
    );
}

/**
 * Esqueleto do relatório: os três indicadores e os dois blocos.
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
            <div className="flex flex-col gap-4">
                <Skeleton className="h-48 rounded-10" />
                <Skeleton className="h-48 rounded-10" />
            </div>
        </div>
    );
}
