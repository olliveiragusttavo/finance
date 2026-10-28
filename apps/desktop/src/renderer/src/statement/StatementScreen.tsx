import {
    adjustStatementRange,
    buildDailyStatementView,
    buildTransactionTable,
    formatMonthShort,
    statementMonthOptions,
    statementPeriods,
    statementPresets,
    useAccounts,
    useCategoryTree,
    useCreditCards,
    useProfileInvoicesByPeriods,
    useRecurrences,
    useTags,
    useTransactionsByPeriods,
    useTransferTargets,
    type DailyStatementCell,
    type DailyStatementKind,
    type DailyStatementView,
    type TransactionFilters,
} from '@finance/client';
import type { CoreInput } from '@finance/core';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { ErrorState, Skeleton } from '@/components/states';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ViewToggle } from '@/components/ViewToggle';
import { cn } from '@/lib/cn';
import { useActiveProfile } from '@/shell/activeProfile';
import { currentDate, currentPeriod } from '@/shell/referenceMonth';
import { TransactionFilterFields, useMonthInvoices } from '@/transactions/TransactionsScreen';
import { filtersFromSearch, searchFromFilters, withFilters } from '@/transactions/transactionsSearch';
import { parseStatementSearch, resolveStatementRange } from './statementSearch.ts';

/** Opções do filtro "Tipo", na ordem do mockup. */
const KIND_OPTIONS: readonly { readonly kind: DailyStatementKind; readonly label: string }[] = [
    { kind: 'all', label: 'Tudo' },
    { kind: 'income', label: 'Receitas' },
    { kind: 'expense', label: 'Despesas' },
];

/**
 * Extrato (mockup `DesktopExtrato`): os mesmos lançamentos de Transações, com os mesmos filtros,
 * num período de vários meses, numa tabela com o dia do mês nas linhas e os meses nas colunas.
 * Como não cabe descrever cada lançamento, a célula mostra o resultado do dia; clicar nela abre o
 * detalhe do dia acima da tabela. Os dados são os da tabela de Transações de cada mês
 * (`buildTransactionTable`), para que o Extrato nunca discorde da lista; as regras do período e da
 * soma ficam no `dailyStatementView` do `client`, e a tela só desenha.
 *
 * @return A tela do Extrato.
 */
