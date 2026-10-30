import { Currency, LocalDate, Money, YearMonth } from '@finance/core';
import type { MoneyResponse, StatementResponse } from '@finance/core';
import { formatMonthLong } from '../format/dates.ts';
import { formatMoney } from '../format/money.ts';
import { movementsFromTransactions, type MovementRow, type MovementTarget } from './movementList.ts';
import { buildStatementTable, type StatementRow } from './statementTable.ts';
import type { TransactionTableRow } from './transactionTable.ts';

/*
 * Calendário do mês (mockup `DesktopCalendario`): os lançamentos de Transações distribuídos pelos
 * dias do vencimento, nos modos "Receitas × despesas" e "Saldo do dia". Fica no `client`, e não na
 * tela, porque o celular vai mostrar o mesmo mês com as mesmas regras e as mesmas palavras
 * (desktop-shell-design §4.2).
 */

/** O que cada dia mostra: entradas e saídas ou o saldo no fim do dia. */
export type CalendarMode = 'flows' | 'balance';

/**
 * Situação de um lançamento no calendário:
 * - `paid`: pago ou recebido (a fatura paga também);
 * - `upcoming`: em aberto com vencimento hoje ou depois;
 * - `overdue`: em aberto com vencimento antes de hoje.
 */
export type CalendarEntryState = 'paid' | 'upcoming' | 'overdue';

/** Rótulos da situação no painel do dia, os do mockup. */
const STATE_LABELS: Readonly<Record<CalendarEntryState, string>> = {
    paid: 'Pago',
    upcoming: 'A vencer',
    overdue: 'Atrasado',
};

/** Sentido do valor; `transfer` é a transferência dentro do perfil e o valor zero. */
export type CalendarDirection = 'in' | 'out' | 'transfer';

/** Um lançamento no painel do dia, com a linha da listagem comum para editar e pagar. */
export interface CalendarEntry {
    readonly id: string;
    readonly movement: MovementRow;
    readonly direction: CalendarDirection;
    /** Valor com sinal, o mesmo da linha de Transações, para as somas do dia e do mês. */
    readonly amount: MoneyResponse;
    readonly state: CalendarEntryState;
    /** `Pago`, `A vencer` ou `Atrasado`. */
    readonly stateText: string;
    /**
     * O que o botão do painel faz: marcar pago ou recebido, abrir a fatura, ou nada — a compra no
     * cartão e a transferência recebida de outro perfil não se pagam por aqui.
     */
    readonly action: CalendarEntryAction | null;
}

/** Ação do painel do dia num lançamento. */
export interface CalendarEntryAction {
    readonly kind: 'markPaid' | 'openInvoice';
    /** `Marcar pago`, `Marcar recebido` ou `Abrir fatura`. */
    readonly label: string;
    readonly target: MovementTarget;
}

/** Uma linha dentro do quadrado do dia: a soma de um sentido numa situação. */
export interface CalendarLine {
    /** `in|overdue`: estável entre renders, para a chave da lista. */
    readonly key: string;
    readonly direction: 'in' | 'out';
    readonly state: CalendarEntryState;
    /** `+R$ 6,00`, `⚠ −R$ 200,00`: o sinal e o `⚠` dizem o sentido e o atraso sem a cor. */
    readonly amountText: string;
    /** Nome do lançamento quando a linha tem um só; `null` quando soma vários. */
    readonly name: string | null;
}

/** O saldo no fim de um dia com movimento. */
export interface CalendarDayBalance {
    readonly value: string;
    readonly negative: boolean;
    /** Dia que ainda não chegou: o valor é o previsto, com peso menor (decisão de interface 6). */
    readonly projected: boolean;
    /** `+R$ 515,00 no dia`, `sem mudança no consolidado` ou `previsto`. */
    readonly detail: string;
}

