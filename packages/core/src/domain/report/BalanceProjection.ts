import { BalancePair } from '../balance/BalancePair.ts';
import type { Currency } from '../shared/Currency.ts';
import type { LocalDate } from '../shared/LocalDate.ts';
import { Money } from '../shared/Money.ts';
import type { YearMonth } from '../shared/YearMonth.ts';
import type { AccountClosingHistory } from './ReportTotals.ts';

/**
 * Quantos meses fechados formam a estimativa dos avulsos (reports-design §9, B1). Uma lista
 * fechada, e não um número livre: são as janelas que a tela oferece, e o padrão é o ano inteiro.
 */
export const BALANCE_PROJECTION_BASES = [12, 6, 3, 1] as const;

/** Uma das janelas da média. */
export type BalanceProjectionBasis = (typeof BALANCE_PROJECTION_BASES)[number];

/**
 * Quantos meses a projeção cobre depois do mês corrente (reports-design §9, B4) — o mesmo horizonte
 * em que as séries fixas já estão gravadas (database-design §4.12).
 */
export const BALANCE_PROJECTION_MONTHS = 12;

/** O resultado de um mês fechado do histórico, separado no que era programado e no que era avulso. */
export interface BalanceProjectionHistoryMonth {
    readonly period: YearMonth;
    /** Quanto o saldo consolidado mudou no mês: entradas menos saídas. */
    readonly result: Money;
    /** A parte dos lançamentos avulsos, a que a estimativa usa. */
    readonly nonRecurring: Money;
    /** A parte das séries (fixas e parcelas): `result − nonRecurring`. */
    readonly recurring: Money;
}

/** Um mês da projeção, com as duas partes do resultado e a faixa. */
export interface BalanceProjectionPoint {
    readonly period: YearMonth;
    /** O que já está lançado para o mês: a variação do saldo previsto. */
    readonly scheduled: Money;
    /** A estimativa dos avulsos que ainda não foram lançados. */
    readonly estimated: Money;
    /** Saldo projetado no fim do mês. */
    readonly balance: Money;
    /** Cenário pessimista e otimista: o saldo menos e mais a incerteza acumulada até o mês. */
    readonly low: Money;
    readonly high: Money;
}

/** A projeção de saldo pronta. */
export interface BalanceProjection {
    /** A janela pedida. */
    readonly basis: BalanceProjectionBasis;
    /** O dia de hoje, de onde a projeção parte. */
    readonly today: LocalDate;
    /** Os meses que formaram a estimativa, do mais antigo ao mais recente; menos que `basis` num perfil novo. */
    readonly history: readonly BalanceProjectionHistoryMonth[];
    /** Média mensal dos avulsos, sem arredondar: arredondar antes de acumular somaria o erro. */
    readonly average: Money;
    /** Desvio-padrão mensal dos avulsos: a medida da incerteza da estimativa. */
    readonly deviation: Money;
    /** Saldo consolidado de hoje das contas que entram no total. */
    readonly start: Money;
    /** O fim do mês corrente e os meses seguintes, em ordem. */
    readonly points: readonly BalanceProjectionPoint[];
}

/** O que a projeção recebe do banco. */
export interface BalanceProjectionInput {
    readonly basis: BalanceProjectionBasis;
    readonly today: LocalDate;
    /** Mês do primeiro extrato das contas do saldo; `null` quando nenhuma teve movimento. */
    readonly firstPeriod: YearMonth | null;
    /**
     * Fechamentos das contas do saldo, consolidado e previsto, do mês anterior à janela da média
     * até o último mês projetado.
     */
    readonly histories: readonly AccountClosingHistory[];
    /** Efeito no saldo dos avulsos pagos, por mês de caixa; mês sem avulso pode faltar. */
    readonly nonRecurring: readonly { readonly period: YearMonth; readonly amount: Money }[];
    readonly start: Money;
    readonly currency: Currency;
}

/**
 * Regra de negócio (Relatórios, reports-design §9, B1): a estimativa usa só meses **fechados**,
 * do anterior ao corrente para trás, e nunca antes do primeiro extrato. O mês corrente ainda está
 * pela metade e puxaria a média para baixo; os meses antes do primeiro movimento entrariam como
 * zeros e achatariam a média e o desvio. Num perfil novo a janela fica mais curta que `basis`, e
 * a tela avisa.
 *
 * @param basis Janela pedida.
 * @param current Mês de hoje.
 * @param firstPeriod Mês do primeiro extrato das contas do saldo.
 * @return Os meses fechados que entram na estimativa, do mais antigo ao mais recente; vazio quando
 * o perfil ainda não tem mês fechado com movimento.
 */
export function projectionBasisMonths(basis: BalanceProjectionBasis, current: YearMonth, firstPeriod: YearMonth | null): readonly YearMonth[] {
    const months: YearMonth[] = [];
    let month = current.previous();
    while (months.length < basis && firstPeriod !== null && !month.isBefore(firstPeriod)) {
        months.unshift(month);
        month = month.previous();
    }
    return months;
}

