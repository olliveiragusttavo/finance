import type { CreditCard } from '../../domain/creditCard/CreditCard.ts';
import type { Invoice } from '../../domain/invoice/Invoice.ts';
import type { LocalDate } from '../../domain/shared/LocalDate.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';

/**
 * Uma competência de fatura com as datas do ciclo. `invoice` é `null` quando o mês ainda não
 * tem fatura — nenhuma compra caiu nele —, mas as datas existem do mesmo jeito, porque saem
 * do ciclo do cartão e não da linha.
 */
export interface InvoiceCycle {
    readonly period: YearMonth;
    readonly closingDate: LocalDate;
    readonly dueDate: LocalDate;
    readonly invoice: Invoice | null;
}

/**
 * Monta a competência com as datas pelo ciclo do cartão. Compartilhada pela lista de
 * cartões e pelas próximas faturas para que as duas telas nunca discordem sobre quando uma
 * fatura fecha e vence.
 *
 * @param creditCard Cartão dono do ciclo.
 * @param period Competência da fatura.
 * @param invoice Fatura daquele mês, se existir.
 * @return A competência com as datas de fechamento e vencimento.
 */
export function invoiceCycle(creditCard: CreditCard, period: YearMonth, invoice: Invoice | null): InvoiceCycle {
    return {
        period,
        closingDate: creditCard.billingCycle.closingDateOf(period),
        dueDate: creditCard.billingCycle.dueDateOf(period),
        invoice,
    };
}
