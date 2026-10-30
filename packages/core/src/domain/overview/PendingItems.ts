import type { CreditCard } from '../creditCard/CreditCard.ts';
import { amountDue, type Invoice } from '../invoice/Invoice.ts';
import type { Currency } from '../shared/Currency.ts';
import type { CreditCardId, InvoiceId, TransactionId } from '../shared/ids.ts';
import { LocalDate } from '../shared/LocalDate.ts';
import { Money } from '../shared/Money.ts';

/**
 * Sentido de um item em aberto para o perfil, que decide em qual total ele entra:
 * - `in`: dinheiro a receber (receita, transferência que chega de outro perfil);
 * - `out`: dinheiro a pagar (despesa, transferência para outro perfil, fatura);
 * - `transfer`: transferência ou investimento entre contas do próprio perfil, que não muda o
 *   patrimônio e por isso não entra em "a pagar" nem em "a receber".
 */
export type PendingDirection = 'in' | 'out' | 'transfer';

/** Lançamento de conta ainda não pago. */
export interface PendingTransaction {
    readonly kind: 'transaction';
    readonly id: TransactionId;
    readonly name: string;
    readonly dueDate: LocalDate;
    readonly direction: PendingDirection;
    /** Quanto o lançamento move, sempre positivo; o sentido está em `direction`. */
    readonly amount: Money;
    /** Conta do lançamento, ou "origem → destino" na transferência. */
    readonly where: string;
    /**
     * Se a Visão geral pode marcá-lo como pago. A transferência que chega de outro perfil é uma
     * linha do perfil de origem (database-design §4.13): quem a paga é a origem, e aqui ela só
     * aparece para que o perfil saiba o que está por receber.
     */
    readonly canMarkPaid: boolean;
}

/** Fatura de cartão em aberto, com valor a pagar. */
export interface PendingInvoice {
    readonly kind: 'invoice';
    readonly id: InvoiceId;
    readonly creditCardId: CreditCardId;
    /** Competência da fatura, que abre a fatura certa na tela Cartões. */
    readonly period: string;
    /** Nome do cartão. */
    readonly name: string;
    readonly dueDate: LocalDate;
    readonly direction: 'out';
    readonly amount: Money;
    /** Conta que paga o cartão. */
    readonly where: string;
}

/** Um item em aberto da Visão geral. */
export type PendingItem = PendingTransaction | PendingInvoice;

/** Quanto um grupo de itens soma em cada sentido. */
export interface PendingTotals {
    readonly toPay: Money;
    readonly toReceive: Money;
}

/** O selo de atrasados e o painel dos itens em aberto da Visão geral. */
export interface PendingSummary {
    readonly today: LocalDate;
    /** Último dia do mês de hoje: o painel mostra o que ainda vence até ele. */
    readonly until: LocalDate;
    /** Vencidos antes de hoje e não pagos, do mais antigo ao mais recente. */
    readonly overdue: readonly PendingItem[];
    readonly overdueTotals: PendingTotals;
    /** Em aberto que vencem de hoje até `until`, por data. */
    readonly upcoming: readonly PendingItem[];
    readonly upcomingTotals: PendingTotals;
}

/**
 * Último dia do mês de hoje, o fim da janela do painel. Num lugar só porque o Repository busca
 * os lançamentos até esse dia e o resumo corta as faturas no mesmo dia.
 *
 * @param today Dia de hoje.
 * @return O último dia do mês.
 */
export function pendingUntil(today: LocalDate): LocalDate {
    return LocalDate.of(today.period.year, today.period.month, today.period.lengthInDays());
}

/**
 * Faturas em aberto com valor a pagar e a data de vencimento de cada uma.
 * Regra de negócio (Fatura): a fatura vence pelo ciclo do cartão (database-design §4.7) e só pede
 * pagamento quando o saldo dela é negativo (`amountDue`) — a zerada ou com crédito não é dívida.
 *
 * @param entries Faturas em aberto do perfil, com o cartão e o nome da conta pagadora.
 * @return Uma `PendingInvoice` por fatura com valor a pagar.
 */
