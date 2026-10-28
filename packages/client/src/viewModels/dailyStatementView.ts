import { Currency, LocalDate, Money, YearMonth } from '@finance/core';
import type { MoneyResponse } from '@finance/core';
import { formatDate, formatMonthAbbreviation, formatMonthShort } from '../format/dates.ts';
import { formatMoney, formatMoneyCompact, formatMoneyDigits } from '../format/money.ts';
import type { TransactionTableRow } from './transactionTable.ts';

/*
 * Extrato em vários meses (mockup `DesktopExtrato`): os mesmos lançamentos de Transações, com os
 * mesmos filtros, mas num período de vários meses, numa tabela com o dia do mês nas linhas e os
 * meses nas colunas. Não cabe descrever cada lançamento numa célula, então ela mostra o resultado
 * do dia. Fica no `client`, e não na tela, porque o celular vai mostrar o mesmo relatório com as
 * mesmas regras e palavras (desktop-shell-design §4.2).
 */

/** Quantos meses o período pode ter: doze colunas já enchem a tela, e cada mês é uma consulta a mais. */
export const MAX_STATEMENT_MONTHS = 24;

/** O que entra na soma do dia: tudo, só as receitas ou só as despesas (filtro "Tipo"). */
export type DailyStatementKind = 'all' | 'income' | 'expense';

/**
 * Situação de um dia, a do lançamento que mais pede atenção:
 * - `paid`: tudo pago (a fatura paga também);
 * - `upcoming`: algum em aberto, nenhum vencido;
 * - `overdue`: algum em aberto com vencimento antes de hoje.
 */
export type DailyStatementState = 'paid' | 'upcoming' | 'overdue';

/** Rótulos da situação do dia no detalhe, os do mockup. */
const STATE_LABELS: Readonly<Record<DailyStatementState, string>> = {
    paid: 'Tudo pago',
    upcoming: 'Tem lançamento a vencer',
    overdue: 'Tem lançamento atrasado',
};

/** Trechos do nome acessível da célula para cada situação; o pago não acrescenta nada. */
const STATE_ACCESSIBLE: Readonly<Record<DailyStatementState, string>> = {
    paid: '',
    upcoming: ', com lançamento a vencer',
    overdue: ', com atrasado',
};

/** Nomes dos dias da semana pelo `dayOfWeek` ISO (1 = segunda … 7 = domingo). */
const WEEKDAYS = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo'] as const;

/** Um mês do período, com as linhas de Transações dele já filtradas. */
export interface DailyStatementMonthSource {
    /** Competência `YYYY-MM`. */
    readonly period: string;
    /**
     * Linhas de `buildTransactionTable` do mês, com os filtros da tela: sem filtro, a compra no
     * cartão entra pela linha da fatura, no dia em que ela pesa na conta, como em Transações.
     */
    readonly rows: readonly TransactionTableRow[];
}

/** O que a tela já tem em cache para montar o extrato. */
export interface DailyStatementSource {
    /** Hoje `YYYY-MM-DD`, no relógio do aparelho: decide o atrasado e marca a célula de hoje. */
    readonly today: string;
    /** Moeda do perfil, para as somas de um mês sem lançamento. */
    readonly currency: string;
    readonly kind: DailyStatementKind;
    /** Os meses do período, do mais antigo ao mais recente. */
    readonly months: readonly DailyStatementMonthSource[];
}

/** O detalhe do dia escolhido, na faixa acima da tabela. */
export interface DailyStatementDetail {
    /** `Quarta-feira`. */
    readonly weekday: string;
    /** `15/10/2026`. */
    readonly date: string;
    readonly count: string;
    /** `+R$ 200,00`. */
    readonly income: string;
    /** `−R$ 2.547,96`. */
    readonly expenses: string;
    /** `−R$ 2.347,96`. */
    readonly result: string;
    readonly tone: 'in' | 'out';
    /** `Tudo pago`, `Tem lançamento a vencer` ou `Tem lançamento atrasado`. */
    readonly stateText: string;
}

