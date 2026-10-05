import type { AccountResponse, CategoryBranchResponse, CreditCardResponse, MoneyResponse, StatementInvoiceResponse, StatementResponse, TransactionResponse } from '@finance/core';
import { formatDayMonth, formatMonthAbbreviation } from '../format/dates.ts';
import { formatMoney } from '../format/money.ts';

/**
 * De onde vem a linha do extrato. Os quatro tipos são as quatro fontes do movimento do mês
 * (database-design §4.6): a tabela mostra cada uma, para que entradas e saídas se expliquem
 * linha a linha.
 */
export type StatementRowKind = 'transaction' | 'incomingTransfer' | 'paidInvoice' | 'openInvoice';

/**
 * Situação de uma linha:
 * - `paid` / `pending`: lançamento pago ou não — decide se entra no consolidado;
 * - `invoicePaid` / `invoiceOpen`: fatura paga neste extrato ou em aberto vencendo no mês, que
 *   pesa só no previsto.
 */
export type StatementSituation = 'paid' | 'pending' | 'invoicePaid' | 'invoiceOpen';

/** Rótulos do mockup `DesktopContas`; os de lançamento são os mesmos da tela de Transações. */
const SITUATION_LABELS: Readonly<Record<StatementSituation, string>> = {
    paid: 'Pago',
    pending: 'Pendente',
    invoicePaid: 'Paga',
    invoiceOpen: 'Em aberto',
};

/** Como o valor se lê sem depender só da cor (decisão de interface 7). */
export type StatementDirection = 'in' | 'out' | 'transfer';

/** Fatura para onde a linha leva ("ver fatura"): o cartão e a competência. */
export interface StatementInvoiceLink {
    readonly creditCardId: string;
    readonly period: string;
}

/** O extrato e os cadastros que dão nome às contas, aos cartões e às subcategorias. */
export interface StatementTableSource {
    readonly statement: StatementResponse;
    /** Todas as contas do perfil, desativadas incluídas: o histórico continua mostrando o nome. */
    readonly accounts: readonly Pick<AccountResponse, 'id' | 'name'>[];
    readonly creditCards: readonly Pick<CreditCardResponse, 'id' | 'name'>[];
    readonly categories: readonly CategoryBranchResponse[];
}

/** Uma linha da tabela de movimentos, com os textos prontos. */
export interface StatementRow {
    /** Chave da linha na lista, prefixada pela fonte para que a fatura e a transação nunca colidam. */
    readonly key: string;
    readonly kind: StatementRowKind;
    /** `08/10`, ou `—` na fatura paga antes de o dia ser gravado. */
    readonly date: string;
    /** `Salário`, `Fatura Roxinho · set`. */
    readonly name: string;
    /** Complemento do nome: `→ Tesouro`, `de Nubank`, `fatura Roxinho · out`; `null` sem complemento. */
    readonly detail: string | null;
    /** Despesa com valor negativo, mostrada com a etiqueta "estorno" (database-design §4.13). */
    readonly refund: boolean;
    /** Fatura para o link "ver fatura"; `null` nas linhas que não são de fatura. */
    readonly invoice: StatementInvoiceLink | null;
    /** Transação para abrir na edição; `null` nas linhas de fatura. */
    readonly transactionId: string | null;
    /** `Alimentação › Mercado`, ou `Fatura do cartão`. */
    readonly category: string;
    readonly situation: StatementSituation;
    readonly situationText: string;
    /** Efeito com sinal no saldo **desta** conta. */
    readonly amount: MoneyResponse;
    /** `+R$ 9.500,00`, `−R$ 2.449,75` ou `⇄ −R$ 500,00`. */
    readonly amountText: string;
    readonly direction: StatementDirection;
}

/** A tabela de movimentos do extrato. */
export interface StatementTable {
    readonly rows: readonly StatementRow[];
    /** Há fatura em aberto vencendo no mês: a tela explica que ela só pesa no previsto. */
    readonly hasOpenInvoices: boolean;
}

/** Linha antes da ordenação, com a data de caixa crua. */
interface DatedRow {
    /** `YYYY-MM-DD`; `null` na fatura paga sem dia gravado. */
    readonly cashDate: string | null;
    readonly row: StatementRow;
}

