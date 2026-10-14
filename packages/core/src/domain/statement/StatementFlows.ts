import { BalancePair } from '../balance/BalancePair.ts';
import type { Invoice } from '../invoice/Invoice.ts';
import type { Currency } from '../shared/Currency.ts';
import type { Money } from '../shared/Money.ts';
import type { Transaction } from '../transaction/Transaction.ts';
import { destinationEffect } from '../transaction/TransactionType.ts';

/** Um movimento do extrato reduzido ao que decide a entrada ou a saída: o efeito e se já aconteceu. */
export interface StatementEffect {
    /** Efeito com sinal no saldo da conta, já com encargos e estorno aplicados. */
    readonly effect: Money;
    /** `true` quando o dinheiro já se moveu; entra também no consolidado. */
    readonly settled: boolean;
}

/** Um movimento do extrato, marcado quando é fatura — o fluxo por conta a mostra à parte. */
export interface StatementMovement extends StatementEffect {
    /** Fatura paga, em aberto que vence no mês ou pagamento parcial de fatura. */
    readonly invoice: boolean;
}

/** O que forma o movimento de um extrato no mês (database-design §4.6). */
export interface StatementParts {
    readonly transactions: readonly Transaction[];
    readonly incomingTransfers: readonly Transaction[];
    readonly paidInvoices: readonly Invoice[];
    readonly openInvoicesDue: readonly Invoice[];
}

/**
 * Reduz cada movimento do extrato ao efeito no saldo da conta e se já aconteceu. Fica num lugar
 * só porque o extrato (entradas e saídas) e o fluxo por conta (que separa as faturas) precisam
 * da mesma lista: com duas cópias, um movimento novo entraria num e faltaria no outro, e o
 * relatório deixaria de fechar com a tela Contas (desktop-mvp-plan §3.4, F2).
 * Regra de negócio (Extrato): as transações do extrato pelo efeito na origem; as transferências
 * que chegam pelo efeito no destino — o pagamento parcial de fatura é uma delas, com valor
 * negativo; as faturas pagas no consolidado e no previsto; as em aberto que vencem no mês só no
 * previsto (database-design §4.6 e §4.7).
 *
 * @param parts Transações, transferências que chegam e faturas do mês.
 * @return Um movimento por linha do extrato, com as faturas e os pagamentos parciais marcados.
 */
export function statementMovements(parts: StatementParts): readonly StatementMovement[] {
    return [
        ...parts.transactions.map((transaction) => ({ effect: transaction.originEffect(), settled: transaction.isPaid(), invoice: false })),
        ...parts.incomingTransfers.map((transaction) => ({
            effect: destinationEffect(transaction.value),
            settled: transaction.isPaid(),
            invoice: transaction.container.kind === 'invoice',
        })),
        ...parts.paidInvoices.map((invoice) => ({ effect: invoice.balance, settled: true, invoice: true })),
        ...parts.openInvoicesDue.map((invoice) => ({ effect: invoice.balance, settled: false, invoice: true })),
    ];
}

/**
 * Entradas e saídas do mês, cada uma no consolidado e no previsto. As saídas ficam com o
 * sinal negativo do efeito, para que inicial + entradas + saídas = final valha nos dois
 * saldos sem inverter nada.
 */
export interface StatementFlows {
    readonly inflows: BalancePair;
    readonly outflows: BalancePair;
}

/**
 * Separa o movimento do mês em entradas e saídas.
 * Regra de negócio (Extrato): cada movimento conta pelo **sinal do seu efeito no saldo da
 * conta**, e não pelo tipo — um estorno de despesa é entrada, uma receita com tarifa maior
 * que o valor é saída, e o pagamento parcial de fatura (transferência negativa que chega) é
 * saída. O consolidado soma só o que já aconteceu e o previsto soma tudo, a mesma regra do
 * saldo (database-design §4.6); por isso as duas somas sempre fecham com o movimento do mês
 * que o recálculo gravou no extrato.
 *
 * A separação precisa do efeito de cada linha, que o movimento agregado do recálculo
 * (`MonthlyMovement`) não guarda — lá as somas são por tipo e já misturam os sinais.
 *
 * @param currency Moeda do perfil; dá o zero de um mês sem movimento.
 * @param effects Efeito de cada movimento do extrato: transações, transferências que chegam e
 * faturas pagas ou em aberto que vencem no mês.
 * @return As entradas (positivas) e as saídas (negativas), sem arredondar.
 */
export function statementFlows(currency: Currency, effects: readonly StatementEffect[]): StatementFlows {
    let inflows = BalancePair.zero(currency);
    let outflows = BalancePair.zero(currency);
    for (const { effect, settled } of effects) {
        if (effect.isNegative()) {
            outflows = outflows.plusEffect(effect, settled);
        } else {
            inflows = inflows.plusEffect(effect, settled);
        }
    }
    return { inflows, outflows };
}