/** Um dia do mês no calendário. */
export interface CalendarDay {
    /** `YYYY-MM-DD`. */
    readonly date: string;
    readonly day: number;
    readonly today: boolean;
    /** Todos os lançamentos que vencem no dia, transferências incluídas, para o painel. */
    readonly entries: readonly CalendarEntry[];
    /** Linhas do modo "Receitas × despesas": sem transferências, os atrasados primeiro. */
    readonly lines: readonly CalendarLine[];
    readonly overdueCount: number;
    /** Saldo no fim do dia; `null` no dia sem movimento, que fica vazio no modo "Saldo do dia". */
    readonly balance: CalendarDayBalance | null;
    /** `Domingo`, `Segunda-feira`... */
    readonly weekday: string;
    /** `11 de outubro de 2026`. */
    readonly title: string;
    /** Nome do botão do dia para o leitor de tela, com a contagem de lançamentos e atrasados. */
    readonly accessibleName: string;
    /** `+R$ 27,00`: receitas menos despesas do dia, sem transferências; `null` sem nenhuma. */
    readonly result: { readonly text: string; readonly tone: 'in' | 'out' } | null;
}

/** Um indicador do topo do calendário. */
export interface CalendarKpi {
    readonly label: string;
    readonly value: string;
    readonly sub: string;
}

/** Os quatro indicadores do mês. */
export interface CalendarSummary {
    readonly income: CalendarKpi;
    readonly expenses: CalendarKpi;
    readonly balance: CalendarKpi;
    readonly overdue: CalendarKpi & { readonly alert: boolean };
}

/** O mês pronto para a grade. */
export interface CalendarView {
    /** Casas vazias antes do dia 1, com a semana começando no domingo, como no mockup. */
    readonly leadingBlanks: number;
    /** Casas vazias depois do último dia, para fechar a última semana. */
    readonly trailingBlanks: number;
    readonly days: readonly CalendarDay[];
    readonly summary: CalendarSummary;
}

/** O que a tela já tem em cache para montar o calendário. */
export interface CalendarSource {
    /** Mês de referência `YYYY-MM`. */
    readonly period: string;
    /** Hoje `YYYY-MM-DD`, no relógio do aparelho: decide atrasado, a vencer e consolidado × previsto. */
    readonly today: string;
    /** Perfil aberto, para as permissões das linhas. */
    readonly profileId: string;
    /** Moeda do perfil, para os totais de um mês sem lançamento. */
    readonly currency: string;
    /**
     * Linhas da tabela agrupada de Transações (`buildTransactionTable` sem filtro e com as faturas
     * do mês): a compra no cartão entra pela linha da fatura, no dia em que ela pesa na conta.
     */
    readonly rows: readonly TransactionTableRow[];
    /** Extratos do mês das contas que entram no saldo do perfil ("considerar no saldo"). */
    readonly statements: readonly StatementResponse[];
}

/** Nomes dos dias da semana, de domingo a sábado. */
const WEEKDAYS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'] as const;

/**
 * Ordem das linhas no quadrado do dia: o atraso primeiro, porque é o que pede ação, depois o que
 * já aconteceu e por fim o que ainda vai acontecer; em cada uma, a entrada antes da saída.
 */
const LINE_ORDER: readonly (readonly ['in' | 'out', CalendarEntryState])[] = [
    ['in', 'overdue'],
    ['out', 'overdue'],
    ['in', 'paid'],
    ['out', 'paid'],
    ['in', 'upcoming'],
    ['out', 'upcoming'],
];

/**
 * Monta o calendário do mês de referência.
 *
 * Regra de negócio (Calendário): cada lançamento fica no dia do **vencimento**, como na lista de
 * Transações (a compra no cartão, na linha da fatura, no dia em que ela pesa na conta); o que está
 * em aberto com vencimento antes de hoje é **atrasado**. O modo "Receitas × despesas" deixa de fora
 * as transferências dentro do perfil, que só movem dinheiro entre contas; a transferência entre
 * perfis entra, porque para este perfil o dinheiro de fato saiu ou chegou — a mesma regra do
 * resultado de Transações.
 *
 * Regra de negócio (Calendário, saldo do dia): o saldo do perfil no fim de cada dia com movimento,
 * somando só as contas com "considerar no saldo", como o total de Contas. Até hoje é o
 * **consolidado** (o que já foi pago, pela data de caixa); depois de hoje é o **previsto** (tudo o
 * que está lançado, pelo vencimento), com peso menor — o consolidado de um dia futuro só repetiria
 * o de hoje. Os dois partem do saldo inicial dos extratos do mês e somam as linhas deles, então o
 * último dia bate com o fechamento de Contas.
 *
 * @param source Mês, hoje, as linhas de Transações e os extratos das contas do total.
 * @return A grade do mês, os lançamentos de cada dia e os indicadores.
 */
