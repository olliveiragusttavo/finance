import {
    buildCalendarView,
    buildTransactionTable,
    formatDate,
    NO_TRANSACTION_FILTERS,
    useAccounts,
    useCategoryTree,
    useCreditCards,
    useProfileInvoices,
    useRecurrences,
    useStatements,
    useTransactions,
    useTransferTargets,
    type CalendarDay,
    type CalendarEntry,
    type CalendarEntryState,
    type CalendarKpi,
    type CalendarLine,
    type CalendarMode,
    type CalendarView,
} from '@finance/client';
import type { CoreInput } from '@finance/core';
import { useMemo, useState, type ReactNode } from 'react';
import { ErrorState, Skeleton } from '@/components/states';
import { ViewToggle } from '@/components/ViewToggle';
import { cn } from '@/lib/cn';
import { useActiveProfile } from '@/shell/activeProfile';
import { currentDate } from '@/shell/referenceMonth';
import { useReferenceMonth } from '@/shell/useReferenceMonth';
import { useMonthInvoices } from '@/transactions/TransactionsScreen';
import { useTransactionActions } from '@/transactions/useTransactionActions';

/** Nomes curtos dos dias no cabeçalho da grade, de domingo a sábado, como no mockup. */
const WEEKDAY_HEADERS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

/**
 * Calendário (mockup `DesktopCalendario`): os lançamentos do mês de referência distribuídos pelos
 * dias do vencimento, com os indicadores do mês e o painel do dia escolhido. Os dois modos —
 * "Receitas × despesas" e "Saldo do dia" — e todas as regras vêm do `calendarView` do `client`; a
 * tela só desenha. Os dados são os da tabela agrupada de Transações e os extratos das contas que
 * entram no saldo, para que o calendário nunca discorde de Transações nem de Contas. Editar, marcar
 * pago e abrir a fatura usam as mesmas ações da listagem de movimentos (`useTransactionActions`).
 *
 * @return A tela do Calendário.
 */
export function CalendarScreen(): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const today = currentDate(new Date());
    const transactions = useTransactions({ profileId: profile.id, period });
    const accounts = useAccounts({ profileId: profile.id, period });
    const otherProfileAccounts = useTransferTargets({ profileId: profile.id });
    const creditCards = useCreditCards({ profileId: profile.id, period });
    const categories = useCategoryTree({ profileId: profile.id });
    const recurrences = useRecurrences({ profileId: profile.id });
    const monthInvoices = useProfileInvoices({ profileId: profile.id, period });
    const invoices = useMonthInvoices(transactions.data);
    // Regra de negócio (Contas): o saldo do perfil soma só as contas com "considerar no saldo".
    const statementInputs = useMemo(
        () => (accounts.data?.accounts ?? []).filter((account) => account.considerBalance).map((account): CoreInput<'statements.get'> => ({ accountId: account.id, period })),
        [accounts.data, period],
    );
    const statements = useStatements(statementInputs);
    const [mode, setMode] = useState<CalendarMode>('flows');
    const [selection, setSelection] = useState<{ readonly period: string; readonly day: number } | null>(null);
    const actions = useTransactionActions();

    const view = useMemo(
        () =>
            transactions.data === undefined || accounts.data === undefined || otherProfileAccounts.data === undefined || creditCards.data === undefined || categories.data === undefined || monthInvoices.data === undefined || statements.pending
                ? null
                : buildCalendarView({
                      period,
                      today,
                      profileId: profile.id,
                      currency: profile.currency,
                      rows: buildTransactionTable(
                          {
                              profileId: profile.id,
                              transactions: transactions.data,
                              accounts: accounts.data.accounts,
                              otherProfileAccounts: otherProfileAccounts.data,
                              creditCards: creditCards.data.creditCards,
                              categories: categories.data,
                              invoices,
                              recurrences: recurrences.data ?? [],
                              monthInvoices: monthInvoices.data,
                          },
                          NO_TRANSACTION_FILTERS,
                      ).rows,
                      statements: statements.statements,
                  }),
        [period, today, profile.id, profile.currency, transactions.data, accounts.data, otherProfileAccounts.data, creditCards.data, categories.data, invoices, recurrences.data, monthInvoices.data, statements],
    );
    const failed = [transactions, accounts, otherProfileAccounts, creditCards, categories, monthInvoices].find((query) => query.error !== null)?.error ?? statements.error;
    // A escolha vale só no mês em que foi feita: ao trocar de mês, volta ao dia padrão.
    const selectedDay = view === null ? null : (view.days.find((day) => selection?.period === period && day.day === selection.day) ?? defaultDay(view));

    return (
        <div className="flex flex-col gap-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                    <h1 className="text-24 font-semibold">Calendário</h1>
                    <span className="text-12 text-muted">Hoje, {formatDate(today)} · lançamentos pela data de vencimento</span>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-12 text-muted">Mostrar</span>
                    <div role="group" aria-label="Modo do calendário" className="flex gap-1.5">
                        <ViewToggle
                            pressed={mode === 'flows'}
                            onClick={() => {
                                setMode('flows');
                            }}
                        >
                            Receitas × despesas
                        </ViewToggle>
                        <ViewToggle
                            pressed={mode === 'balance'}
                            onClick={() => {
                                setMode('balance');
                            }}
                        >
                            Saldo do dia
                        </ViewToggle>
                    </div>
                </div>
            </div>
            {failed !== null ? (
                <ErrorState error={failed} />
            ) : view === null || selectedDay === null ? (
                <CalendarSkeleton />
            ) : (
                <>
                    <Summary view={view} />
                    <Legend mode={mode} />
                    <div className="grid grid-cols-[minmax(0,1fr)_360px] items-start gap-4">
                        <MonthGrid
                            view={view}
                            mode={mode}
                            selected={selectedDay.day}
                            onSelect={(day) => {
                                setSelection({ period, day });
                            }}
                        />
                        <DayPanel day={selectedDay} actions={actions} />
                    </div>
                </>
            )}
            {actions.dialogs}
        </div>
    );
}

