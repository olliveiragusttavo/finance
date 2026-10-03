import type { CreditCard } from '../creditCard/CreditCard.ts';
import type { CreditCardId, InvoiceId } from '../shared/ids.ts';
import type { LocalDate } from '../shared/LocalDate.ts';
import type { Money } from '../shared/Money.ts';
import type { YearMonth } from '../shared/YearMonth.ts';
import { sumMoney } from './Comparison.ts';
import { expenseOutflow, type InvoiceExpenseTotals } from './ReportTotals.ts';
import { shareOf } from './Variation.ts';

/** Quantos meses antes do de referência a grade mostra — a base da média (C5). */
const PREVIOUS_MONTHS = 3;

/**
 * Situação de uma fatura na grade (C4). "Em aberto" e "Futura" carregam o vencimento
 * porque é ele que decide o mês em que a fatura pesa enquanto não é paga.
 */
export type CardImpactSituation =
    | { readonly kind: 'paid'; readonly paidIn: YearMonth }
    | { readonly kind: 'open'; readonly dueDate: LocalDate }
    | { readonly kind: 'future'; readonly dueDate: LocalDate };

/** Uma fatura numa célula da grade. */
export interface CardImpactInvoice {
    readonly invoiceId: InvoiceId;
    readonly invoicePeriod: YearMonth;
    readonly total: Money;
    readonly situation: CardImpactSituation;
}

/**
 * Um cartão num mês. Guarda uma lista, e não uma fatura, porque pela regra-mestra duas
 * faturas do mesmo cartão podem pesar no mesmo mês — a de setembro paga com atraso em
 * outubro e a de outubro que vence em outubro.
 */
export interface CardImpactCell {
    readonly creditCardId: CreditCardId;
    readonly invoices: readonly CardImpactInvoice[];
    readonly total: Money;
}

/** Uma linha da grade: um mês de pagamento. */
export interface CardImpactMonth {
    readonly period: YearMonth;
    readonly cells: readonly CardImpactCell[];
    readonly total: Money;
    readonly income: Money;
    /** Total ÷ receitas; `null` quando o mês não tem receita (C3). */
    readonly weight: number | null;
}

/** O impacto do cartão em torno de um mês de referência. */
export interface CardImpactReport {
    readonly reference: YearMonth;
    /** Cartões vivos do perfil, ativos e desativados, na ordem das colunas. */
    readonly creditCards: readonly CreditCard[];
    /** Os 3 meses anteriores, o de referência e o seguinte, em ordem cronológica. */
    readonly months: readonly CardImpactMonth[];
    readonly referenceMonth: CardImpactMonth;
    /** Cartões com ao menos uma fatura no mês de referência. */
    readonly creditCardsInReference: number;
    /** Faturas do mês de referência ainda não pagas (em aberto ou futuras). */
    readonly unpaidInReference: number;
    /** Média dos totais dos 3 meses anteriores, mês sem fatura contando zero. */
    readonly previousAverage: Money;
    /** Soma dos totais ÷ soma das receitas dos 3 meses anteriores; `null` sem receita. */
    readonly previousAverageWeight: number | null;
}

/** O que o montador recebe do Service. */
export interface CardImpactSources {
    readonly reference: YearMonth;
    readonly creditCards: readonly CreditCard[];
    /** Faturas cujo mês de pagamento cai na janela. */
    readonly invoices: readonly InvoiceExpenseTotals[];
    /** Receitas de cada mês da janela pelo mesmo critério de caixa, por `YYYY-MM`. */
    readonly incomeByPeriod: ReadonlyMap<string, Money>;
    /** "Hoje", que separa a fatura ainda aberta para compras (futura) da já fechada. */
    readonly today: LocalDate;
    readonly zero: Money;
}

/**
 * Janela da grade.
 * Regra de negócio (Relatórios, C5): o mês de referência, os **3 anteriores** (base da
 * média) e o **seguinte** (o que já está comprometido).
 *
 * @param reference Mês de referência.
 * @return Os cinco meses, do mais antigo ao mais recente.
 */