/**
 * Uma célula da tabela:
 * - `missing`: o dia não existe no mês (31 de fevereiro), hachurado;
 * - `empty`: dia sem lançamento que entre na soma;
 * - `value`: o resultado do dia.
 */
export type DailyStatementCell =
    | { readonly kind: 'missing' }
    | { readonly kind: 'empty' }
    | {
          readonly kind: 'value';
          readonly period: string;
          readonly day: number;
          /** `+500`, `−1.830`, `−66,50`: compacto, mas sempre com o sinal. */
          readonly text: string;
          readonly tone: 'in' | 'out' | 'zero';
          readonly state: DailyStatementState;
          /**
           * Peso do valor entre 0 e 1, para colorir pela intensidade: a raiz do valor sobre o maior
           * do período, para que um dia de R$ 50 não suma ao lado de um de R$ 6.000.
           */
          readonly intensity: number;
          readonly today: boolean;
          /** `15 de out/26: resultado −R$ 2.547,96, 24 lançamentos, com atrasado`. */
          readonly accessibleName: string;
          readonly detail: DailyStatementDetail;
      };

/** Uma linha da tabela: um dia do mês em todos os meses do período. */
export interface DailyStatementRow {
    readonly day: number;
    /** `01`…`31`. */
    readonly label: string;
    /** Uma célula por mês, na ordem de `months`. */
    readonly cells: readonly DailyStatementCell[];
}

/** Uma coluna da tabela, com os totais do rodapé. */
export interface DailyStatementMonth {
    readonly period: string;
    /** `out/26`. */
    readonly label: string;
    /** O mês corrente, destacado no cabeçalho. */
    readonly current: boolean;
    /** `9.500,00`; `—` quando o filtro "Tipo" deixa as receitas de fora. */
    readonly income: string;
    /** `−2.787,32`; `—` quando o filtro "Tipo" deixa as despesas de fora. */
    readonly expenses: string;
    /** `+6.712,68`. */
    readonly result: string;
    readonly resultTone: 'in' | 'out';
    readonly count: string;
}

/** O período pronto para a tabela. */
export interface DailyStatementView {
    readonly months: readonly DailyStatementMonth[];
    /** Sempre 31 linhas: os meses curtos hachuram o que falta. */
    readonly rows: readonly DailyStatementRow[];
    /** `nov/25 – out/26 (12 meses)`. */
    readonly periodLabel: string;
    /** Dia aberto no detalhe antes de o usuário escolher; `null` num período sem lançamento. */
    readonly defaultSelection: { readonly period: string; readonly day: number } | null;
}

/** Lançamentos de cada dia de um mês que entram na soma. */
type DayBuckets = ReadonlyMap<number, readonly TransactionTableRow[]>;

/**
 * Monta o extrato do período.
 *
 * Regra de negócio (Extrato): cada lançamento fica no dia do **vencimento**, como em Transações (a
 * compra no cartão, na linha da fatura, no dia em que ela pesa na conta), e a célula mostra o
 * **resultado do dia**: receitas menos despesas. As transferências dentro do perfil contam no
 * número de lançamentos mas não mudam o resultado, porque só movem dinheiro entre contas do
 * próprio perfil — a mesma regra do resultado de Transações; ao filtrar uma conta, a tabela de
 * Transações já as traz com o sinal do efeito nela. Com o filtro "Tipo" em Receitas ou Despesas,
 * só os lançamentos daquele sentido entram, e o dia sem nenhum fica vazio.
 *
 * Regra de negócio (Extrato, situação): o dia herda a situação mais urgente dos seus lançamentos —
 * atrasado quando algum em aberto venceu antes de hoje, a vencer quando algum está em aberto —,
 * para que o atraso apareça na tabela sem abrir o dia.
 *
 * @param source Hoje, a moeda, o filtro "Tipo" e as linhas de cada mês do período.
 * @return As colunas com os totais, as 31 linhas e o dia aberto por padrão.
 */