/**
 * Dia aberto no painel quando o usuário ainda não escolheu: hoje, se for deste mês; senão o primeiro
 * dia com lançamento, para que o painel não abra vazio num mês com movimento.
 *
 * @param view Calendário do mês.
 * @return O dia padrão; o dia 1 num mês sem lançamento.
 */
function defaultDay(view: CalendarView): CalendarDay | null {
    return view.days.find((day) => day.today) ?? view.days.find((day) => day.entries.length > 0) ?? view.days[0] ?? null;
}

/**
 * Os quatro indicadores do mês. O de atrasados ganha borda de aviso quando há atraso, para que o
 * número chame atenção sem depender só da cor do texto.
 *
 * @param props.view Calendário do mês.
 * @return A fileira de indicadores.
 */
function Summary({ view }: { readonly view: CalendarView }): ReactNode {
    const { income, expenses, balance, overdue } = view.summary;
    return (
        <section aria-label="Resumo do mês" className="grid grid-cols-4 gap-3">
            <KpiCard kpi={income} valueClassName="text-in" />
            <KpiCard kpi={expenses} valueClassName="text-out" />
            <KpiCard kpi={balance} />
            <KpiCard kpi={overdue} className={cn(overdue.alert && 'border-warn-ink')} />
        </section>
    );
}

/**
 * Um indicador: rótulo, valor e a explicação curta. O rótulo e o valor formam um grupo nomeado,
 * para que o leitor de tela leia "Receitas no mês" junto do número.
 *
 * @param props.kpi Indicador já formatado.
 * @param props.className Classes da moldura, para o destaque do atraso.
 * @param props.valueClassName Cor do valor (entrada e saída).
 * @return O cartão do indicador.
 */
function KpiCard({ kpi, className, valueClassName }: { readonly kpi: CalendarKpi; readonly className?: string; readonly valueClassName?: string }): ReactNode {
    return (
        <div role="group" aria-label={kpi.label} className={cn('flex flex-col gap-0.5 rounded-10 border border-line bg-surface px-3.5 py-2.5', className)}>
            <span className="text-12 text-muted">{kpi.label}</span>
            <span className={cn('text-18 font-semibold', valueClassName)}>{kpi.value}</span>
            <span className="text-12 text-muted">{kpi.sub}</span>
        </div>
    );
}

/**
 * Legenda do modo aberto. Explica o tracejado do que ainda vai vencer e o `⚠` do atraso, e diz o
 * que fica de fora de cada modo, para que o dia vazio não pareça erro.
 *
 * @param props.mode Modo do calendário.
 * @return A legenda.
 */