/**
 * Monta a tabela de movimentos do extrato de uma conta (mockup `DesktopContas`): as transações
 * do extrato, as transferências que chegam, as faturas pagas no mês e as em aberto que vencem
 * nele, na ordem em que o dinheiro se move.
 *
 * Regra de negócio (Extrato): a data de cada linha é a **data de caixa** — pagamento quando
 * pago, vencimento em aberto (database-design §4.13); a da fatura paga é o dia do pagamento e a
 * da fatura em aberto, o vencimento, que é quando ela pesa no previsto (§4.7). O valor é o
 * efeito no saldo desta conta, como o núcleo o calculou: na transferência que chega é o efeito
 * no destino, e o pagamento parcial de fatura aparece como saída.
 *
 * @param source O extrato e os cadastros para os nomes.
 * @return As linhas por data de caixa — a fatura paga sem dia vai para o fim, porque não se
 * sabe em que ponto do mês ela entrou — e se há fatura em aberto.
 */
export function buildStatementTable(source: StatementTableSource): StatementTable {
    const lookup = createLookup(source);
    const { statement } = source;
    const dated: DatedRow[] = [
        ...statement.transactions.map((transaction) => transactionRow(transaction, lookup)),
        ...statement.incomingTransfers.map((transaction) => incomingRow(transaction, lookup)),
        ...statement.paidInvoices.map((invoice) => invoiceRow(invoice, invoice.paymentDate, 'invoicePaid')),
        ...statement.openInvoicesDue.map((invoice) => invoiceRow(invoice, invoice.dueDate, 'invoiceOpen')),
    ];
    const rows = dated
        .sort((a, b) => compareDates(a.cashDate, b.cashDate) || compareText(a.row.name, b.row.name))
        .map(({ row }) => row);
    return { rows, hasOpenInvoices: statement.openInvoicesDue.length > 0 };
}

/** Índices por id dos cadastros, montados uma vez por tabela. */
interface Lookup {
    readonly accounts: ReadonlyMap<string, string>;
    readonly creditCards: ReadonlyMap<string, string>;
    readonly subCategories: ReadonlyMap<string, string>;
}

/**
 * @param source Cadastros da tela.
 * @return Os índices, para não buscar linearmente a cada linha.
 */
function createLookup(source: StatementTableSource): Lookup {
    return {
        accounts: new Map(source.accounts.map((account) => [account.id, account.name])),
        creditCards: new Map(source.creditCards.map((creditCard) => [creditCard.id, creditCard.name])),
        subCategories: new Map(source.categories.flatMap((category) => category.subCategories.map((sub) => [sub.id, `${category.name} › ${sub.name}`]))),
    };
}

/**
 * Transação do próprio extrato: o efeito é o da origem.
 *
 * @param transaction Transação do extrato.
 * @param lookup Índices dos cadastros.
 * @return A linha, com a conta de destino no complemento quando é transferência ou investimento.
 */
function transactionRow(transaction: TransactionResponse, lookup: Lookup): DatedRow {
    const destination = transaction.destinationAccountId === null ? null : `→ ${lookup.accounts.get(transaction.destinationAccountId) ?? ''}`;
    return entryRow(transaction, { kind: 'transaction', effect: transaction.originEffect, detail: destination, invoice: null }, lookup);
}

/**
 * Transferência ou investimento que chega a esta conta: o efeito é o do destino. Quando a
 * origem é uma fatura, é um pagamento parcial (database-design §4.7) e o complemento nomeia a
 * fatura, com o link para ela.
 *
 * @param transaction Transação que tem esta conta como destino.
 * @param lookup Índices dos cadastros.
 * @return A linha, com a origem no complemento.
 * @throws {Error} Quando a transação não tem efeito no destino — o núcleo só lista como
 * "chegando" o que tem conta de destino, então é quebra de contrato, e mostrar o efeito da
 * origem no lugar inverteria o sinal na tela.
 */
function incomingRow(transaction: TransactionResponse, lookup: Lookup): DatedRow {
    const { container, destinationEffect } = transaction;
    if (destinationEffect === null) {
        throw new Error(`transferência ${transaction.id} chegou ao extrato sem efeito no destino`);
    }
    return entryRow(
        transaction,
        container.kind === 'statement'
            ? { kind: 'incomingTransfer', effect: destinationEffect, detail: `de ${lookup.accounts.get(container.accountId) ?? ''}`, invoice: null }
            : {
                  kind: 'incomingTransfer',
                  effect: destinationEffect,
                  detail: `fatura ${lookup.creditCards.get(container.creditCardId) ?? ''} · ${formatMonthAbbreviation(container.period)}`,
                  invoice: { creditCardId: container.creditCardId, period: container.period },
              },
        lookup,
    );
}