export function buildDailyStatementView(source: DailyStatementSource): DailyStatementView {
    const currency = Currency.of(source.currency);
    const today = LocalDate.parse(source.today);
    const buckets = source.months.map((month) => bucketsOf(month, source.kind));
    const maxAbs = Math.max(0, ...buckets.flatMap((byDay) => [...byDay.values()].map((rows) => Math.abs(resultOf(rows, currency).amount))));
    const rows: DailyStatementRow[] = [];
    for (let day = 1; day <= 31; day++) {
        rows.push({
            day,
            label: String(day).padStart(2, '0'),
            cells: source.months.map((month, index) => cellOf(month.period, day, buckets[index]?.get(day), { today, currency, maxAbs })),
        });
    }
    const months = source.months.map((month, index) => monthOf(month.period, buckets[index] ?? new Map(), source.kind, today, currency));
    return { months, rows, periodLabel: formatStatementRange(source.months.map((month) => month.period)), defaultSelection: defaultSelectionOf(rows, today) };
}

/**
 * Agrupa as linhas do mês pelo dia do vencimento, deixando de fora as que o filtro "Tipo" exclui.
 * A data fora do mês (a fatura paga sem dia gravado já vem no último dia, mas qualquer outra
 * exceção) vai para o último dia, para que o valor nunca suma do total do mês.
 *
 * @param month Mês com as linhas de Transações.
 * @param kind Filtro "Tipo".
 * @return Os lançamentos que entram na soma, por dia.
 */
function bucketsOf(month: DailyStatementMonthSource, kind: DailyStatementKind): DayBuckets {
    const period = YearMonth.parse(month.period);
    const byDay = new Map<number, readonly TransactionTableRow[]>();
    for (const row of month.rows) {
        if (!includedBy(row, kind)) {
            continue;
        }
        const date = LocalDate.parse(row.dueDate);
        const day = date.period.equals(period) ? date.day : period.lengthInDays();
        byDay.set(day, [...(byDay.get(day) ?? []), row]);
    }
    return byDay;
}

/**
 * @param row Linha de Transações.
 * @param kind Filtro "Tipo".
 * @return Se a linha entra no extrato: tudo em "Tudo"; só as entradas ou só as saídas nos outros,
 * porque a transferência e o valor zero não são receita nem despesa.
 */
function includedBy(row: TransactionTableRow, kind: DailyStatementKind): boolean {
    if (kind === 'income') {
        return row.direction === 'in';
    }
    if (kind === 'expense') {
        return row.direction === 'out';
    }
    return true;
}

/** O que toda célula precisa saber do período. */
interface CellContext {
    readonly today: LocalDate;
    readonly currency: Currency;
    /** Maior resultado em módulo do período, a referência da intensidade. */
    readonly maxAbs: number;
}

/**
 * @param period Competência da coluna.
 * @param day Dia da linha.
 * @param rows Lançamentos do dia; ausente no dia sem nenhum.
 * @param context Hoje, a moeda e o maior valor do período.
 * @return A célula: hachurada no dia que não existe, vazia sem lançamento, ou com o resultado.
 */
