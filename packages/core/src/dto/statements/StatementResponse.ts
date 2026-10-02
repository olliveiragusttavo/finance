import type { CreditCard } from '../../domain/creditCard/CreditCard.ts';
import type { Invoice } from '../../domain/invoice/Invoice.ts';
import type { StatementView } from '../../services/statement/StatementView.ts';
import { toInvoiceResponse, type InvoiceResponse } from '../invoices/InvoiceResponse.ts';
import { toBalancePairResponse, type BalancePairResponse } from '../shared/BalancePairResponse.ts';
import { toMoneyResponse } from '../shared/MoneyResponse.ts';
import { toTransactionResponse, type TransactionResponse } from '../transactions/TransactionResponse.ts';

/** Extrato consolidado de uma conta no mês, com tudo que afeta o saldo dela. */
export interface StatementResponse {
    readonly accountId: string;
    readonly accountName: string;
    readonly period: string;
    readonly exists: boolean;
    readonly opening: BalancePairResponse;
    readonly closing: BalancePairResponse;
    readonly movement: BalancePairResponse;
    readonly transactions: readonly TransactionResponse[];
    readonly incomingTransfers: readonly TransactionResponse[];
    readonly paidInvoices: readonly InvoiceResponse[];
    readonly openInvoicesDue: readonly (InvoiceResponse & { readonly creditCardName: string })[];
}

/**
 * Deriva o movimento do mês aqui (fechamento − abertura) para a UI não refazer a conta com
 * valores já arredondados, o que poderia divergir em um centavo do saldo exibido.
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
        transactions: view.transactions.map(toTransactionResponse),
        incomingTransfers: view.incomingTransfers.map(toTransactionResponse),
        paidInvoices: view.paidInvoices.map(toInvoiceResponse),
        openInvoicesDue: view.openInvoicesDue.map(({ invoice, creditCard }: { invoice: Invoice; creditCard: CreditCard }) => ({
            ...toInvoiceResponse(invoice),
            creditCardName: creditCard.name,
        })),
    };
}
