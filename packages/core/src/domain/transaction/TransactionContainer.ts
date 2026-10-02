import type { AccountId, BankStatementId, CreditCardId, InvoiceId } from '../shared/ids.ts';
import type { YearMonth } from '../shared/YearMonth.ts';

/** A transação está no extrato de uma conta. */
export interface StatementContainer {
    readonly kind: 'statement';
    readonly statementId: BankStatementId;
    readonly accountId: AccountId;
    readonly period: YearMonth;
}

/** A transação está na fatura de um cartão. */
export interface InvoiceContainer {
    readonly kind: 'invoice';
    readonly invoiceId: InvoiceId;
    readonly creditCardId: CreditCardId;
    readonly period: YearMonth;
}

/**
 * Contêiner mensal de uma transação.
 * Regra de negócio (Transações): toda transação pertence a **exatamente um** contêiner —
 * extrato **ou** fatura (database-design §4.13). O banco aceita as duas chaves nulas ou
 * as duas preenchidas, porque o arco exclusivo é regra da aplicação (§3.10); aqui a união
 * discriminada torna esses dois estados inválidos irrepresentáveis no núcleo.
 */
export type TransactionContainer = StatementContainer | InvoiceContainer;