function cellOf(period: string, day: number, rows: readonly TransactionTableRow[] | undefined, context: CellContext): DailyStatementCell {
    if (day > YearMonth.parse(period).lengthInDays()) {
        return { kind: 'missing' };
    }
    if (rows === undefined || rows.length === 0) {
        return { kind: 'empty' };
    }
    const date = dateOf(period, day);
    const result = resultOf(rows, context.currency);
    const state = stateOf(rows, context.today);
    const count = countText(rows.length);
    return {
        kind: 'value',
        period,
        day,
        text: formatMoneyCompact(result),
        tone: result.amount > 0 ? 'in' : result.amount < 0 ? 'out' : 'zero',
        state,
        intensity: context.maxAbs === 0 ? 0 : Math.min(1, Math.sqrt(Math.abs(result.amount) / context.maxAbs)),
        today: date.equals(context.today),
        accessibleName: `${String(day)} de ${columnLabel(period)}: resultado ${formatMoney(result, 'always')}, ${count}${STATE_ACCESSIBLE[state]}`,
        detail: {
            weekday: WEEKDAYS[date.dayOfWeek() - 1] ?? '',
            date: formatDate(date.toString()),
            count: String(rows.length),
            income: formatMoney(sumOf(rows, 'in', context.currency), 'always'),
            expenses: formatMoney(sumOf(rows, 'out', context.currency), 'always'),
            result: formatMoney(result, 'always'),
            tone: result.amount < 0 ? 'out' : 'in',
            stateText: STATE_LABELS[state],
        },
    };
}

/**
 * Regra de negócio (Transações): o resultado é o efeito das linhas com sinal; só a transferência
 * neutra (`⇄` em módulo) fica de fora, exatamente como no resumo de Transações.
 *
 * @param rows Lançamentos do dia ou do mês.
 * @param currency Moeda do perfil, para a soma vazia.
 * @return O resultado arredondado.
 */
function resultOf(rows: readonly TransactionTableRow[], currency: Currency): MoneyResponse {
    return sum(rows.filter((row) => row.direction !== 'transfer').map((row) => row.amount), currency);
}

/**
 * @param rows Lançamentos.
 * @param direction Sentido somado.
 * @param currency Moeda do perfil, para a soma vazia.
 * @return A soma das entradas (positiva) ou das saídas (negativa).
 */
function sumOf(rows: readonly TransactionTableRow[], direction: 'in' | 'out', currency: Currency): MoneyResponse {
    return sum(rows.filter((row) => row.direction === direction).map((row) => row.amount), currency);
}

/**
 * Regra de negócio (Extrato, situação): pago é o lançamento pago e a fatura paga (a compra no
 * cartão segue a fatura, database-design §4.7, e a tabela de Transações já aplica isso); o resto
 * está em aberto, atrasado quando venceu antes de hoje. A compra numa fatura em aberto, que aparece
 * uma a uma quando há filtro, nunca é atrasada: a data dela é a da compra, e quem vence é a fatura.
 *
 * @param rows Lançamentos do dia.
 * @param today Hoje.
 * @return A situação mais urgente do dia.
 */
function stateOf(rows: readonly TransactionTableRow[], today: LocalDate): DailyStatementState {
    const open = rows.filter((row) => row.situation !== 'paid' && row.situation !== 'invoicePaid');
    if (open.length === 0) {
        return 'paid';
    }
    const late = open.some((row) => (row.kind === 'invoice' || row.situation === 'pending') && LocalDate.parse(row.dueDate).isBefore(today));
    return late ? 'overdue' : 'upcoming';
}

/**
 * Os totais do rodapé de uma coluna. A coluna do sentido que o filtro "Tipo" deixa de fora mostra
 * `—`, e não zero, para não parecer que o mês não teve receita ou despesa.
 *
 * @param period Competência da coluna.
 * @param buckets Lançamentos do mês por dia.
 * @param kind Filtro "Tipo".
 * @param today Hoje, para destacar o mês corrente.
 * @param currency Moeda do perfil.
 * @return A coluna com os totais formatados.
 */
function monthOf(period: string, buckets: DayBuckets, kind: DailyStatementKind, today: LocalDate, currency: Currency): DailyStatementMonth {
    const rows = [...buckets.values()].flat();
    const result = resultOf(rows, currency);
    return {
        period,
        label: columnLabel(period),
        current: YearMonth.parse(period).equals(today.period),
        income: kind === 'expense' ? '—' : formatMoneyDigits(sumOf(rows, 'in', currency)),
        expenses: kind === 'income' ? '—' : formatMoneyDigits(sumOf(rows, 'out', currency)),
        result: formatMoneyCompact(result),
        resultTone: result.amount < 0 ? 'out' : 'in',
        count: String(rows.length),
    };
}