export function StatementScreen(): ReactNode {
    const { profile } = useActiveProfile();
    const navigate = useNavigate();
    const search = useSearch({ strict: false, select: (raw: Readonly<Record<string, unknown>>) => parseStatementSearch(raw) });
    const filters = useMemo(() => filtersFromSearch(search), [search]);
    const now = new Date();
    const current = currentPeriod(now);
    const today = currentDate(now);
    const { from, to } = resolveStatementRange(search, now);
    const kind = search.kind ?? 'all';
    const periods = useMemo(() => statementPeriods(from, to), [from, to]);
    const periodInputs = useMemo(() => periods.map((period): CoreInput<'transactions.listByPeriod'> => ({ profileId: profile.id, period })), [periods, profile.id]);
    const transactions = useTransactionsByPeriods(periodInputs);
    const monthInvoices = useProfileInvoicesByPeriods(periodInputs);
    // Os cadastros só nomeiam as linhas: os do mês corrente servem para todo o período.
    const accounts = useAccounts({ profileId: profile.id, period: current });
    const otherProfileAccounts = useTransferTargets({ profileId: profile.id });
    const creditCards = useCreditCards({ profileId: profile.id, period: current });
    const categories = useCategoryTree({ profileId: profile.id });
    const tags = useTags({ profileId: profile.id });
    const recurrences = useRecurrences({ profileId: profile.id });
    const allTransactions = useMemo(() => transactions.data?.flat(), [transactions.data]);
    const invoices = useMonthInvoices(allTransactions);
    const [selection, setSelection] = useState<{ readonly period: string; readonly day: number } | null>(null);
    const [heat, setHeat] = useState(true);

    const view = useMemo(() => {
        const monthsTransactions = transactions.data;
        const monthsInvoices = monthInvoices.data;
        if (monthsTransactions === null || monthsInvoices === null || accounts.data === undefined || otherProfileAccounts.data === undefined || creditCards.data === undefined || categories.data === undefined) {
            return null;
        }
        return buildDailyStatementView({
            today,
            currency: profile.currency,
            kind,
            months: periods.map((period, index) => ({
                period,
                rows: buildTransactionTable(
                    {
                        profileId: profile.id,
                        transactions: monthsTransactions[index] ?? [],
                        accounts: accounts.data.accounts,
                        otherProfileAccounts: otherProfileAccounts.data,
                        creditCards: creditCards.data.creditCards,
                        categories: categories.data,
                        invoices,
                        recurrences: recurrences.data ?? [],
                        monthInvoices: monthsInvoices[index] ?? [],
                    },
                    filters,
                ).rows,
            })),
        });
    }, [today, profile.id, profile.currency, kind, periods, transactions.data, monthInvoices.data, accounts.data, otherProfileAccounts.data, creditCards.data, categories.data, invoices, recurrences.data, filters]);
    const failed = transactions.error ?? monthInvoices.error ?? [accounts, otherProfileAccounts, creditCards, categories].find((query) => query.error !== null)?.error ?? null;
    const selected = view === null ? null : (selectedCell(view, selection) ?? selectedCell(view, view.defaultSelection));

    /**
     * @param patch Parâmetros do Extrato a trocar; `undefined` tira o parâmetro da URL. Substitui a
     * entrada do histórico, como os filtros de Transações, para que cada tecla da busca não vire um
     * "voltar".
     */
    const changeSearch = (patch: Readonly<Record<string, unknown>>): void => {
        void navigate({ to: '/statement', search: (previous: Readonly<Record<string, unknown>>) => ({ ...previous, ...patch }), replace: true });
    };
    /**
     * @param next Filtros de Transações escolhidos; os parâmetros do período ficam como estão.
     */
    const changeFilters = (next: TransactionFilters): void => {
        void navigate({ to: '/statement', search: (previous: Readonly<Record<string, unknown>>) => withFilters(previous, next), replace: true });
    };
    /**
     * @param range Período novo; escolher de novo o padrão limpa a URL.
     */
    const changeRange = (range: { readonly from: string; readonly to: string }): void => {
        setSelection(null);
        changeSearch(range);
    };
    // "Lista" e o link do detalhe levam os mesmos filtros e o mês do dia aberto para Transações.
    const listSearch = { ...searchFromFilters(filters), period: selected?.period ?? to };

    return (
        <div className="flex flex-col gap-3.5">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                    <h1 className="text-24 font-semibold">Extrato</h1>
                    <span className="text-12 text-muted">Resultado de cada dia (receitas − despesas), com os mesmos filtros de Transações. Valores em {profile.currency === 'BRL' ? 'R$' : profile.currency}.</span>
                </div>
                <div className="flex items-center gap-2.5">
                    <span className="text-12 text-muted">Ver como</span>
                    <div role="group" aria-label="Visualização" className="flex gap-1.5">
                        <Link to="/transactions" search={listSearch} className="rounded-6 border border-line bg-surface px-2.5 py-1.25 text-13 text-ink outline-none hover:bg-surface2 focus-visible:ring-[3px] focus-visible:ring-accent/50">
                            Lista
                        </Link>
                        <ViewToggle pressed onClick={() => undefined}>
                            Tabela por dia
                        </ViewToggle>
                    </div>
                </div>
            </div>
            <FilterPanel
                current={current}
                from={from}
                to={to}
                kind={kind}
                filters={filters}
                onRange={changeRange}
                onKind={(next) => {
                    changeSearch({ kind: next === 'all' ? undefined : next });
                }}
                onFilters={(next) => {
                    setSelection(null);
                    changeFilters(next);
                }}
                fields={
                    <TransactionFilterFields
                        filters={filters}
                        accounts={accounts.data?.accounts ?? []}
                        creditCards={creditCards.data?.creditCards ?? []}
                        categories={categories.data ?? []}
                        tags={tags.data ?? []}
                        onChange={(next) => {
                            setSelection(null);
                            changeFilters(next);
                        }}
                    />
                }
            />
            {failed !== null ? (
                <ErrorState error={failed} />
            ) : view === null ? (
                <StatementSkeleton />
            ) : (
                <>
                    <DayDetail cell={selected} listSearch={listSearch} />
                    <Legend
                        heat={heat}
                        onHeat={() => {
                            setHeat((value) => !value);
                        }}
                    />
                    <DayMonthTable
                        view={view}
                        heat={heat}
                        selected={selected}
                        onSelect={(cell) => {
                            setSelection({ period: cell.period, day: cell.day });
                        }}
                    />
                    <p className="text-12 text-muted">Transferências entre contas do mesmo perfil não mudam o resultado do dia (saem de uma conta e entram na outra). Ao filtrar uma conta, elas passam a contar.</p>
                </>
            )}
        </div>
    );
}

