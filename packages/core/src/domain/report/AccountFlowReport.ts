import type { Account } from '../account/Account.ts';
import { BalancePair } from '../balance/BalancePair.ts';
import type { Currency } from '../shared/Currency.ts';
import type { LocalDate } from '../shared/LocalDate.ts';
import type { YearMonth } from '../shared/YearMonth.ts';
import { statementFlows, type StatementMovement } from '../statement/StatementFlows.ts';
import { cardImpactWindow } from './CardImpactReport.ts';

/**
 * Onde o mês está em relação a hoje. Decide se o consolidado final ainda significa algo: no
 * futuro nada aconteceu, e o mês é só previsto (desktop-mvp-plan §3.4, F5).
 */
export type FlowMonthTiming = 'past' | 'current' | 'future';

/** O extrato de um mês reduzido ao que o relatório precisa: os saldos e os movimentos. */
export interface FlowStatement {
    readonly opening: BalancePair;
    readonly closing: BalancePair;
    readonly movements: readonly StatementMovement[];
}

/**
 * As linhas de um mês do fluxo. Entradas são positivas; saídas e faturas, com o sinal do efeito
 * no saldo — inicial + entradas + saídas + faturas = final, no consolidado e no previsto, sem
 * inverter nada.
 */
export interface AccountFlowLine {
    readonly opening: BalancePair;
    readonly inflows: BalancePair;
    readonly outflows: BalancePair;
    readonly invoices: BalancePair;
    readonly closing: BalancePair;
}

/** Um mês da janela, com as linhas e a situação em relação a hoje. */
export interface AccountFlowMonth extends AccountFlowLine {
    readonly period: YearMonth;
    readonly timing: FlowMonthTiming;
}

/**
 * O que o relatório soma: uma conta, ou as contas do total do perfil (F4). A união guarda as
 * contas para que a tela diga quantas entraram na soma sem perguntar de novo ao núcleo.
 */
export type AccountFlowScope =
    | { readonly kind: 'account'; readonly account: Account }
    | { readonly kind: 'total'; readonly accounts: readonly Account[] };

/** O fluxo por conta em torno de um mês de referência. */
export interface AccountFlowReport {
    readonly reference: YearMonth;
    readonly scope: AccountFlowScope;
    /** Os 3 meses anteriores, o de referência e o seguinte, em ordem cronológica. */
    readonly months: readonly AccountFlowMonth[];
}

/**
 * Janela do fluxo. É a mesma do impacto do cartão, e não uma cópia, para que os dois relatórios
 * de mês × mês mostrem sempre os mesmos meses lado a lado.
 * Regra de negócio (Relatórios, F1): o mês de referência, os **3 anteriores** e o **seguinte**
 * (desktop-mvp-plan §3.4).
 *
 * @param reference Mês de referência.
 * @return Os cinco meses, do mais antigo ao mais recente.
 */
export function accountFlowWindow(reference: YearMonth): readonly YearMonth[] {
    return cardImpactWindow(reference);
}

/**
 * Separa o extrato de um mês nas linhas do relatório.
 * Regra de negócio (Relatórios, F3): as faturas — pagas, em aberto que vencem no mês e
 * pagamentos parciais — têm linha própria, pelo efeito com sinal, porque é o peso do cartão
 * que o relatório quer mostrar à parte; os outros movimentos vão para entradas ou saídas pelo
 * sinal do efeito, a mesma regra do extrato (`statementFlows`). Os saldos vêm do extrato, que
 * é o cache do recálculo: o relatório nunca soma transações para chegar a um saldo (F2).
 *
 * @param statement Saldos e movimentos do extrato do mês.
 * @param currency Moeda do perfil; dá o zero do mês sem movimento.
 * @return As linhas do mês, sem arredondar.
 */
export function flowLineOf(statement: FlowStatement, currency: Currency): AccountFlowLine {
    let invoices = BalancePair.zero(currency);
    for (const movement of statement.movements) {
        if (movement.invoice) {
            invoices = invoices.plusEffect(movement.effect, movement.settled);
        }
    }
    const { inflows, outflows } = statementFlows(currency, statement.movements.filter((movement) => !movement.invoice));
    return { opening: statement.opening, inflows, outflows, invoices, closing: statement.closing };
}

/**
 * Soma as linhas de várias contas no mesmo mês.
 * Regra de negócio (Relatórios, F4): "Todas as contas do total" é a **soma simples dos
 * extratos** — a transferência entre duas contas do total aparece nas entradas de uma e nas
 * saídas da outra, como no extrato de cada uma; os saldos não mudam, porque ela soma zero.
 *
 * @param lines Linhas de cada conta no mês.
 * @param currency Moeda do perfil; dá o zero quando a lista é vazia.
 * @return As linhas somadas.
 */
export function sumFlowLines(lines: readonly AccountFlowLine[], currency: Currency): AccountFlowLine {
    const zero = BalancePair.zero(currency);
    return lines.reduce<AccountFlowLine>(
        (total, line) => ({
            opening: total.opening.add(line.opening),
            inflows: total.inflows.add(line.inflows),
            outflows: total.outflows.add(line.outflows),
            invoices: total.invoices.add(line.invoices),
            closing: total.closing.add(line.closing),
        }),
        { opening: zero, inflows: zero, outflows: zero, invoices: zero, closing: zero },
    );
}

/**
 * Situação do mês em relação a hoje. Vem do `Clock`, e não da tela, para que o critério de
 * "futuro" seja o mesmo das outras regras que dependem de hoje (fatura aberta × futura).
 *
 * @param period Mês da coluna.
 * @param today Hoje.
 * @return `current` no mês de hoje, `past` antes e `future` depois.
 */
export function flowMonthTiming(period: YearMonth, today: LocalDate): FlowMonthTiming {
    const order = period.compare(today.period);
    return order === 0 ? 'current' : order < 0 ? 'past' : 'future';
}