/** O que muda entre a linha da transação do extrato e a da que chega. */
interface EntryPlacement {
    readonly kind: 'transaction' | 'incomingTransfer';
    /** Efeito no saldo desta conta: o da origem ou o do destino. */
    readonly effect: MoneyResponse;
    readonly detail: string | null;
    readonly invoice: StatementInvoiceLink | null;
}

/**
 * Parte comum das linhas de lançamento, para que as duas fontes usem a mesma data de caixa,
 * situação e regra de sinal.
 *
 * @param transaction Transação da linha.
 * @param placement Fonte, efeito nesta conta, complemento e fatura de origem.
 * @param lookup Índices dos cadastros.
 * @return A linha de lançamento com a data de caixa.
 */
function entryRow(transaction: TransactionResponse, placement: EntryPlacement, lookup: Lookup): DatedRow {
    const { effect } = placement;
    const transfer = transaction.type === 'transference' || transaction.type === 'investment';
    const cashDate = transaction.paymentDate ?? transaction.dueDate;
    const situation: StatementSituation = transaction.paid ? 'paid' : 'pending';
    return {
        cashDate,
        row: {
            key: `transaction:${transaction.id}`,
            kind: placement.kind,
            date: formatDayMonth(cashDate),
            name: transaction.name,
            detail: placement.detail,
            refund: transaction.type === 'expense' && transaction.value.amount < 0,
            invoice: placement.invoice,
            transactionId: transaction.id,
            category: lookup.subCategories.get(transaction.subCategoryId) ?? '',
            situation,
            situationText: SITUATION_LABELS[situation],
            amount: effect,
            amountText: transfer ? `⇄ ${formatMoney(effect, 'always')}` : formatMoney(effect, 'always'),
            direction: transfer ? 'transfer' : effect.amount < 0 ? 'out' : 'in',
        },
    };
}

/**
 * Fatura no extrato da conta que a quita. O valor é o `balance`, que já tem o sinal do efeito
 * na conta (database-design §4.7): uma fatura credora aparece como entrada.
 *
 * @param invoice Fatura paga neste extrato ou em aberto vencendo no mês.
 * @param cashDate Dia do pagamento ou do vencimento; `null` na paga sem dia gravado.
 * @param situation Paga ou em aberto.
 * @return A linha da fatura, com o link para ela.
 */
function invoiceRow(invoice: StatementInvoiceResponse, cashDate: string | null, situation: 'invoicePaid' | 'invoiceOpen'): DatedRow {
    return {
        cashDate,
        row: {
            key: `invoice:${invoice.id}`,
            kind: situation === 'invoicePaid' ? 'paidInvoice' : 'openInvoice',
            date: cashDate === null ? '—' : formatDayMonth(cashDate),
            name: `Fatura ${invoice.creditCardName} · ${formatMonthAbbreviation(invoice.period)}`,
            detail: null,
            refund: false,
            invoice: { creditCardId: invoice.creditCardId, period: invoice.period },
            transactionId: null,
            category: 'Fatura do cartão',
            situation,
            situationText: SITUATION_LABELS[situation],
            amount: invoice.balance,
            amountText: formatMoney(invoice.balance, 'always'),
            direction: invoice.balance.amount < 0 ? 'out' : 'in',
        },
    };
}

/**
 * @param a Primeira data `YYYY-MM-DD`, ou `null`.
 * @param b Segunda data, ou `null`.
 * @return Ordem cronológica, com as datas desconhecidas depois de todas as conhecidas.
 */
function compareDates(a: string | null, b: string | null): number {
    if (a === null || b === null) {
        return a === b ? 0 : a === null ? 1 : -1;
    }
    return compareText(a, b);
}

/**
 * @param a Primeiro texto.
 * @param b Segundo texto.
 * @return Ordem por ponto de código, estável entre runtimes (o `localeCompare` depende do ICU).
 */
function compareText(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}