export function buildCalendarView(source: CalendarSource): CalendarView {
    const month = YearMonth.parse(source.period);
    const currency = Currency.of(source.currency);
    const today = LocalDate.parse(source.today);
    const movements = new Map(movementsFromTransactions(source.rows, source.profileId).map((movement) => [movement.id, movement]));
    const entriesByDay = groupEntries(source.rows, movements, today);
    const balances = dailyBalances(source.statements, month, currency);
    const length = month.lengthInDays();
    const days: CalendarDay[] = [];
    for (let day = 1; day <= length; day++) {
        const date = LocalDate.of(month.year, month.month, day);
        const entries = entriesByDay.get(day) ?? [];
        days.push(buildDay(date, entries, balances, today, currency));
    }
    const leadingBlanks = LocalDate.of(month.year, month.month, 1).dayOfWeek() % 7;
    return {
        leadingBlanks,
        trailingBlanks: (7 - ((leadingBlanks + length) % 7)) % 7,
        days,
        summary: summarize(days, balances, month, today, currency),
    };
}

/**
 * Traduz as linhas de Transações em lançamentos do calendário, agrupados pelo dia do vencimento.
 *
 * @param rows Linhas da tabela agrupada de Transações.
 * @param movements Linhas da listagem comum, por id, com o que abrir e pagar.
 * @param today Hoje, para separar o atrasado do que ainda vai vencer.
 * @return Os lançamentos de cada dia, na ordem da tabela (data e nome).
 */
function groupEntries(rows: readonly TransactionTableRow[], movements: ReadonlyMap<string, MovementRow>, today: LocalDate): ReadonlyMap<number, readonly CalendarEntry[]> {
    const byDay = new Map<number, CalendarEntry[]>();
    for (const row of rows) {
        const movement = movements.get(row.id);
        if (movement === undefined) {
            continue;
        }
        const state = stateOf(row, today);
        const direction: CalendarDirection = row.direction === 'in' || row.direction === 'out' ? row.direction : 'transfer';
        const entry: CalendarEntry = { id: row.id, movement, direction, amount: row.amount, state, stateText: STATE_LABELS[state], action: actionOf(movement, direction, state) };
        const day = LocalDate.parse(row.dueDate).day;
        byDay.set(day, [...(byDay.get(day) ?? []), entry]);
    }
    return byDay;
}

/**
 * Regra de negócio (Calendário): pago é o lançamento pago e a fatura paga; o resto está em aberto,
 * atrasado quando venceu antes de hoje. A compra no cartão segue a fatura (database-design §4.7),
 * por isso a situação vem da tabela de Transações, que já aplica essa regra.
 *
 * @param row Linha de Transações.
 * @param today Hoje.
 * @return A situação no calendário.
 */
function stateOf(row: TransactionTableRow, today: LocalDate): CalendarEntryState {
    if (row.situation === 'paid' || row.situation === 'invoicePaid') {
        return 'paid';
    }
    return LocalDate.parse(row.dueDate).isBefore(today) ? 'overdue' : 'upcoming';
}

/**
 * O botão de cada lançamento em aberto no painel. Só oferece marcar pago onde o clique de fato
 * paga (`movementPermissions`); a fatura em aberto leva a Cartões, onde se paga, em vez de um botão
 * que só mostraria um aviso.
 *
 * @param movement Linha da listagem comum.
 * @param direction Sentido, para "pago" ou "recebido".
 * @param state Situação no calendário.
 * @return A ação, ou `null` no pago e no que não se paga daqui.
 */
function actionOf(movement: MovementRow, direction: CalendarDirection, state: CalendarEntryState): CalendarEntryAction | null {
    if (state === 'paid') {
        return null;
    }
    const { target } = movement;
    if (target.kind === 'invoice') {
        return { kind: 'openInvoice', label: 'Abrir fatura', target };
    }
    if (target.readOnly || !target.payable) {
        return null;
    }
    return { kind: 'markPaid', label: direction === 'in' ? 'Marcar recebido' : 'Marcar pago', target };
}

