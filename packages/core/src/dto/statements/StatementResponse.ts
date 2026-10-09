import type { InvoiceWithCard } from '../../repositories/InvoiceRepository.ts';
import type { ProfileInvoiceView, StatementView } from '../../services/statement/StatementView.ts';
import { toInvoiceResponse, type InvoiceResponse } from '../invoices/InvoiceResponse.ts';
import { toBalancePairResponse, type BalancePairResponse } from '../shared/BalancePairResponse.ts';
import { toMoneyResponse } from '../shared/MoneyResponse.ts';
import { toTransactionResponse, type TransactionResponse } from '../transactions/TransactionResponse.ts';

/** Fatura no extrato da conta que a quita, com o nome do cartão para a linha da tabela. */
export interface StatementInvoiceResponse extends InvoiceResponse {
    readonly creditCardName: string;
}

/** Fatura em aberto que vence no mês: pesa no previsto na data do vencimento. */
export interface StatementOpenInvoiceResponse extends StatementInvoiceResponse {
    readonly dueDate: string;
}

/** Fatura que pesa no mês, vista do perfil (rota `statements.profileInvoices`). */
export interface ProfileInvoiceResponse extends StatementInvoiceResponse {
    /** Conta que quita o cartão. */
    readonly accountId: string;
    readonly accountName: string;
    /** Dia do pagamento na paga; do vencimento na em aberto; `null` na paga sem dia gravado. */
    readonly cashDate: string | null;
}

/** Extrato consolidado de uma conta no mês, com tudo que afeta o saldo dela. */
export interface StatementResponse {
    readonly accountId: string;
    readonly accountName: string;
    readonly period: string;
    readonly exists: boolean;
    readonly opening: BalancePairResponse;
    readonly closing: BalancePairResponse;
    readonly movement: BalancePairResponse;
    /** Movimentos que aumentam o saldo; inicial + entradas + saídas = final. */
    readonly inflows: BalancePairResponse;
    /** Movimentos que diminuem o saldo, com sinal negativo. */
    readonly outflows: BalancePairResponse;
    readonly transactions: readonly TransactionResponse[];
    readonly incomingTransfers: readonly TransactionResponse[];
    readonly paidInvoices: readonly StatementInvoiceResponse[];
    readonly openInvoicesDue: readonly StatementOpenInvoiceResponse[];
}

/**
 * Deriva o movimento do mês aqui (fechamento − abertura) para a UI não refazer a conta com
 * valores já arredondados, o que poderia divergir em um centavo do saldo exibido.
 *
 * Entradas e saídas vêm do Service pelo mesmo motivo: somadas sem arredondar e
 * arredondadas uma vez aqui.
 *
 * @param view Extrato consolidado do Service; fonte dos saldos, lançamentos e faturas do mês.
 * @return O extrato serializável, com o movimento do mês já derivado.
 */
export function toStatementResponse(view: StatementView): StatementResponse {
    return {
        accountId: view.account.id,
        accountName: view.account.name,
        period: view.period.toString(),
        exists: view.exists,
        opening: toBalancePairResponse(view.opening),
        closing: toBalancePairResponse(view.closing),
        movement: {
            consolidated: toMoneyResponse(view.closing.consolidated.subtract(view.opening.consolidated)),
            projected: toMoneyResponse(view.closing.projected.subtract(view.opening.projected)),
        },
        inflows: toBalancePairResponse(view.inflows),
        outflows: toBalancePairResponse(view.outflows),
        transactions: view.transactions.map(toTransactionResponse),
        incomingTransfers: view.incomingTransfers.map(toTransactionResponse),
        paidInvoices: view.paidInvoices.map(toStatementInvoiceResponse),
        openInvoicesDue: view.openInvoicesDue.map((entry) => ({ ...toStatementInvoiceResponse(entry), dueDate: entry.dueDate.toString() })),
    };
}

/**
 * @param entry Fatura e o cartão dono, como o Repository as entrega.
 * @return A fatura serializável com o nome do cartão.
 */
function toStatementInvoiceResponse({ invoice, creditCard }: InvoiceWithCard): StatementInvoiceResponse {
    return { ...toInvoiceResponse(invoice), creditCardName: creditCard.name };
}

/**
 * Leva junto os nomes do cartão e da conta e a data de caixa já resolvida, para que a linha da
 * fatura em Transações não precise cruzar cadastros nem refazer a regra do dia (pagamento ou
 * vencimento) no `client`, onde ela poderia divergir do extrato.
 *
 * @param view Fatura do mês com a conta que a quita e a data de caixa.
 * @return A fatura serializável, com o nome do cartão e da conta para a linha da tabela; `cashDate`
 * é `null` na paga sem dia gravado.
 */
export function toProfileInvoiceResponse(view: ProfileInvoiceView): ProfileInvoiceResponse {
    return {
        ...toStatementInvoiceResponse(view),
        accountId: view.account.id,
        accountName: view.account.name,
        cashDate: view.cashDate?.toString() ?? null,
    };
}