function Legend({ mode }: { readonly mode: CalendarMode }): ReactNode {
    return (
        <div className="flex flex-wrap items-center gap-4.5 text-12 text-muted">
            {mode === 'flows' ? (
                <>
                    <LegendItem sample={<LineChip direction="in" state="paid">+R$</LineChip>}>Receita realizada</LegendItem>
                    <LegendItem sample={<LineChip direction="out" state="paid">−R$</LineChip>}>Despesa paga</LegendItem>
                    <LegendItem sample={<LineChip direction="out" state="upcoming">−R$</LineChip>}>Futura ou a pagar</LegendItem>
                    <LegendItem sample={<LineChip direction="out" state="overdue">⚠ −R$</LineChip>}>Atrasada (venceu e não foi paga)</LegendItem>
                    <span>· Transferências entre contas não aparecem neste modo. Dias sem movimento ficam vazios.</span>
                </>
            ) : (
                <>
                    <LegendItem sample={<b className="font-semibold text-ink">R$</b>}>Saldo consolidado no fim do dia</LegendItem>
                    <LegendItem sample={<span className="text-muted">R$</span>}>Saldo previsto (dias que ainda não chegaram)</LegendItem>
                    <LegendItem sample={<OverdueFlag count={1} />}>Dia com lançamento atrasado</LegendItem>
                    <span>· Só dias com movimento, incluindo transferências.</span>
                </>
            )}
        </div>
    );
}

/**
 * @param props.sample Amostra do estilo.
 * @param props.children O que a amostra quer dizer.
 * @return Um item da legenda.
 */
function LegendItem({ sample, children }: { readonly sample: ReactNode; readonly children: string }): ReactNode {
    return (
        <span className="inline-flex items-center gap-1.5">
            {sample}
            {children}
        </span>
    );
}

/**
 * Estilo de cada situação na linha do dia. O que ainda vai vencer é tracejado e mais leve, o atraso
 * tem fundo de aviso e o `⚠` no texto: as três se distinguem sem depender só da cor (decisão de
 * interface 7). As entradas e saídas pagas usam o tom do sentido sobre um fundo do mesmo token.
 */
const LINE_STYLES: Readonly<Record<CalendarEntryState, Readonly<Record<'in' | 'out', string>>>> = {
    paid: { in: 'bg-in/10 text-in', out: 'bg-out/10 text-out' },
    upcoming: { in: 'border border-dashed border-current font-medium text-in opacity-75', out: 'border border-dashed border-current font-medium text-out opacity-75' },
    overdue: { in: 'border border-warn-ink bg-warn-bg text-warn-ink', out: 'border border-warn-ink bg-warn-bg text-warn-ink' },
};

/**
 * Etiqueta de valor no quadrado do dia e na legenda.
 *
 * @param props.direction Entrada ou saída.
 * @param props.state Situação.
 * @param props.className Classes a mais (largura na grade).
 * @param props.children Conteúdo.
 * @return A etiqueta.
 */
function LineChip({ direction, state, className, children }: { readonly direction: 'in' | 'out'; readonly state: CalendarEntryState; readonly className?: string; readonly children: ReactNode }): ReactNode {
    return (
        <span className={cn('inline-flex min-w-0 items-center justify-between gap-1 overflow-hidden rounded-6 px-1.5 py-0.5 text-11 font-semibold whitespace-nowrap min-[1680px]:text-12', LINE_STYLES[state][direction], className)}>
            {children}
        </span>
    );
}

/**
 * Marca de dia com atraso, usada no modo "Saldo do dia", onde as linhas de valor não aparecem.
 *
 * @param props.count Lançamentos atrasados no dia.
 * @return A marca.
 */
function OverdueFlag({ count }: { readonly count: number }): ReactNode {
    return <span className="inline-flex items-center gap-0.5 rounded-4 border border-warn-ink bg-warn-bg px-1.25 text-11 font-semibold text-warn-ink">⚠ {count}</span>;
}

/**
 * A grade do mês, de domingo a sábado. Cada dia é um botão que abre o painel ao lado; as casas
 * fora do mês só completam as semanas.
 *
 * @param props.view Calendário do mês.
 * @param props.mode Modo do calendário.
 * @param props.selected Dia aberto no painel.
 * @param props.onSelect Abre um dia no painel.
 * @return A grade.
 */