/** Saldo do perfil no fim de cada dia do mês, nas duas versões. */
interface DailyBalances {
    /** Índice 0 é o saldo inicial do mês; o índice `d`, o fim do dia `d`. */
    readonly consolidated: readonly Money[];
    readonly projected: readonly Money[];
    /** Dias com alguma linha nos extratos (data de caixa), transferências incluídas. */
    readonly movedDays: ReadonlySet<number>;
}

/**
 * Acumula os extratos do mês dia a dia. As linhas vêm do `buildStatementTable`, o mesmo do extrato
 * de Contas, para que a data de caixa, a situação e o sinal de cada uma sejam os de lá; os nomes não
 * importam aqui, então os cadastros vão vazios. A fatura paga sem dia gravado entra no último dia,
 * porque não se sabe em que ponto do mês ela saiu.
 * Regra de negócio (Saldos, database-design §3.7): o consolidado soma só o pago; o previsto, tudo.
 *
 * @param statements Extratos do mês das contas do total.
 * @param month Mês de referência.
 * @param currency Moeda do perfil.
 * @return Os saldos no fim de cada dia e os dias com movimento.
 */
function dailyBalances(statements: readonly StatementResponse[], month: YearMonth, currency: Currency): DailyBalances {
    const length = month.lengthInDays();
    const consolidatedDelta: Money[] = Array.from({ length: length + 1 }, () => Money.zero(currency));
    const projectedDelta: Money[] = Array.from({ length: length + 1 }, () => Money.zero(currency));
    const movedDays = new Set<number>();
    let consolidatedOpening = Money.zero(currency);
    let projectedOpening = Money.zero(currency);
    for (const statement of statements) {
        consolidatedOpening = consolidatedOpening.add(toMoney(statement.opening.consolidated));
        projectedOpening = projectedOpening.add(toMoney(statement.opening.projected));
        for (const row of buildStatementTable({ statement, accounts: [], creditCards: [], categories: [] }).rows) {
            const day = cashDayOf(row, month);
            const amount = toMoney(row.amount);
            movedDays.add(day);
            projectedDelta[day] = (projectedDelta[day] ?? Money.zero(currency)).add(amount);
            if (row.situation === 'paid' || row.situation === 'invoicePaid') {
                consolidatedDelta[day] = (consolidatedDelta[day] ?? Money.zero(currency)).add(amount);
            }
        }
    }
    return { consolidated: accumulate(consolidatedOpening, consolidatedDelta), projected: accumulate(projectedOpening, projectedDelta), movedDays };
}

/**
 * @param row Linha do extrato.
 * @param month Mês do extrato.
 * @return O dia da data de caixa; o último dia na fatura paga sem dia gravado ou numa data que,
 * por algum motivo, caia fora do mês — o valor nunca some do saldo.
 */
function cashDayOf(row: StatementRow, month: YearMonth): number {
    if (row.cashDate === null) {
        return month.lengthInDays();
    }
    const date = LocalDate.parse(row.cashDate);
    return date.period.equals(month) ? date.day : month.lengthInDays();
}

/**
 * @param opening Saldo inicial.
 * @param deltas Movimento de cada dia; o índice 0 fica sem uso.
 * @return O saldo no fim de cada dia, com o inicial no índice 0.
 */
function accumulate(opening: Money, deltas: readonly Money[]): readonly Money[] {
    const totals: Money[] = [opening];
    for (let day = 1; day < deltas.length; day++) {
        totals.push((totals[day - 1] ?? opening).add(deltas[day] ?? Money.zero(opening.currency)));
    }
    return totals;
}

/**
 * @param date Dia.
 * @param entries Lançamentos que vencem nele.
 * @param balances Saldos do mês.
 * @param today Hoje.
 * @param currency Moeda do perfil.
 * @return O dia com as linhas, o saldo e os textos.
 */
