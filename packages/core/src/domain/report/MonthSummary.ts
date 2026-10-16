import { amountDue } from '../invoice/Invoice.ts';
import type { CreditCardId } from '../shared/ids.ts';
import type { LocalDate } from '../shared/LocalDate.ts';
import type { Money } from '../shared/Money.ts';
import type { YearMonth } from '../shared/YearMonth.ts';
import { sumMoney } from './Comparison.ts';
import { expenseOutflow, incomeInflow, type CashFlowTotals, type InvoiceExpenseTotals } from './ReportTotals.ts';
import { Variation } from './Variation.ts';

/** Faturas em aberto que vencem no mês — o indicador "Faturas em aberto" da Visão geral. */
export interface OpenInvoicesDue {
    /** Valor a pagar, já líquido dos pagamentos parciais. */
    readonly amountDue: Money;
    readonly invoices: number;
    readonly creditCards: number;
    /** Vencimento mais próximo; `null` quando nenhuma fatura em aberto vence no mês. */
    readonly nextDueDate: LocalDate | null;
}

/** Os indicadores do mês na Visão geral. */
export interface MonthSummary {
    readonly reference: YearMonth;
    readonly income: Money;
    readonly incomeCount: number;
    readonly expenses: Money;
    readonly expenseCount: number;
    readonly previousExpenses: Money;
    readonly expenseVariation: Variation;
    readonly openInvoices: OpenInvoicesDue;
}

/** Uma fatura em aberto que vence no mês, com o vencimento já calculado pelo ciclo do cartão. */
export interface OpenInvoiceDue {
    readonly invoice: InvoiceExpenseTotals;
    readonly dueDate: LocalDate;
}

/** O que o montador recebe do Service. */
export interface MonthSummarySources {
    readonly reference: YearMonth;
    /** Receitas e despesas do mês de referência e do anterior, pelo mês de pagamento. */
    readonly cashFlow: readonly CashFlowTotals[];
    /** Faturas em aberto cujo vencimento cai no mês de referência. */
    readonly openInvoices: readonly OpenInvoiceDue[];
    readonly zero: Money;
}

/**
 * Monta os indicadores do mês.
 * Regra de negócio (Relatórios — reports-design §2): receitas e despesas pelo mês do
 * pagamento, pela mesma fonte do relatório por categoria, para que o total de despesas da
 * Visão geral e o do relatório nunca discordem. A variação das despesas é contra o mês
 * anterior, com a regra de base zero de `Variation`. "Faturas em aberto" mostra o valor
 * **a pagar** (líquido dos pagamentos parciais), porque é o que ainda vai sair da conta —
 * diferente do total C2 do impacto do cartão, que mede o peso do cartão no mês.
 *
 * @param sources Somas de caixa e faturas em aberto do mês.
 * @return Os indicadores.
 */
export function buildMonthSummary(sources: MonthSummarySources): MonthSummary {
    const { reference, zero } = sources;
    const pick = (period: YearMonth, type: 'income' | 'expense'): readonly CashFlowTotals[] =>
        sources.cashFlow.filter((row) => row.type === type && row.period.equals(period));
    const incomeRows = pick(reference, 'income');
    const expenseRows = pick(reference, 'expense');
    const expenses = sumMoney(expenseRows.map((row) => expenseOutflow(row.value, row.charges)), zero);
    const previousExpenses = sumMoney(pick(reference.previous(), 'expense').map((row) => expenseOutflow(row.value, row.charges)), zero);
    const dueDates = sources.openInvoices.map(({ dueDate }) => dueDate).sort((a, b) => a.compare(b));
    return {
        reference,
        income: sumMoney(incomeRows.map((row) => incomeInflow(row.value, row.charges)), zero),
        incomeCount: incomeRows.reduce((count, row) => count + row.count, 0),
        expenses,
        expenseCount: expenseRows.reduce((count, row) => count + row.count, 0),
        previousExpenses,
        expenseVariation: Variation.between(expenses, previousExpenses),
        openInvoices: {
            amountDue: sumMoney(sources.openInvoices.map(({ invoice }) => amountDue(invoice.balance)), zero),
            invoices: sources.openInvoices.length,
            creditCards: new Set<CreditCardId>(sources.openInvoices.map(({ invoice }) => invoice.creditCardId)).size,
            nextDueDate: dueDates[0] ?? null,
        },
    };
}