function MonthGrid({ view, mode, selected, onSelect }: { readonly view: CalendarView; readonly mode: CalendarMode; readonly selected: number; readonly onSelect: (day: number) => void }): ReactNode {
    const blanks = (count: number, prefix: string): ReactNode[] => Array.from({ length: count }, (_, index) => <div key={`${prefix}${String(index)}`} aria-hidden="true" className="min-h-29.5 border-r border-b border-line2 bg-surface2 [&:nth-child(7n)]:border-r-0" />);
    return (
        <section aria-label="Calendário do mês" className="overflow-hidden rounded-10 border border-line bg-surface">
            <div aria-hidden="true" className="grid grid-cols-7 border-b border-line bg-surface2 text-12 text-muted">
                {WEEKDAY_HEADERS.map((name) => (
                    <span key={name} className="px-2.5 py-2">
                        {name}
                    </span>
                ))}
            </div>
            <div className="grid grid-cols-7">
                {blanks(view.leadingBlanks, 'lead')}
                {view.days.map((day) => (
                    <DayCell
                        key={day.date}
                        day={day}
                        mode={mode}
                        selected={day.day === selected}
                        onSelect={() => {
                            onSelect(day.day);
                        }}
                    />
                ))}
                {blanks(view.trailingBlanks, 'trail')}
            </div>
        </section>
    );
}

/**
 * Um dia da grade: o número (hoje em destaque), a marca de atraso e, conforme o modo, as somas de
 * receitas e despesas ou o saldo no fim do dia.
 *
 * @param props.day Dia do calendário.
 * @param props.mode Modo do calendário.
 * @param props.selected Se é o dia aberto no painel.
 * @param props.onSelect Abre o dia no painel.
 * @return O botão do dia.
 */
function DayCell({ day, mode, selected, onSelect }: { readonly day: CalendarDay; readonly mode: CalendarMode; readonly selected: boolean; readonly onSelect: () => void }): ReactNode {
    const { balance } = day;
    return (
        <button
            type="button"
            aria-label={day.accessibleName}
            aria-pressed={selected}
            onClick={onSelect}
            className={cn(
                'flex min-h-29.5 min-w-0 flex-col gap-1 border-r border-b border-line2 px-1.5 pt-1.5 pb-2 text-left outline-none hover:bg-surface2 focus-visible:ring-[3px] focus-visible:ring-accent/50 focus-visible:ring-inset [&:nth-child(7n)]:border-r-0',
                selected && 'ring-2 ring-accent ring-inset',
            )}
        >
            <span className="flex items-center justify-between">
                <span className={cn('flex size-6 items-center justify-center rounded-full text-13 font-semibold', day.today && 'bg-accent text-on-accent')}>{day.day}</span>
                {mode === 'balance' && day.overdueCount > 0 && <OverdueFlag count={day.overdueCount} />}
            </span>
            {mode === 'flows' && day.lines.map((line) => <DayLine key={line.key} line={line} />)}
            {mode === 'balance' && balance !== null && (
                <span className="mt-auto flex flex-col gap-px">
                    <span className={cn('text-14 whitespace-nowrap min-[1680px]:text-16', balance.projected ? 'font-medium text-muted' : 'font-semibold', balance.negative && 'text-out', balance.negative && balance.projected && 'opacity-75')}>{balance.value}</span>
                    <span className="text-11 leading-tight text-muted">{balance.detail}</span>
                </span>
            )}
        </button>
    );
}

/**
 * @param props.line Soma de um sentido numa situação.
 * @return A linha de valor no quadrado do dia, com o nome quando ela tem um lançamento só.
 */
function DayLine({ line }: { readonly line: CalendarLine }): ReactNode {
    return (
        <LineChip direction={line.direction} state={line.state} className="w-full">
            <span className="shrink-0">{line.amountText}</span>
            {line.name !== null && <span className="truncate font-normal opacity-85">{line.name}</span>}
        </LineChip>
    );
}

/** Estilo da etiqueta de situação no painel do dia. */
const STATE_TAG_STYLES: Readonly<Record<CalendarEntryState, string>> = {
    paid: 'bg-ok-bg text-ok-ink',
    upcoming: 'border border-dashed border-muted text-muted',
    overdue: 'bg-warn-ink text-warn-bg',
};

/** Cor do valor no painel; a transferência fica na cor do texto, e o `⇄` diz o que ela é. */
const AMOUNT_TONES: Readonly<Record<CalendarEntry['direction'], string>> = {
    in: 'text-in',
    out: 'text-out',
    transfer: 'text-ink',
};