function buildDay(date: LocalDate, entries: readonly CalendarEntry[], balances: DailyBalances, today: LocalDate, currency: Currency): CalendarDay {
    const day = date.day;
    const overdueCount = entries.filter((entry) => entry.state === 'overdue').length;
    const title = `${String(day)} de ${formatMonthLong(date.period.toString()).toLowerCase()}`;
    const counts = entries.length === 0 ? 'sem movimento' : `${String(entries.length)} ${entries.length === 1 ? 'lançamento' : 'lançamentos'}`;
    const late = overdueCount === 0 ? '' : `, ${String(overdueCount)} ${overdueCount === 1 ? 'atrasado' : 'atrasados'}`;
    return {
        date: date.toString(),
        day,
        today: date.equals(today),
        entries,
        lines: linesOf(entries, currency),
        overdueCount,
        balance: entries.length > 0 || balances.movedDays.has(day) ? balanceOf(day, date, balances, today) : null,
        weekday: WEEKDAYS[date.dayOfWeek() % 7] ?? '',
        title,
        accessibleName: `${title}, ${counts}${late}`,
        result: resultOf(entries, currency),
    };
}

/**
 * Soma os lançamentos do dia por sentido e situação. O quadrado é pequeno: uma linha por
 * combinação, com o nome só quando ela tem um lançamento.
 *
 * @param entries Lançamentos do dia.
 * @param currency Moeda do perfil.
 * @return As linhas, na ordem de `LINE_ORDER`, sem transferências.
 */
function linesOf(entries: readonly CalendarEntry[], currency: Currency): readonly CalendarLine[] {
    return LINE_ORDER.flatMap(([direction, state]): CalendarLine[] => {
        const group = entries.filter((entry) => entry.direction === direction && entry.state === state);
        const first = group[0];
        if (first === undefined) {
            return [];
        }
        const total = sum(group.map((entry) => entry.amount), currency);
        return [{
            key: `${direction}|${state}`,
            direction,
            state,
            amountText: `${state === 'overdue' ? '⚠ ' : ''}${formatMoney(total, 'always')}`,
            name: group.length === 1 ? first.movement.name : null,
        }];
    });
}

/**
 * Até hoje vale o consolidado, depois o previsto: num dia que ainda não chegou, o consolidado só
 * repetiria o de hoje, e o previsto é o que o usuário quer saber ("vou ficar no vermelho?").
 *
 * @param day Dia do mês.
 * @param date Data do dia.
 * @param balances Saldos do mês.
 * @param today Hoje.
 * @return O saldo no fim do dia e a explicação curta.
 */
function balanceOf(day: number, date: LocalDate, balances: DailyBalances, today: LocalDate): CalendarDayBalance {
    const projected = today.isBefore(date);
    const series = projected ? balances.projected : balances.consolidated;
    const value = series[day] ?? series[0];
    if (value === undefined) {
        throw new Error('saldo do mês sem o saldo inicial');
    }
    const previous = balances.consolidated[day - 1] ?? value;
    const delta = toResponse(value.subtract(previous));
    return {
        value: formatMoney(toResponse(value)),
        negative: value.rounded().isNegative(),
        projected,
        detail: projected ? 'previsto' : delta.amount === 0 ? 'sem mudança no consolidado' : `${formatMoney(delta, 'always')} no dia`,
    };
}

/**
 * Regra de negócio (Transações): o resultado é receitas menos despesas; transferências dentro do
 * perfil ficam de fora, como no resumo de Transações.
 *
 * @param entries Lançamentos do dia.
 * @param currency Moeda do perfil.
 * @return O resultado com sinal e o tom; `null` sem receita nem despesa.
 */
function resultOf(entries: readonly CalendarEntry[], currency: Currency): CalendarDay['result'] {
    const flows = entries.filter((entry) => entry.direction !== 'transfer');
    if (flows.length === 0) {
        return null;
    }
    const total = sum(flows.map((entry) => entry.amount), currency);
    return { text: formatMoney(total, 'always'), tone: total.amount < 0 ? 'out' : 'in' };
}

/**
 * Os indicadores do mês. O saldo segue o mesmo corte do dia: no mês corrente, o consolidado de
 * hoje com o previsto do fim do mês embaixo; num mês passado, o consolidado do fim do mês; num mês
 * futuro, o previsto.
 *
 * @param days Dias do mês.
 * @param balances Saldos do mês.
 * @param month Mês de referência.
 * @param today Hoje.
 * @param currency Moeda do perfil.
 * @return Receitas, despesas, saldo e atrasados.
 */
