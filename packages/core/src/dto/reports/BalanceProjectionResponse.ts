import type { BalanceProjection, BalanceProjectionBasis } from '../../domain/report/BalanceProjection.ts';
import { toMoneyResponse, type MoneyResponse } from '../shared/MoneyResponse.ts';

/** Um mês fechado que entrou na estimativa. */
export interface BalanceProjectionHistoryResponse {
    readonly period: string;
    /** Quanto o saldo consolidado mudou no mês: entradas menos saídas. */
    readonly result: MoneyResponse;
    /** A parte dos avulsos, a que a estimativa usa. */
    readonly nonRecurring: MoneyResponse;
    /** A parte das séries (fixas e parcelas). */
    readonly recurring: MoneyResponse;
}

/** Um mês da projeção. */
export interface BalanceProjectionPointResponse {
    readonly period: string;
    /** O que já está lançado para o mês. */
    readonly scheduled: MoneyResponse;
    /** A estimativa dos avulsos ainda não lançados. */
    readonly estimated: MoneyResponse;
    /** Saldo projetado no fim do mês. */
    readonly balance: MoneyResponse;
    /** Cenário pessimista e otimista. */
    readonly low: MoneyResponse;
    readonly high: MoneyResponse;
}

/** Projeção de saldo (rota `reports.balanceProjection`). */
export interface BalanceProjectionResponse {
    /** A janela pedida da estimativa, em meses. */
    readonly basis: BalanceProjectionBasis;
    /** Dia de hoje, `YYYY-MM-DD`, de onde a projeção parte. */
    readonly today: string;
    /** Meses que formaram a estimativa, do mais antigo ao mais recente; menos que `basis` num perfil novo. */
    readonly history: readonly BalanceProjectionHistoryResponse[];
    /** Média mensal dos avulsos. */
    readonly average: MoneyResponse;
    /** Desvio-padrão mensal dos avulsos, a largura da faixa num mês. */
    readonly deviation: MoneyResponse;
    /** Saldo consolidado de hoje. */
    readonly start: MoneyResponse;
    /** O fim do mês corrente e os 12 meses seguintes. */
    readonly points: readonly BalanceProjectionPointResponse[];
}

/**
 * Arredonda só na saída (`toMoneyResponse`): a estimativa e os saldos são acumulados sem
 * arredondar, para que o erro não cresça a cada mês.
 *
 * @param projection Projeção do domínio.
 * @return A projeção serializável.
 */
export function toBalanceProjectionResponse(projection: BalanceProjection): BalanceProjectionResponse {
    return {
        basis: projection.basis,
        today: projection.today.toString(),
        history: projection.history.map((month) => ({
            period: month.period.toString(),
            result: toMoneyResponse(month.result),
            nonRecurring: toMoneyResponse(month.nonRecurring),
            recurring: toMoneyResponse(month.recurring),
        })),
        average: toMoneyResponse(projection.average),
        deviation: toMoneyResponse(projection.deviation),
        start: toMoneyResponse(projection.start),
        points: projection.points.map((point) => ({
            period: point.period.toString(),
            scheduled: toMoneyResponse(point.scheduled),
            estimated: toMoneyResponse(point.estimated),
            balance: toMoneyResponse(point.balance),
            low: toMoneyResponse(point.low),
            high: toMoneyResponse(point.high),
        })),
    };
}