/**
 * @param period Competência `YYYY-MM`.
 * @return `out/26`: o ano em dois dígitos, porque doze colunas com `out/2026` não cabem.
 */
function columnLabel(period: string): string {
    return `${formatMonthAbbreviation(period)}/${period.slice(2, 4)}`;
}

/**
 * Rótulo do período, o da barra superior e o da tabela; fica exportado para que os dois nunca
 * descrevam o mesmo período de jeitos diferentes.
 *
 * @param periods Meses do período, do mais antigo ao mais recente.
 * @return `nov/25 – out/26 (12 meses)`; um mês só sai sem o intervalo; vazio sem nenhum mês.
 */
export function formatStatementRange(periods: readonly string[]): string {
    const first = periods[0];
    const last = periods[periods.length - 1];
    if (first === undefined || last === undefined) {
        return '';
    }
    if (periods.length === 1) {
        return `${columnLabel(first)} (1 mês)`;
    }
    return `${columnLabel(first)} – ${columnLabel(last)} (${String(periods.length)} meses)`;
}

/**
 * Dia aberto no detalhe quando o usuário ainda não escolheu: o último dia com lançamento até hoje
 * (hoje incluído) — o mais recente que já aconteceu —; senão o primeiro do período, num período
 * todo futuro.
 *
 * @param rows Linhas da tabela.
 * @param today Hoje.
 * @return O mês e o dia; `null` sem nenhum lançamento no período.
 */
function defaultSelectionOf(rows: readonly DailyStatementRow[], today: LocalDate): DailyStatementView['defaultSelection'] {
    const values = rows
        .flatMap((row) => row.cells)
        .flatMap((cell) => (cell.kind === 'value' ? [{ cell, date: dateOf(cell.period, cell.day) }] : []))
        .sort((a, b) => a.date.compare(b.date));
    const past = values.filter(({ date }) => !today.isBefore(date));
    const chosen = (past[past.length - 1] ?? values[0])?.cell;
    return chosen === undefined ? null : { period: chosen.period, day: chosen.day };
}

/**
 * @param period Competência `YYYY-MM`.
 * @param day Dia que existe no mês.
 * @return A data do dia.
 */
function dateOf(period: string, day: number): LocalDate {
    const month = YearMonth.parse(period);
    return LocalDate.of(month.year, month.month, day);
}

/**
 * @param count Quantos lançamentos.
 * @return `1 lançamento`, `24 lançamentos`.
 */
function countText(count: number): string {
    return `${String(count)} ${count === 1 ? 'lançamento' : 'lançamentos'}`;
}

/**
 * Soma pelo `Money`, e não com `+` de float, para que o resultado do dia não mostre um centavo a
 * mais ou a menos que a soma dos lançamentos.
 *
 * @param amounts Valores com sinal.
 * @param currency Moeda do perfil, para a soma vazia.
 * @return A soma arredondada na precisão da moeda.
 */
function sum(amounts: readonly MoneyResponse[], currency: Currency): MoneyResponse {
    const total = amounts.reduce((acc, amount) => acc.add(Money.of(amount.amount, Currency.of(amount.currency))), Money.zero(currency)).rounded();
    return { amount: total.amount, currency: total.currency.code };
}

/** Um atalho de período do filtro. */
export interface StatementPreset {
    readonly id: 'last3' | 'last6' | 'last12' | 'next6';
    readonly label: string;
    /** Primeiro mês `YYYY-MM`. */
    readonly from: string;
    /** Último mês `YYYY-MM`. */
    readonly to: string;
}

/**
 * Os atalhos do mockup, contados a partir do mês corrente: "Últimos N meses" terminam nele, e
 * "Próximos 6 meses" começam no seguinte, para ver o que já está lançado à frente.
 *
 * @param current Mês corrente `YYYY-MM`.
 * @return Os atalhos na ordem do filtro.
 */
