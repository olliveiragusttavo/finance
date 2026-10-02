import type { BankStatement } from '../statement/BankStatement.ts';
import type { YearMonth } from '../shared/YearMonth.ts';
import type { BalancePair } from './BalancePair.ts';
import type { MonthlyMovement } from './MonthlyMovement.ts';

/**
 * Reconstrói a cadeia de fechamentos de uma conta a partir de um ponto.
 * Regra de negócio (Extrato): o saldo inicial de cada extrato é o final do extrato vivo
 * **anterior** da mesma conta — ou o `opening_balance` da conta, no primeiro — e o final é
 * o inicial mais o movimento do mês, no consolidado e no previsto (database-design §4.6).
 * Por isso editar março recalcula março e todos os meses seguintes (backend-design §3.3).
 *
 * É deliberadamente a implementação mais simples possível — sem atalho incremental —
 * porque é o oráculo dos testes de propriedade: uma rotina com bug aprovaria o mesmo bug
 * no cache (backend-design §5.6).
 *
 * @param start Saldo inicial do primeiro extrato da lista: o fechamento do extrato vivo
 * anterior a ela, ou o saldo inicial da conta quando não há anterior.
 * @param statements Extratos vivos a recalcular, em ordem cronológica crescente.
 * @param movement Movimento mensal da conta.
 * @return Os extratos com os quatro saldos recalculados, na mesma ordem.
 */
export function recomputeChain(start: BalancePair, statements: readonly BankStatement[], movement: MonthlyMovement): BankStatement[] {
    const result: BankStatement[] = [];
    let opening = start;
    for (const statement of statements) {
        const rebalanced = statement.rebalanced(opening, movement.of(statement.period));
        result.push(rebalanced);
        opening = rebalanced.closing;
    }
    return result;
}

/**
 * Meses com movimento a partir de um ponto que ainda não têm extrato. Um mês sem extrato
 * ficaria fora da cadeia, e a transferência que chega ou a fatura que vence nele sumiria
 * do saldo — uma ausência silenciosa, não um erro.
 *
 * @param from Primeiro mês considerado; meses anteriores não estão sendo recalculados.
 * @param existing Competências que já têm extrato vivo.
 * @param movement Movimento mensal da conta.
 * @return As competências sem extrato, em ordem cronológica.
 */
export function periodsMissingStatement(from: YearMonth, existing: readonly YearMonth[], movement: MonthlyMovement): YearMonth[] {
    const known = new Set(existing.map((period) => period.toString()));
    return movement.periods()
        .filter((period) => !period.isBefore(from) && !known.has(period.toString()))
        .sort((a, b) => a.compare(b));
}

/**
 * Saldo exibido da conta.
 * Regra de negócio (Contas): o saldo da conta é o fechamento do extrato do **mês
 * corrente** (database-design §4.4). Um mês corrente sem extrato herda o fechamento do
 * último extrato anterior — nada aconteceu desde então —, e uma conta sem extrato até hoje
 * mostra o próprio saldo inicial. Extratos futuros (parcelas, fixas) ficam de fora: são
 * previsão de meses que ainda não chegaram.
 *
 * @param openingBalance Saldo inicial da conta, nos dois lados.
 * @param latestUpToToday Último extrato vivo com competência até o mês corrente, ou `null`.
 * @return Consolidado e previsto exibidos para a conta.
 */
export function currentAccountBalances(openingBalance: BalancePair, latestUpToToday: BankStatement | null): BalancePair {
    return latestUpToToday === null ? openingBalance : latestUpToToday.closing;
}
