import type { Account } from '../../domain/account/Account.ts';
import type { BalancePair } from '../../domain/balance/BalancePair.ts';
import type { LocalDate } from '../../domain/shared/LocalDate.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';
import type { Transaction } from '../../domain/transaction/Transaction.ts';
import type { InvoiceWithCard } from '../../repositories/InvoiceRepository.ts';

/** Fatura em aberto que vence no mês, com a data em que pesa no previsto. */
export interface OpenInvoiceDue extends InvoiceWithCard {
    readonly dueDate: LocalDate;
}

/**
 * O extrato consolidado de uma conta num mês: os quatro saldos e tudo que os forma.
 * Regra de negócio (Extrato): mostra as transações do mês, as transferências que chegam e
 * as faturas pagas no mês; as faturas em aberto que vencem no mês entram só no previsto
 * (database-design §4.6; brief §3, Extrato).
 * Fica fora do arquivo do `StatementConsolidationService` para que a camada DTO dependa só
 * do contrato de saída, e não da implementação do caso de uso.
 */
export interface StatementView {
    readonly account: Account;
    readonly period: YearMonth;
    /** `false` quando o mês não tem linha — nenhum movimento; os saldos repetem o anterior. */
    readonly exists: boolean;
    readonly opening: BalancePair;
    readonly closing: BalancePair;
    /** Soma dos movimentos que aumentam o saldo (`statementFlows`). */
    readonly inflows: BalancePair;
    /** Soma, negativa, dos movimentos que diminuem o saldo. */
    readonly outflows: BalancePair;
    readonly transactions: readonly Transaction[];
    readonly incomingTransfers: readonly Transaction[];
    readonly paidInvoices: readonly InvoiceWithCard[];
    readonly openInvoicesDue: readonly OpenInvoiceDue[];
}

/**
 * Fatura que pesa no mês, vista do perfil: a conta que a quita e a data de caixa. É a linha da
 * fatura na tela de Transações, que agrupa as compras do cartão (desktop-mvp-plan Fase 11.1).
 */
export interface ProfileInvoiceView extends InvoiceWithCard {
    /** Conta que quita o cartão, em cujo extrato a fatura pesa. */
    readonly account: Account;
    /** Dia do pagamento na paga; do vencimento na em aberto; `null` na paga sem dia gravado. */
    readonly cashDate: LocalDate | null;
}