/**
 * Projeta o saldo pelo método direto do fluxo de caixa: o que já está lançado mais a estimativa do
 * que ainda não está, com uma faixa de incerteza.
 * Regra de negócio (Relatórios, §9):
 * - **Comprometido (B2):** cada mês futuro soma a variação do saldo **previsto** das contas do
 *   total — tudo o que já está lançado: parcelas, séries fixas (gravadas 12 meses à frente),
 *   contas em aberto, faturas no vencimento, transferências entre perfis e para contas fora do
 *   total. No mês corrente entra o que falta: o previsto do fim do mês menos o consolidado do fim
 *   do mês, inclusive o que venceu e não foi pago.
 * - **Estimado (B3):** só os **avulsos** que ainda não foram lançados, pela média dos avulsos pagos
 *   nos meses fechados. As séries ficam fora da média porque já estão no comprometido: contá-las
 *   nos dois seria contar duas vezes. No mês corrente vale a fração dos dias que faltam.
 * - **Faixa (B5):** o desvio-padrão dos avulsos mede quanto um mês costuma fugir da média; somando
 *   meses independentes, a incerteza cresce com a raiz do número de meses — por isso a faixa abre
 *   com o horizonte, como num intervalo de previsão.
 *
 * @param input Janela, hoje, histórico, avulsos e saldo de partida.
 * @return A projeção do fim do mês corrente e dos 12 meses seguintes.
 */
export function buildBalanceProjection(input: BalanceProjectionInput): BalanceProjection {
    const zero = Money.zero(input.currency);
    const current = input.today.period;
    /**
     * Soma o fechamento de todas as contas do total num mês, porque a projeção é do saldo
     * consolidado do perfil, e não de uma conta.
     *
     * @param period Mês consultado.
     * @return Consolidado e previsto somados no fim do mês.
     */
    const closing =(period: YearMonth): BalancePair => input.histories.reduce((total, history) => total.add(closingAt(history, period)), BalancePair.zero(input.currency));
    /**
     * Regra de negócio (Relatórios, §9, B3): só os avulsos formam a estimativa; o mês sem linha do
     * banco não teve avulso e vale zero, em vez de sumir da média.
     *
     * @param period Mês fechado do histórico.
     * @return O efeito dos avulsos pagos no mês; zero quando não houve.
     */
    const nonRecurringOf =(period: YearMonth): Money => input.nonRecurring.filter((entry) => entry.period.equals(period)).reduce((total, entry) => total.add(entry.amount), zero);
    const history = projectionBasisMonths(input.basis, current, input.firstPeriod).map((period) => {
        const result = closing(period).consolidated.subtract(closing(period.previous()).consolidated);
        const nonRecurring = nonRecurringOf(period);
        return { period, result, nonRecurring, recurring: result.subtract(nonRecurring) };
    });
    const average = history.length === 0 ? zero : history.reduce((total, month) => total.add(month.nonRecurring), zero).times(1 / history.length);
    const deviation = standardDeviation(history.map((month) => month.nonRecurring.amount), average.amount, input.currency);
    // A fração do mês corrente que ainda não aconteceu: hoje já está no saldo de partida.
    const remaining = (current.lengthInDays() - input.today.day) / current.lengthInDays();
    const currentClosing = closing(current);
    const points: BalanceProjectionPoint[] = [];
    let balance = input.start.add(currentClosing.projected.subtract(currentClosing.consolidated)).add(average.times(remaining));
    points.push(pointOf(current, currentClosing.projected.subtract(currentClosing.consolidated), average.times(remaining), balance, deviation.times(Math.sqrt(remaining))));
    let previous = currentClosing.projected;
    let period = current;
    for (let step = 1; step <= BALANCE_PROJECTION_MONTHS; step++) {
        period = period.next();
        const projected = closing(period).projected;
        const scheduled = projected.subtract(previous);
        balance = balance.add(scheduled).add(average);
        points.push(pointOf(period, scheduled, average, balance, deviation.times(Math.sqrt(step + remaining))));
        previous = projected;
    }
    return { basis: input.basis, today: input.today, history, average, deviation, start: input.start, points };
}

/**
 * @param period Mês.
 * @param scheduled O que já está lançado para o mês.
 * @param estimated A estimativa dos avulsos.
 * @param balance Saldo projetado no fim do mês.
 * @param spread Incerteza acumulada até o mês.
 * @return O ponto, com a faixa em volta do saldo.
 */
function pointOf(period: YearMonth, scheduled: Money, estimated: Money, balance: Money, spread: Money): BalanceProjectionPoint {
    return { period, scheduled, estimated, balance, low: balance.subtract(spread), high: balance.add(spread) };
}

/**
 * Desvio-padrão amostral (divide por `n − 1`): a janela é uma amostra dos meses possíveis, e com
 * poucos meses o populacional subestimaria a incerteza. Com menos de dois meses não há como medir
 * a variação, e a faixa fica fechada.
 *
 * @param values Avulsos de cada mês, em unidades da moeda.
 * @param mean Média deles.
 * @param currency Moeda do perfil.
 * @return O desvio-padrão.
 */
function standardDeviation(values: readonly number[], mean: number, currency: Currency): Money {
    if (values.length < 2) {
        return Money.zero(currency);
    }
    const squares = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
    return Money.of(Math.sqrt(squares / (values.length - 1)), currency);
}

/**
 * Regra de negócio (Extrato): mês sem extrato não teve movimento e repete o fechamento do extrato
 * vivo anterior; antes do primeiro extrato vale o saldo inicial da conta — por isso a conta aberta
 * no meio da janela não conta o saldo inicial como entrada.
 *
 * @param history Fechamentos de uma conta, em ordem cronológica.
 * @param period Mês consultado.
 * @return O fechamento do último extrato até o mês, ou o saldo inicial da conta.
 */
function closingAt(history: AccountClosingHistory, period: YearMonth): BalancePair {
    let closing = history.opening;
    for (const statement of history.statements) {
        if (period.isBefore(statement.period)) {
            break;
        }
        closing = statement.closing;
    }
    return closing;
}
