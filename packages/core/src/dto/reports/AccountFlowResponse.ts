import type { AccountFlowMonth, AccountFlowReport, AccountFlowScope, FlowMonthTiming } from '../../domain/report/AccountFlowReport.ts';
import { toBalancePairResponse, type BalancePairResponse } from '../shared/BalancePairResponse.ts';

/**
 * Um mês do fluxo, cada linha no consolidado e no previsto. Entradas positivas; saídas e faturas
 * com o sinal do efeito no saldo, para que inicial + entradas + saídas + faturas = final.
 */
export interface AccountFlowMonthResponse {
    readonly period: string;
    readonly timing: FlowMonthTiming;
    readonly opening: BalancePairResponse;
    readonly inflows: BalancePairResponse;
    readonly outflows: BalancePairResponse;
    readonly invoices: BalancePairResponse;
    readonly closing: BalancePairResponse;
}

/** O que foi somado: uma conta, ou as contas do total (desktop-mvp-plan §3.4, F4). */
export type AccountFlowScopeResponse =
    | { readonly kind: 'account'; readonly accountId: string; readonly accountName: string }
    | { readonly kind: 'total'; readonly accountIds: readonly string[] };

/** Fluxo por conta (rota `reports.accountFlow`). */
export interface AccountFlowResponse {
    readonly period: string;
    readonly scope: AccountFlowScopeResponse;
    /** Os 3 meses anteriores, o de referência e o seguinte, em ordem cronológica. */
    readonly months: readonly AccountFlowMonthResponse[];
}

/**
 * @param scope Escopo do domínio, com as contas inteiras.
 * @return Só os ids e o nome que a tela usa: a lista de contas ela já tem.
 */
function toScopeResponse(scope: AccountFlowScope): AccountFlowScopeResponse {
    return scope.kind === 'account'
        ? { kind: 'account', accountId: scope.account.id, accountName: scope.account.name }
        : { kind: 'total', accountIds: scope.accounts.map((account) => account.id) };
}

/**
 * Cada linha é arredondada uma vez aqui, a partir das somas sem arredondar, pelo mesmo motivo
 * do extrato: a tela não refaz conta com valores já arredondados.
 *
 * @param month Mês do domínio.
 * @return O mês serializável.
 */
function toMonthResponse(month: AccountFlowMonth): AccountFlowMonthResponse {
    return {
        period: month.period.toString(),
        timing: month.timing,
        opening: toBalancePairResponse(month.opening),
        inflows: toBalancePairResponse(month.inflows),
        outflows: toBalancePairResponse(month.outflows),
        invoices: toBalancePairResponse(month.invoices),
        closing: toBalancePairResponse(month.closing),
    };
}

/**
 * @param report Relatório montado pelo Service.
 * @return O relatório serializável.
 */
export function toAccountFlowResponse(report: AccountFlowReport): AccountFlowResponse {
    return { period: report.reference.toString(), scope: toScopeResponse(report.scope), months: report.months.map(toMonthResponse) };
}
