import type { CreditCard } from '../../domain/creditCard/CreditCard.ts';
import type { Invoice } from '../../domain/invoice/Invoice.ts';
import type { LocalDate } from '../../domain/shared/LocalDate.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';
import type { Transaction } from '../../domain/transaction/Transaction.ts';

/**
 * Fatura sugerida para uma compra; `invoice` é `null` quando o mês ainda não tem fatura.
 * Fica fora do arquivo do `InvoiceService` para que a camada DTO dependa só do contrato
 * de saída, e não da implementação do caso de uso. Traz as datas do ciclo porque o
 * formulário mostra quando a fatura vence ("nov/2026 · vence 10/11", mockup
 * `MobileLancamento`) antes de ela existir, e só o ciclo do cartão sabe calculá-las.
 */
export interface InvoiceSuggestion {
    readonly creditCard: CreditCard;
    readonly period: YearMonth;
    readonly closingDate: LocalDate;
    readonly dueDate: LocalDate;
    readonly invoice: Invoice | null;
}

/** Uma fatura com o que a tela de fatura mostra. */
export interface InvoiceView {
    readonly invoice: Invoice;
    readonly creditCard: CreditCard;
    readonly closingDate: LocalDate;
    readonly dueDate: LocalDate;
    readonly transactions: readonly Transaction[];
}