/** Célula com valor, a única que se escolhe. */
type ValueCell = Extract<DailyStatementCell, { readonly kind: 'value' }>;

/**
 * @param view Extrato do período.
 * @param selection Mês e dia escolhidos; `null` sem escolha.
 * @return A célula escolhida, quando ela existe e tem valor no período e nos filtros atuais — a
 * escolha de um dia que o filtro esvaziou cai no padrão, em vez de um detalhe vazio.
 */
function selectedCell(view: DailyStatementView, selection: { readonly period: string; readonly day: number } | null): ValueCell | null {
    if (selection === null) {
        return null;
    }
    const column = view.months.findIndex((month) => month.period === selection.period);
    const cell = view.rows[selection.day - 1]?.cells[column];
    return cell?.kind === 'value' ? cell : null;
}

/**
 * Painel de filtros do mockup: período (atalhos, "De" e "Até"), tipo, os campos de Transações e a
 * busca, num cartão só acima da tabela.
 *
 * @param props.current Mês corrente, de onde os atalhos contam.
 * @param props.from Primeiro mês do período.
 * @param props.to Último mês do período.
 * @param props.kind Filtro "Tipo".
 * @param props.filters Filtros de Transações, para a busca.
 * @param props.onRange Recebe o período novo.
 * @param props.onKind Recebe o tipo novo.
 * @param props.onFilters Recebe os filtros de Transações novos (a busca).
 * @param props.fields Os campos de cadastro de Transações (`TransactionFilterFields`).
 * @return O painel.
 */
function FilterPanel({
    current,
    from,
    to,
    kind,
    filters,
    onRange,
    onKind,
    onFilters,
    fields,
}: {
    readonly current: string;
    readonly from: string;
    readonly to: string;
    readonly kind: DailyStatementKind;
    readonly filters: TransactionFilters;
    readonly onRange: (range: { readonly from: string; readonly to: string }) => void;
    readonly onKind: (kind: DailyStatementKind) => void;
    readonly onFilters: (filters: TransactionFilters) => void;
    readonly fields: ReactNode;
}): ReactNode {
    const months = statementMonthOptions(current);
    return (
        <div role="search" aria-label="Filtros" className="flex flex-wrap items-end gap-3 rounded-10 border border-line bg-surface px-3.5 py-3 text-13">
            <div className="flex flex-col gap-1">
                <span className="text-12 text-muted">Período</span>
                <div role="group" aria-label="Período" className="flex gap-1.5">
                    {statementPresets(current).map((preset) => (
                        <ViewToggle
                            key={preset.id}
                            pressed={preset.from === from && preset.to === to}
                            onClick={() => {
                                onRange({ from: preset.from, to: preset.to });
                            }}
                        >
                            {preset.label}
                        </ViewToggle>
                    ))}
                </div>
            </div>
            <MonthSelect
                label="De"
                accessibleLabel="Mês inicial"
                value={from}
                options={months}
                onChange={(value) => {
                    onRange(adjustStatementRange(value, to, 'from'));
                }}
            />
            <MonthSelect
                label="Até"
                accessibleLabel="Mês final"
                value={to}
                options={months}
                onChange={(value) => {
                    onRange(adjustStatementRange(from, value, 'to'));
                }}
            />
            <div className="flex flex-col gap-1">
                <span className="text-12 text-muted">Tipo</span>
                <div role="group" aria-label="Tipo" className="flex gap-1.5">
                    {KIND_OPTIONS.map((option) => (
                        <ViewToggle
                            key={option.kind}
                            pressed={kind === option.kind}
                            onClick={() => {
                                onKind(option.kind);
                            }}
                        >
                            {option.label}
                        </ViewToggle>
                    ))}
                </div>
            </div>
            {fields}
            <label className="flex min-w-40 flex-1 flex-col gap-1">
                <span className="text-12 text-muted">Buscar</span>
                <Input
                    type="search"
                    placeholder="nome ou descrição"
                    className="bg-bg"
                    value={filters.search}
                    onChange={(event) => {
                        onFilters({ ...filters, search: event.target.value });
                    }}
                />
            </label>
        </div>
    );
}

/**
 * Campo "De" ou "Até". Fica no `Select`, e não no `Combobox`: a lista de meses é fixa e em ordem,
 * como a situação em Transações.
 *
 * @param props.label Rótulo acima do campo.
 * @param props.accessibleLabel Nome do campo para o leitor de tela, o do mockup.
 * @param props.value Mês escolhido.
 * @param props.options Meses oferecidos.
 * @param props.onChange Recebe o mês escolhido.
 * @return O campo.
 */