function summarize(days: readonly CalendarDay[], balances: DailyBalances, month: YearMonth, today: LocalDate, currency: Currency): CalendarSummary {
    const entries = days.flatMap((day) => day.entries);
    const total = (direction: 'in' | 'out', paid: boolean | null): MoneyResponse => sum(
        entries.filter((entry) => entry.direction === direction && (paid === null || (entry.state === 'paid') === paid)).map((entry) => entry.amount),
        currency,
    );
    const absolute = (money: MoneyResponse): string => formatMoney(money, 'absolute');
    const overdue = entries.filter((entry) => entry.state === 'overdue' && entry.direction !== 'transfer');
    const overdueTotal = sum(overdue.map((entry) => entry.amount), currency);
    return {
        income: { label: 'Receitas no mês', value: absolute(total('in', null)), sub: `${absolute(total('in', true))} recebido · ${absolute(total('in', false))} a receber` },
        expenses: { label: 'Despesas no mês', value: absolute(total('out', null)), sub: `${absolute(total('out', true))} pago · ${absolute(total('out', false))} a pagar` },
        balance: balanceKpi(balances, month, today),
        overdue: overdue.length === 0
            ? { label: 'Atrasados', value: 'Nenhum', sub: 'Tudo em dia neste mês', alert: false }
            : { label: 'Atrasados', value: `${String(overdue.length)} · ${formatMoney(overdueTotal, 'always')}`, sub: 'Venceram e não foram pagos', alert: true },
    };
}

/**
 * @param balances Saldos do mês.
 * @param month Mês de referência.
 * @param today Hoje.
 * @return O indicador de saldo do mês, conforme o mês seja passado, corrente ou futuro.
 */
function balanceKpi(balances: DailyBalances, month: YearMonth, today: LocalDate): CalendarKpi {
    const last = month.lengthInDays();
    const currency = currencyOf(balances);
    const projectedEnd = formatMoney(toResponse(balances.projected[last] ?? Money.zero(currency)));
    const consolidated = (day: number): string => formatMoney(toResponse(balances.consolidated[day] ?? Money.zero(currency)));
    const order = month.compare(today.period);
    if (order < 0) {
        return { label: 'Saldo consolidado no fim do mês', value: consolidated(last), sub: `Previsto no fim do mês: ${projectedEnd}` };
    }
    if (order > 0) {
        return { label: 'Saldo previsto no fim do mês', value: projectedEnd, sub: 'Se tudo for pago no vencimento' };
    }
    return { label: 'Saldo consolidado hoje', value: consolidated(today.day), sub: `Previsto no fim do mês: ${projectedEnd}` };
}

/**
 * @param balances Saldos do mês.
 * @return A moeda das séries, que sempre têm ao menos o saldo inicial.
 */
function currencyOf(balances: DailyBalances): Currency {
    const opening = balances.consolidated[0];
    if (opening === undefined) {
        throw new Error('saldo do mês sem o saldo inicial');
    }
    return opening.currency;
}

/**
 * Soma pelo `Money`, e não com `+` de float, para que o total do dia não mostre um centavo a mais
 * ou a menos que a soma das linhas.
 *
 * @param amounts Valores com sinal.
 * @param currency Moeda do perfil, para a soma vazia.
 * @return A soma.
 */
function sum(amounts: readonly MoneyResponse[], currency: Currency): MoneyResponse {
    return toResponse(amounts.reduce((total, amount) => total.add(toMoney(amount)), Money.zero(currency)));
}

/**
 * @param money Valor como veio do núcleo.
 * @return O mesmo valor no `Money` do domínio, para somar sem erro de float.
 */
function toMoney(money: MoneyResponse): Money {
    return Money.of(money.amount, Currency.of(money.currency));
}

/**
 * @param money Valor somado.
 * @return O valor arredondado na precisão da moeda, no formato que os formatadores leem.
 */
function toResponse(money: Money): MoneyResponse {
    return { amount: money.rounded().amount, currency: money.currency.code };
}
