import type { Invoice } from '../../domain/invoice/Invoice.ts';
import { toMoneyResponse, type MoneyResponse } from '../shared/MoneyResponse.ts';

/** Resumo serializável da fatura; base do detalhe, da sugestão e das faturas do extrato. */
export interface InvoiceResponse {
    readonly id: string;
    readonly creditCardId: string;
    readonly period: string;
    readonly status: 'open' | 'paid';
    readonly paidInPeriod: string | null;
    /** Dia do pagamento; `null` em aberto e nas faturas pagas antes de o dia ser gravado. */
    readonly paymentDate: string | null;
    /** Total com o sinal do efeito na conta: negativo quando há valor a pagar. */
    readonly balance: MoneyResponse;
    /** Valor a pagar em módulo, como a tela mostra (database-design §4.7); zero quando há crédito. */
    readonly amountDue: MoneyResponse;
}

/**
 * Entrega o saldo com sinal e também o valor a pagar em módulo porque a tela mostra o
 * módulo (database-design §4.7), mas o extrato soma com sinal — derivar aqui evita que a UI
 * decida sozinha o que fazer com uma fatura credora.
 *
 * @param invoice Fatura do domínio; fonte do saldo, do status e do mês e dia do pagamento.
 * @return A fatura serializável; `amountDue` é zero quando a fatura tem crédito.
 */
export function toInvoiceResponse(invoice: Invoice): InvoiceResponse {
    return {
        id: invoice.id,
        creditCardId: invoice.creditCardId,
        period: invoice.period.toString(),
        status: invoice.isPaid() ? 'paid' : 'open',
        paidInPeriod: invoice.payment?.period.toString() ?? null,
        paymentDate: invoice.payment?.date?.toString() ?? null,
        balance: toMoneyResponse(invoice.balance),
        amountDue: toMoneyResponse(invoice.balance.isNegative() ? invoice.balance.negate() : invoice.balance.times(0)),
    };
}