export function cardImpactWindow(reference: YearMonth): readonly YearMonth[] {
    let first = reference;
    for (let i = 0; i < PREVIOUS_MONTHS; i++) {
        first = first.previous();
    }
    const months: YearMonth[] = [];
    // Os anteriores, o de referência e o seguinte.
    for (let period = first, i = 0; i < PREVIOUS_MONTHS + 2; period = period.next(), i++) {
        months.push(period);
    }
    return months;
}

/**
 * Monta a grade mês × cartão.
 * Regra de negócio (Relatórios, C1): as faturas "de outubro" são as **pagas em outubro**
 * mais as **em aberto que vencem em outubro** — o mês de pagamento já vem calculado pelo SQL
 * (`periodSql.ts`). C2: o total de cada fatura são as **despesas líquidas de estornos, sem
 * descontar pagamentos parciais**, porque o pagamento parcial já saiu da conta e continua
 * sendo peso do cartão. C3: o peso é o total ÷ as receitas do mesmo mês.
 *
 * @param sources Cartões, faturas da janela, receitas e "hoje".
 * @return O relatório com a grade e os indicadores.
 */
export function buildCardImpactReport(sources: CardImpactSources): CardImpactReport {
    const { reference, creditCards, zero } = sources;
    const months = cardImpactWindow(reference).map((period): CardImpactMonth => {
        const cells = creditCards.map((creditCard): CardImpactCell => {
            const invoices = sources.invoices
                .filter((invoice) => invoice.creditCardId === creditCard.id && invoice.paymentPeriod.equals(period))
                .sort((a, b) => a.invoicePeriod.compare(b.invoicePeriod))
                .map((invoice) => toImpactInvoice(invoice, creditCard, sources.today));
            return { creditCardId: creditCard.id, invoices, total: sumMoney(invoices.map((invoice) => invoice.total), zero) };
        });
        const total = sumMoney(cells.map((cell) => cell.total), zero);
        const income = sources.incomeByPeriod.get(period.toString()) ?? zero;
        return { period, cells, total, income, weight: shareOf(total, income) };
    });

    const referenceMonth = months.find((month) => month.period.equals(reference));
    if (referenceMonth === undefined) {
        throw new Error('a janela do impacto do cartão sempre contém o mês de referência');
    }
    const previous = months.filter((month) => month.period.isBefore(reference));
    const previousTotal = sumMoney(previous.map((month) => month.total), zero);
    return {
        reference,
        creditCards,
        months,
        referenceMonth,
        creditCardsInReference: referenceMonth.cells.filter((cell) => cell.invoices.length > 0).length,
        unpaidInReference: referenceMonth.cells.flatMap((cell) => cell.invoices).filter((invoice) => invoice.situation.kind !== 'paid').length,
        previousAverage: previousTotal.times(1 / PREVIOUS_MONTHS),
        previousAverageWeight: shareOf(previousTotal, sumMoney(previous.map((month) => month.income), zero)),
    };
}

/**
 * Regra de negócio (Relatórios, C4): paga mostra o extrato onde foi paga; sem pagamento,
 * a fatura é **futura** enquanto ainda recebe compras (hoje antes do fechamento) e **em
 * aberto** depois de fechada — no dia do fechamento ela já fechou, porque a compra desse
 * dia vai para a fatura seguinte (database-design §4.5).
 *
 * @param invoice Somas da fatura lidas do banco.
 * @param creditCard Cartão dono, cujo ciclo dá o fechamento e o vencimento.
 * @param today "Hoje" do usuário.
 * @return A fatura com o total pela regra C2 e a situação.
 */
function toImpactInvoice(invoice: InvoiceExpenseTotals, creditCard: CreditCard, today: LocalDate): CardImpactInvoice {
    const total = expenseOutflow(invoice.expenseValue, invoice.expenseCharges);
    if (invoice.paid) {
        return { invoiceId: invoice.invoiceId, invoicePeriod: invoice.invoicePeriod, total, situation: { kind: 'paid', paidIn: invoice.paymentPeriod } };
    }
    const dueDate = creditCard.billingCycle.dueDateOf(invoice.invoicePeriod);
    const closed = !today.isBefore(creditCard.billingCycle.closingDateOf(invoice.invoicePeriod));
    return { invoiceId: invoice.invoiceId, invoicePeriod: invoice.invoicePeriod, total, situation: closed ? { kind: 'open', dueDate } : { kind: 'future', dueDate } };
}
