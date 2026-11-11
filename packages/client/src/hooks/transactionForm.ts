import type { AccountInPeriodResponse, CreditCardInPeriodResponse, TransactionNameSuggestionResponse, TransactionResponse } from '@finance/core';
import { formatDayMonth, formatMonthShort } from '../format/dates.ts';
import { periodOfDate } from '../forms/invoiceForms.ts';
import type { TransactionFormValues } from '../forms/transactionForm.ts';
import { shiftPeriod } from '../shell/referenceMonth.ts';
import { invoiceChoices, invoiceReopenWarning, type SourceOption, type SourceOptions } from '../viewModels/transactionEditor.ts';
import { useInvoicesByCard, useInvoiceSuggestion } from './routeHooks.ts';

/*
 * Peças do formulário de lançamento que o desktop e o celular usam iguais: a escolha da fatura
 * da compra no cartão e a origem copiada de um nome sugerido.
 */

/**
 * @param suggestion Sugestão do campo "Nome".
 * @param options Origens oferecidas no lançamento novo.
 * @return A conta ou o cartão da sugestão, ou `null` quando ele já não é escolha (desativado ou excluído).
 */
export function suggestedSourceOption(suggestion: TransactionNameSuggestionResponse, options: SourceOptions): SourceOption | null {
    const { source } = suggestion;
    const found = source.kind === 'account' ? options.accounts.find((option) => option.id === source.accountId) : options.creditCards.find((option) => option.id === source.creditCardId);
    return found ?? null;
}

/** A fatura da compra no cartão: a sugerida, as opções da troca e os avisos. */
export interface InvoiceChoiceState {
    /** Competência sugerida pela data da compra; `null` fora do cartão ou sem data válida. */
    readonly suggestedPeriod: string | null;
    readonly choices: ReturnType<typeof invoiceChoices>;
    /** "Sugerida pela data da compra: nov/2026, vence 10/11." */
    readonly hint: string | null;
    readonly warning: string | null;
}

/**
 * Consulta a fatura sugerida e as faturas do cartão em volta dela, e monta a escolha da fatura.
 *
 * @param params.card Cartão escolhido; `null` quando a origem é uma conta.
 * @param params.values Valores do formulário (data da compra e fatura escolhida).
 * @param params.transaction Lançamento editado, cuja fatura atual continua oferecida.
 * @param params.accounts Contas do perfil, para o nome da conta pagadora no aviso.
 * @return O estado da escolha.
 */
export function useInvoiceChoice(params: {
    readonly card: CreditCardInPeriodResponse | null;
    readonly values: TransactionFormValues;
    readonly transaction: TransactionResponse | null;
    readonly accounts: readonly AccountInPeriodResponse[];
}): InvoiceChoiceState {
    const { card, values, transaction } = params;
    const validDate = periodOfDate(values.dueDate) !== null;
    const suggestion = useInvoiceSuggestion(card !== null && validDate ? { creditCardId: card.id, purchaseDate: values.dueDate } : null);
    const suggestedPeriod = card === null ? null : (suggestion.data?.period ?? null);
    const cycles = useInvoicesByCard(card !== null && suggestedPeriod !== null ? { creditCardId: card.id, from: shiftPeriod(suggestedPeriod, -1) } : null);
    if (card === null || suggestion.data === undefined || suggestedPeriod === null) {
        return { suggestedPeriod: null, choices: [], hint: null, warning: null };
    }
    const container = transaction?.container;
    const currentPeriod = container?.kind === 'invoice' && container.creditCardId === card.id ? container.period : null;
    const invoices = (cycles.data ?? []).flatMap((cycle) => (cycle.invoice === null ? [] : [cycle.invoice]));
    const chosen = values.invoicePeriod === '' ? suggestedPeriod : values.invoicePeriod;
    return {
        suggestedPeriod,
        choices: invoiceChoices({ suggestedPeriod, currentPeriod, invoices }),
        hint: `Sugerida pela data da compra: ${formatMonthShort(suggestedPeriod)}, vence ${formatDayMonth(suggestion.data.dueDate)}.`,
        warning: invoiceReopenWarning({
            invoice: invoices.find((invoice) => invoice.period === chosen) ?? null,
            current: chosen === currentPeriod,
            payingAccountName: params.accounts.find((account) => account.id === card.accountId)?.name ?? '—',
        }),
    };
}