export function statementPresets(current: string): readonly StatementPreset[] {
    const month = YearMonth.parse(current);
    /**
     * @param id Identificador do atalho.
     * @param count Quantos meses, terminando no corrente.
     * @return O atalho "Últimos N meses".
     */
    const last = (id: StatementPreset['id'], count: number): StatementPreset => ({ id, label: `Últimos ${String(count)} meses`, from: month.plusMonths(1 - count).toString(), to: current });
    return [last('last3', 3), last('last6', 6), last('last12', 12), { id: 'next6', label: 'Próximos 6 meses', from: month.next().toString(), to: month.plusMonths(6).toString() }];
}

/**
 * @param current Mês corrente `YYYY-MM`.
 * @return O período padrão, os últimos 12 meses: um ano inteiro mostra a sazonalidade dos gastos.
 */
export function defaultStatementRange(current: string): { readonly from: string; readonly to: string } {
    const preset = statementPresets(current).find((candidate) => candidate.id === 'last12');
    return preset === undefined ? { from: current, to: current } : { from: preset.from, to: preset.to };
}

/**
 * @param from Primeiro mês `YYYY-MM`.
 * @param to Último mês `YYYY-MM`.
 * @return Se o período é aceito: em ordem e com no máximo `MAX_STATEMENT_MONTHS` meses.
 */
export function isValidStatementRange(from: string, to: string): boolean {
    const span = YearMonth.parse(from).monthsUntil(YearMonth.parse(to));
    return span >= 0 && span < MAX_STATEMENT_MONTHS;
}

/**
 * @param from Primeiro mês `YYYY-MM`.
 * @param to Último mês `YYYY-MM`, já validado com `isValidStatementRange`.
 * @return Cada mês do período, do mais antigo ao mais recente — uma consulta e uma coluna por mês.
 */
export function statementPeriods(from: string, to: string): readonly string[] {
    const start = YearMonth.parse(from);
    const span = start.monthsUntil(YearMonth.parse(to));
    return Array.from({ length: Math.max(0, span + 1) }, (_, index) => start.plusMonths(index).toString());
}

/** Uma opção dos campos "De" e "Até". */
export interface StatementMonthOption {
    readonly value: string;
    /** `out/2026`. */
    readonly label: string;
}

/**
 * Meses oferecidos nos campos "De" e "Até": três anos para trás e um à frente do mês corrente, o
 * bastante para comparar anos e ver o que está lançado à frente, sem uma lista sem fim.
 *
 * @param current Mês corrente `YYYY-MM`.
 * @return Os meses do mais recente ao mais antigo, como se procura numa lista de meses.
 */
export function statementMonthOptions(current: string): readonly StatementMonthOption[] {
    const month = YearMonth.parse(current);
    return Array.from({ length: 48 }, (_, index) => {
        const value = month.plusMonths(12 - index).toString();
        return { value, label: formatMonthShort(value) };
    });
}

/**
 * Ajusta o período quando um dos campos muda e o outro deixaria de fazer sentido: o "Até" antes
 * do "De", ou um período maior que o permitido. Quem mudou manda; o outro campo se move.
 *
 * @param from Primeiro mês pedido.
 * @param to Último mês pedido.
 * @param changed Campo que o usuário mudou.
 * @return O período aceito mais próximo do pedido.
 */
export function adjustStatementRange(from: string, to: string, changed: 'from' | 'to'): { readonly from: string; readonly to: string } {
    if (isValidStatementRange(from, to)) {
        return { from, to };
    }
    const start = YearMonth.parse(from);
    const end = YearMonth.parse(to);
    if (changed === 'from') {
        return { from, to: (end.isBefore(start) ? start : start.plusMonths(MAX_STATEMENT_MONTHS - 1)).toString() };
    }
    return { from: (end.isBefore(start) ? end : end.plusMonths(1 - MAX_STATEMENT_MONTHS)).toString(), to };
}