function MonthSelect({
    label,
    accessibleLabel,
    value,
    options,
    onChange,
}: {
    readonly label: string;
    readonly accessibleLabel: string;
    readonly value: string;
    readonly options: readonly { readonly value: string; readonly label: string }[];
    readonly onChange: (value: string) => void;
}): ReactNode {
    const id = useId();
    // O mês da URL pode estar fora da lista (um link antigo); ele entra nela para o campo não ficar vazio.
    const all = options.some((option) => option.value === value) ? options : [{ value, label: formatMonthShort(value) }, ...options];
    return (
        <div className="flex flex-col gap-1">
            <label htmlFor={id} className="text-12 text-muted">
                {label}
            </label>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger id={id} aria-label={accessibleLabel} className="w-30 bg-bg">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {all.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}

/**
 * Faixa do dia escolhido: a data, os lançamentos, receitas, despesas, o resultado e a situação, e
 * o caminho para ver os lançamentos em Transações. É `aria-live` para que o leitor de tela anuncie
 * o dia ao clicar numa célula.
 *
 * @param props.cell Célula escolhida; `null` num período sem lançamento.
 * @param props.listSearch Busca de Transações com os filtros e o mês do dia.
 * @return A faixa.
 */
function DayDetail({ cell, listSearch }: { readonly cell: ValueCell | null; readonly listSearch: { readonly period: string } }): ReactNode {
    if (cell === null) {
        return (
            <div aria-live="polite" className="rounded-10 border border-line bg-surface px-4 py-3 text-13 text-muted">
                Nenhum lançamento no período com esses filtros.
            </div>
        );
    }
    const { detail } = cell;
    return (
        <div aria-live="polite" className="flex flex-wrap items-center gap-5.5 rounded-10 border border-line bg-surface px-4 py-2.5 text-13">
            <DetailItem label={detail.weekday}>{detail.date}</DetailItem>
            <DetailItem label="Lançamentos">{detail.count}</DetailItem>
            <DetailItem label="Receitas" className="text-in">
                {detail.income}
            </DetailItem>
            <DetailItem label="Despesas" className="text-out">
                {detail.expenses}
            </DetailItem>
            <DetailItem label="Resultado do dia" className={detail.tone === 'in' ? 'text-in' : 'text-out'}>
                {detail.result}
            </DetailItem>
            <DetailItem label="Situação">{detail.stateText}</DetailItem>
            <Link to="/transactions" search={listSearch} className="ml-auto text-accent hover:text-soft-ink">
                Ver lançamentos de {formatMonthShort(cell.period)} em Transações →
            </Link>
        </div>
    );
}

/**
 * @param props.label Rótulo pequeno acima do valor.
 * @param props.className Cor do valor (entrada e saída).
 * @param props.children Valor.
 * @return Um item da faixa do dia.
 */
function DetailItem({ label, className, children }: { readonly label: string; readonly className?: string; readonly children: ReactNode }): ReactNode {
    return (
        <span className="flex flex-col">
            <span className="text-12 text-muted">{label}</span>
            <b className={cn('text-15 font-semibold', className)}>{children}</b>
        </span>
    );
}

/** Hachura do dia que o mês não tem, só com o token da linha. */
const MISSING_DAY = 'bg-[repeating-linear-gradient(135deg,var(--color-line2)_0_4px,transparent_4px_8px)]';

/**
 * Legenda das marcas da tabela. A amostra repete o estilo da célula, para que cada marca se leia
 * sem depender só da cor: o sinal diz o sentido, o sublinhado o que vai vencer, a moldura o atraso.
 *
 * @param props.heat Se a tabela colore pela intensidade.
 * @param props.onHeat Liga ou desliga a cor pela intensidade.
 * @return A legenda.
 */
function Legend({ heat, onHeat }: { readonly heat: boolean; readonly onHeat: () => void }): ReactNode {
    return (
        <div className="flex flex-wrap items-center gap-4.5 text-12 text-muted">
            <LegendItem sample={<Sample className="text-in">+500</Sample>}>resultado positivo</LegendItem>
            <LegendItem sample={<Sample className="text-out">−1.830</Sample>}>negativo</LegendItem>
            <LegendItem sample={<Sample className={cn('text-out', STATE_STYLES.upcoming)}>−66</Sample>}>tem lançamento a vencer</LegendItem>
            <LegendItem sample={<Sample className={STATE_STYLES.overdue}>−200</Sample>}>tem lançamento atrasado</LegendItem>
            <LegendItem sample={<Sample className={MISSING_DAY} />}>dia não existe no mês</LegendItem>
            <span>· vazio = sem movimento · clique numa célula para ver o dia</span>
            <label className="ml-auto flex items-center gap-1.5 text-ink">
                <input type="checkbox" checked={heat} onChange={onHeat} className="accent-accent" />
                Colorir pela intensidade
            </label>
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
 * @param props.className Estilo da marca.
 * @param props.children Valor de exemplo; vazio na hachura.
 * @return A amostra no tamanho de uma célula pequena.
 */
function Sample({ className, children }: { readonly className?: string; readonly children?: string }): ReactNode {
    return <i className={cn('inline-block h-5 w-11.5 rounded-4 px-1.25 py-0.5 text-right text-11 font-semibold not-italic', className)}>{children}</i>;
}

/**
 * Marca de cada situação na célula. O que vai vencer é sublinhado e mais leve; o atraso tem fundo
 * e moldura de aviso: as duas se distinguem do pago sem depender só da cor (decisão de interface 7).
 */
const STATE_STYLES = {
    paid: '',
    upcoming: 'font-medium underline decoration-1 underline-offset-3 opacity-80',
    overdue: 'bg-warn-bg text-warn-ink shadow-[inset_0_0_0_1.5px_var(--color-warn-ink)]',
} as const;

/** Cor do texto de cada sentido; o zero fica apagado. */
const TONE_STYLES = { in: 'text-in', out: 'text-out', zero: 'text-muted' } as const;

/**
 * Fundo pela intensidade, em quatro degraus: classes inteiras, porque o Tailwind só gera o que
 * encontra escrito no código. O atraso não ganha fundo de intensidade: o de aviso vem primeiro.
 *
 * @param cell Célula com valor.
 * @return As classes do fundo; vazio no zero e no atraso.
 */
function heatOf(cell: ValueCell): string {
    if (cell.state === 'overdue' || cell.tone === 'zero') {
        return '';
    }
    const step = cell.intensity < 0.25 ? 0 : cell.intensity < 0.5 ? 1 : cell.intensity < 0.75 ? 2 : 3;
    const steps = cell.tone === 'in' ? ['bg-in/5', 'bg-in/15', 'bg-in/25', 'bg-in/40'] : ['bg-out/5', 'bg-out/15', 'bg-out/25', 'bg-out/40'];
    return steps[step] ?? '';
}

/**
 * Distância de cada linha do rodapé até a base da área que rola: as quatro linhas de 28px (`h-7`)
 * grudam empilhadas, a última embaixo. Classes inteiras, porque o Tailwind só gera o que encontra
 * escrito no código.
 */
const FOOTER_OFFSETS = ['bottom-21', 'bottom-14', 'bottom-7', 'bottom-0'] as const;

/**
 * A tabela dia × mês. Rola sozinha, com o cabeçalho dos meses, a coluna dos dias e o rodapé dos
 * totais grudados, para que doze colunas e 31 linhas continuem legíveis; cada célula com valor é
 * um botão que abre o dia na faixa de detalhe.
 *
 * @param props.view Extrato do período.
 * @param props.heat Se colore pela intensidade.
 * @param props.selected Célula aberta no detalhe.
 * @param props.onSelect Abre uma célula no detalhe.
 * @return A tabela.
 */
function DayMonthTable({ view, heat, selected, onSelect }: { readonly view: DailyStatementView; readonly heat: boolean; readonly selected: ValueCell | null; readonly onSelect: (cell: ValueCell) => void }): ReactNode {
    const stickyDay = 'sticky left-0 z-1 w-13 min-w-13 border-r border-line2 bg-surface2 text-center text-12 font-medium text-muted';
    const footer: readonly { readonly label: string; readonly value: (month: DailyStatementView['months'][number]) => string; readonly className: (month: DailyStatementView['months'][number]) => string }[] = [
        { label: 'Receitas', value: (month) => month.income, className: () => 'text-in' },
        { label: 'Despesas', value: (month) => month.expenses, className: () => 'text-out' },
        { label: 'Resultado', value: (month) => month.result, className: (month) => cn('text-13 font-semibold', month.resultTone === 'in' ? 'text-in' : 'text-out') },
        { label: 'Lançamentos', value: (month) => month.count, className: () => 'text-muted' },
    ];
    return (
        <section aria-label="Tabela por dia" className="overflow-hidden rounded-10 border border-line bg-surface">
            <Table aria-label="Resultado por dia e mês" containerClassName="max-h-[calc(100vh-200px)] min-h-100 overflow-auto" className="table-fixed border-separate border-spacing-0 text-13">
                <TableHeader className="[&_tr]:border-0">
                    <TableRow className="hover:bg-transparent">
                        <TableHead scope="col" className={cn(stickyDay, 'sticky top-0 z-3 h-auto border-b border-line px-2 py-2')}>
                            Dia
                        </TableHead>
                        {view.months.map((month) => (
                            <TableHead
                                key={month.period}
                                scope="col"
                                className={cn(
                                    'sticky top-0 z-2 h-auto border-r border-b border-line border-r-line2 bg-surface2 px-2 py-2 text-right text-12 font-medium text-muted',
                                    month.current && 'bg-soft font-semibold text-soft-ink',
                                )}
                            >
                                {month.label}
                            </TableHead>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {view.rows.map((row) => (
                        <TableRow key={row.day} className="border-0 hover:bg-transparent">
                            <TableHead scope="row" className={cn(stickyDay, 'h-7 border-b px-0')}>
                                {row.label}
                            </TableHead>
                            {row.cells.map((cell, index) => (
                                <TableCell key={view.months[index]?.period ?? index} className={cn('h-7 border-r border-b border-line2 p-0', cell.kind === 'missing' && MISSING_DAY)}>
                                    {cell.kind === 'value' && (
                                        <DayButton
                                            cell={cell}
                                            heat={heat}
                                            selected={selected?.period === cell.period && selected.day === cell.day}
                                            onSelect={() => {
                                                onSelect(cell);
                                            }}
                                        />
                                    )}
                                </TableCell>
                            ))}
                        </TableRow>
                    ))}
                </TableBody>
                <TableFooter className="border-0 bg-transparent font-normal">
                    {footer.map((line, lineIndex) => (
                        <TableRow key={line.label} className="border-0 hover:bg-transparent">
                            <TableHead
                                scope="row"
                                className={cn(FOOTER_OFFSETS[lineIndex], 'sticky left-0 z-3 h-7 bg-surface2 px-2 text-left text-12 font-medium text-muted', lineIndex === 0 && 'border-t border-line')}
                            >
                                {line.label}
                            </TableHead>
                            {view.months.map((month) => (
                                <TableCell
                                    key={month.period}
                                    className={cn(FOOTER_OFFSETS[lineIndex], 'sticky z-2 h-7 bg-surface2 px-2 py-0 text-right text-12', lineIndex === 0 && 'border-t border-line', line.className(month))}
                                >
                                    {line.value(month)}
                                </TableCell>
                            ))}
                        </TableRow>
                    ))}
                </TableFooter>
            </Table>
        </section>
    );
}

/**
 * Uma célula com valor: o resultado compacto, a marca da situação, a de hoje e a de escolhida.
 *
 * @param props.cell Célula com valor.
 * @param props.heat Se colore pela intensidade.
 * @param props.selected Se é a aberta no detalhe.
 * @param props.onSelect Abre a célula no detalhe.
 * @return O botão da célula.
 */
function DayButton({ cell, heat, selected, onSelect }: { readonly cell: ValueCell; readonly heat: boolean; readonly selected: boolean; readonly onSelect: () => void }): ReactNode {
    return (
        <button
            type="button"
            aria-label={cell.accessibleName}
            aria-pressed={selected}
            onClick={onSelect}
            className={cn(
                'block h-7 w-full px-2 text-right font-semibold whitespace-nowrap outline-none hover:ring-2 hover:ring-accent hover:ring-inset focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
                TONE_STYLES[cell.tone],
                STATE_STYLES[cell.state],
                heat && heatOf(cell),
                cell.today && 'shadow-[inset_3px_0_0_var(--color-accent)]',
                selected && 'ring-2 ring-accent ring-inset',
            )}
        >
            {cell.text}
        </button>
    );
}

/**
 * Esqueleto com a forma da tela: a faixa do dia e a tabela, para que nada pule quando os meses chegam.
 *
 * @return O esqueleto.
 */
function StatementSkeleton(): ReactNode {
    return (
        <div role="status" aria-busy="true" aria-label="Carregando extrato" className="flex flex-col gap-3.5">
            <Skeleton className="h-15 rounded-10" />
            <Skeleton className="h-150 rounded-10" />
        </div>
    );
}
