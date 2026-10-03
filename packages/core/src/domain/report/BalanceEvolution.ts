import { BalancePair } from '../balance/BalancePair.ts';
import type { Currency } from '../shared/Currency.ts';
import type { YearMonth } from '../shared/YearMonth.ts';
import type { AccountClosingHistory } from './ReportTotals.ts';

/** O saldo do perfil no fim de um mês. */
export interface BalanceEvolutionPoint {
    readonly period: YearMonth;
    readonly closing: BalancePair;
}

/**
 * Meses da evolução, terminando no de referência.
 *
 * @param reference Último mês da série.
 * @param months Quantos meses a série cobre, contando o de referência.
 * @return Os meses, do mais antigo ao mais recente.
 */
export function evolutionWindow(reference: YearMonth, months: number): readonly YearMonth[] {
    const periods = [reference];
    while (periods.length < months) {
        const first = periods[0] ?? reference;
        periods.unshift(first.previous());
    }
    return periods;
}

/**
 * Soma os fechamentos das contas mês a mês, lendo os extratos já calculados — não recalcula,
 * porque o extrato é o cache que a rotina de recálculo mantém certo (database-design §4.6).
 * Regra de negócio (Extrato): mês sem extrato não teve movimento e repete o fechamento do
 * extrato vivo anterior; antes do primeiro extrato vale o saldo inicial da conta.
 * Quem escolhe as contas é o SQL: só as que entram no saldo do perfil.
 *
 * @param periods Meses da série, em ordem cronológica.
 * @param histories Fechamentos de cada conta, com o último extrato anterior à janela.
 * @param currency Moeda do perfil, para o zero do perfil sem contas.
 * @return Consolidado e previsto do perfil no fim de cada mês.
 */
export function buildBalanceEvolution(periods: readonly YearMonth[], histories: readonly AccountClosingHistory[], currency: Currency): readonly BalanceEvolutionPoint[] {
    return periods.map((period) => ({
        period,
        closing: histories.reduce((total, history) => total.add(closingAt(history, period)), BalancePair.zero(currency)),
    }));
}

/**
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