/**
 * Painel do dia escolhido: cada lançamento com a situação e a ação que cabe a ele, e o resultado
 * do dia. Fica grudado no topo da área que rola, para continuar à vista ao descer pela grade.
 *
 * @param props.day Dia aberto.
 * @param props.actions Ações da listagem de movimentos: editar, marcar pago, abrir a fatura.
 * @return O painel.
 */
function DayPanel({ day, actions }: { readonly day: CalendarDay; readonly actions: ReturnType<typeof useTransactionActions> }): ReactNode {
    return (
        <aside aria-label="Lançamentos do dia" className="sticky top-0 overflow-hidden rounded-10 border border-line bg-surface">
            <div className="flex flex-col gap-0.5 border-b border-line px-4 py-3.5">
                <span className="text-12 text-muted">{day.weekday}</span>
                <span className="text-18 font-semibold">{day.title}</span>
            </div>
            {day.entries.length === 0 ? (
                <p className="px-4 py-6 text-center text-13 text-muted">Nenhum lançamento neste dia.</p>
            ) : (
                <ul>
                    {day.entries.map((entry) => (
                        <DayEntry key={entry.id} entry={entry} actions={actions} />
                    ))}
                </ul>
            )}
            {day.result !== null && (
                <div className="flex justify-between bg-surface2 px-4 py-2.5 text-13">
                    <span className="text-muted">Resultado do dia</span>
                    <b className={cn('font-semibold', day.result.tone === 'in' ? 'text-in' : 'text-out')}>{day.result.text}</b>
                </div>
            )}
        </aside>
    );
}

/**
 * Um lançamento no painel. O nome abre a edição (ou a fatura, na linha da fatura); o botão à
 * direita faz a ação que o `calendarView` decidiu para a linha.
 *
 * @param props.entry Lançamento do dia.
 * @param props.actions Ações da listagem de movimentos.
 * @return O item da lista.
 */
function DayEntry({ entry, actions }: { readonly entry: CalendarEntry; readonly actions: ReturnType<typeof useTransactionActions> }): ReactNode {
    const { movement, action } = entry;
    const overdue = entry.state === 'overdue';
    return (
        <li className={cn('grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 border-b border-line2 px-4 py-2.5 text-13', overdue && 'bg-warn-bg text-warn-ink')}>
            <button
                type="button"
                onClick={() => {
                    actions.open(movement.target);
                }}
                className="flex min-w-0 flex-col rounded-4 text-left outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-accent/50"
            >
                <span className="truncate font-medium">{movement.name}</span>
                <span className={cn('truncate text-12', overdue ? 'opacity-85' : 'text-muted')}>
                    {movement.category} · {movement.container}
                </span>
            </button>
            <span className={cn('text-right font-semibold', overdue ? 'text-warn-ink' : AMOUNT_TONES[entry.direction])}>{movement.amountText}</span>
            <span className={cn('justify-self-start rounded-full px-2 py-px text-11 font-semibold', STATE_TAG_STYLES[entry.state])}>{entry.stateText}</span>
            {action !== null && (
                <button
                    type="button"
                    onClick={() => {
                        if (action.kind === 'openInvoice') {
                            actions.open(action.target);
                        } else {
                            actions.togglePaid(action.target, movement.name);
                        }
                    }}
                    className="justify-self-end rounded-8 border border-current px-2.5 py-1 text-12 outline-none focus-visible:ring-[3px] focus-visible:ring-accent/50"
                >
                    {action.label}
                </button>
            )}
        </li>
    );
}

/**
 * Esqueleto com a forma da tela: indicadores, grade e painel, para que nada pule quando os dados
 * chegam.
 *
 * @return O esqueleto da tela.
 */
function CalendarSkeleton(): ReactNode {
    return (
        <div role="status" aria-busy="true" aria-label="Carregando calendário" className="flex flex-col gap-3.5">
            <div className="grid grid-cols-4 gap-3">
                {[0, 1, 2, 3].map((index) => (
                    <Skeleton key={index} className="h-19 rounded-10" />
                ))}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_360px] items-start gap-4">
                <Skeleton className="h-150 rounded-10" />
                <Skeleton className="h-60 rounded-10" />
            </div>
        </div>
    );
}