export function pendingInvoices(entries: readonly { readonly invoice: Invoice; readonly creditCard: CreditCard; readonly accountName: string }[]): readonly PendingInvoice[] {
    return entries.flatMap(({ invoice, creditCard, accountName }): PendingInvoice[] => {
        const amount = amountDue(invoice.balance);
        if (amount.isZero()) {
            return [];
        }
        return [{
            kind: 'invoice',
            id: invoice.id,
            creditCardId: creditCard.id,
            period: invoice.period.toString(),
            name: creditCard.name,
            dueDate: creditCard.billingCycle.dueDateOf(invoice.period),
            direction: 'out',
            amount,
            where: accountName,
        }];
    });
}

/**
 * Separa os itens em aberto em atrasados e a vencer até o fim do mês.
 * Regra de negócio (Visão geral): atrasado é o que venceu **antes de hoje** e não foi pago — o
 * que vence hoje ainda está em dia. A compra no cartão não aparece sozinha: ela é paga junto da
 * fatura, e é a fatura inteira que fica atrasada.
 *
 * @param today Dia de hoje.
 * @param items Lançamentos e faturas em aberto, em qualquer ordem e de qualquer data.
 * @param currency Moeda do perfil, para os totais vazios.
 * @return Os dois grupos, por data, com os totais de cada um.
 */
export function buildPendingSummary(today: LocalDate, items: readonly PendingItem[], currency: Currency): PendingSummary {
    const until = pendingUntil(today);
    const ordered = items
        .filter((item) => !until.isBefore(item.dueDate))
        .sort((a, b) => a.dueDate.compare(b.dueDate) || a.name.localeCompare(b.name, 'pt-BR'));
    const overdue = ordered.filter((item) => item.dueDate.isBefore(today));
    const upcoming = ordered.filter((item) => !item.dueDate.isBefore(today));
    return { today, until, overdue, overdueTotals: totals(overdue, currency), upcoming, upcomingTotals: totals(upcoming, currency) };
}

/**
 * @param items Itens de um grupo.
 * @param currency Moeda do perfil.
 * @return Quanto o grupo soma a pagar e a receber; a transferência interna fica fora dos dois.
 */
function totals(items: readonly PendingItem[], currency: Currency): PendingTotals {
    const zero = Money.zero(currency);
    return {
        toPay: items.filter((item) => item.direction === 'out').reduce((total, item) => total.add(item.amount), zero),
        toReceive: items.filter((item) => item.direction === 'in').reduce((total, item) => total.add(item.amount), zero),
    };
}

/** A próxima fatura em aberto de um cartão. */
export type NextInvoice = PendingInvoice;

/** As próximas faturas da Visão geral. */
export interface NextInvoicesSummary {
    /** Dia de hoje, de onde "próxima" é contada. */
    readonly today: LocalDate;
    /** No máximo uma por cartão, pela data de vencimento. */
    readonly invoices: readonly NextInvoice[];
}

/**
 * A próxima fatura de cada cartão: a primeira em aberto, com valor a pagar, que vence de hoje em
 * diante. A que já venceu fica de fora porque está no selo de atrasados.
 *
 * @param today Dia de hoje.
 * @param invoices Faturas em aberto com valor a pagar.
 * @return No máximo uma por cartão, pela data de vencimento.
 */
export function nextInvoices(today: LocalDate, invoices: readonly PendingInvoice[]): readonly NextInvoice[] {
    const byCard = new Map<CreditCardId, NextInvoice>();
    for (const invoice of invoices) {
        const current = byCard.get(invoice.creditCardId);
        if (!invoice.dueDate.isBefore(today) && (current === undefined || invoice.dueDate.isBefore(current.dueDate))) {
            byCard.set(invoice.creditCardId, invoice);
        }
    }
    return [...byCard.values()].sort((a, b) => a.dueDate.compare(b.dueDate) || a.name.localeCompare(b.name, 'pt-BR'));
}
