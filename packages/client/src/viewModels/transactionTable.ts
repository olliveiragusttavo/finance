import { Currency, Money } from '@finance/core';
import type { AccountResponse, CategoryBranchResponse, CreditCardResponse, InvoiceResponse, MoneyResponse, RecurrenceResponse, TransactionResponse } from '@finance/core';
import { formatDayMonth, formatMonthAbbreviation } from '../format/dates.ts';
import { formatMoney } from '../format/money.ts';
import { matchesAllTerms, normalizeForSearch } from '../format/searchText.ts';
import { formatRecurrenceTag } from './recurrenceView.ts';

/**
 * Situação de um lançamento na tabela:
 * - `paid` / `pending`: lançamento de conta pago ou não;
 * - `onInvoice` / `invoicePaid`: compra no cartão com a fatura em aberto ou paga — numa
 *   compra, quem decide se o dinheiro saiu é a fatura, não o `paid` da própria transação.
 */
export type TransactionSituation = 'paid' | 'pending' | 'onInvoice' | 'invoicePaid';

/** Rótulos dos mockups para cada situação. */
const SITUATION_LABELS: Readonly<Record<TransactionSituation, string>> = {
    paid: 'Pago',
    pending: 'Pendente',
    onInvoice: 'Na fatura',
    invoicePaid: 'Fat. paga',
};

/** Como o valor da linha se lê, sem depender só da cor (decisão de interface 7). */
export type TransactionDirection = 'in' | 'out' | 'transfer';

/** Os dados que a tela de Transações já tem em cache, juntados numa linha legível. */
export interface TransactionTableSource {
    readonly transactions: readonly TransactionResponse[];
    /** Todas as contas do perfil, desativadas incluídas: o histórico continua mostrando o nome. */
    readonly accounts: readonly Pick<AccountResponse, 'id' | 'name'>[];
    readonly creditCards: readonly Pick<CreditCardResponse, 'id' | 'name'>[];
    readonly categories: readonly CategoryBranchResponse[];
    /**
     * Faturas conhecidas, para a situação das compras no cartão. Uma compra cuja fatura não
     * está aqui é mostrada como "Na fatura" (em aberto) — o caso conservador: nunca diz que
     * um dinheiro saiu sem saber.
     */
    readonly invoices: readonly Pick<InvoiceResponse, 'id' | 'status'>[];
    /** Séries do perfil, para a coluna "Rec."; ausente, a coluna mostra só que há uma série. */
    readonly recurrences?: readonly RecurrenceResponse[];
}

/** Uma linha da tabela, com os textos prontos e os valores crus para ordenar e filtrar. */
export interface TransactionRow {
    readonly id: string;
    readonly transaction: TransactionResponse;
    /** Vencimento `YYYY-MM-DD`, para ordenar; a lista do mês vem pelo vencimento. */
    readonly dueDate: string;
    /** `08/10`. */
    readonly date: string;
    readonly name: string;
    /** Despesa com valor negativo: aparece com a etiqueta "estorno" (database-design §4.13). */
    readonly refund: boolean;
    readonly categoryId: string | null;
    /** `Alimentação › Mercado`. */
    readonly category: string;
    /** `Nubank`, `Roxinho · fat. nov` ou `Nubank → Tesouro`. */
    readonly container: string;
    /** Efeito com sinal na origem, para ordenar e somar. */
    readonly amount: MoneyResponse;
    /** `+R$ 9.500,00`, `−R$ 487,32` ou `⇄ R$ 500,00`. */
    readonly amountText: string;
    readonly direction: TransactionDirection;
    readonly situation: TransactionSituation;
    readonly situationText: string;
    /** Gerada por recorrência. */
    readonly recurring: boolean;
    /** A coluna "Rec." do mockup: "3/12", "Fixa"; `null` num lançamento avulso. */
    readonly recurrenceTag: string | null;
}

/** Filtros da tela de Transações; `null` e texto vazio significam "Todos/Todas". */
export interface TransactionFilters {
    readonly container: { readonly kind: 'account'; readonly accountId: string } | { readonly kind: 'creditCard'; readonly creditCardId: string } | null;
    readonly category: { readonly kind: 'category'; readonly categoryId: string } | { readonly kind: 'subCategory'; readonly subCategoryId: string } | null;
    /** Tag que o lançamento precisa ter (filtro "Tag" do mockup). */
    readonly tagId: string | null;
    readonly situation: TransactionSituation | null;
    readonly search: string;
}

/** Nenhum filtro: o estado inicial da tela. */
export const NO_TRANSACTION_FILTERS: TransactionFilters = { container: null, category: null, tagId: null, situation: null, search: '' };

/** Situações na ordem dos filtros e da ordenação: o que ainda vai sair da conta vem primeiro. */
export const TRANSACTION_SITUATIONS: readonly TransactionSituation[] = ['pending', 'onInvoice', 'paid', 'invoicePaid'];

/**
 * @param situation Situação de um lançamento.
 * @return O rótulo do mockup ("Pendente", "Na fatura"...), para a tabela e o filtro.
 */
export function formatTransactionSituation(situation: TransactionSituation): string {
    return SITUATION_LABELS[situation];
}

/** Colunas pelas quais a tabela de Transações pode ser ordenada. */
export type TransactionSortKey = 'date' | 'name' | 'category' | 'container' | 'amount' | 'situation';

/**
 * Comparador crescente de uma coluna da tabela; a ordem decrescente é o inverso dele. O empate
 * cai na data e depois no nome, para que linhas iguais na coluna escolhida não troquem de lugar
 * entre uma escrita e outra (a tabela se refaz a cada invalidação).
 *
 * @param key Coluna da ordenação.
 * @return A função de comparação de duas linhas.
 */
export function compareTransactionRows(key: TransactionSortKey): (a: TransactionRow, b: TransactionRow) => number {
    const primary = SORT_COMPARATORS[key];
    return (a, b) => primary(a, b) || compareText(a.dueDate, b.dueDate) || compareNames(a.name, b.name);
}

/**
 * Comparação de cada coluna. Textos comparam sem diferenciar maiúsculas nem acentos ("Água"
 * entre "Aluguel" e "Bar", e não depois do "Z"); o valor compara o efeito com sinal, então
 * crescente põe as maiores saídas primeiro; a situação segue `TRANSACTION_SITUATIONS`.
 */
const SORT_COMPARATORS: Readonly<Record<TransactionSortKey, (a: TransactionRow, b: TransactionRow) => number>> = {
    date: (a, b) => compareText(a.dueDate, b.dueDate),
    name: (a, b) => compareNames(a.name, b.name),
    category: (a, b) => compareNames(a.category, b.category),
    container: (a, b) => compareNames(a.container, b.container),
    amount: (a, b) => a.amount.amount - b.amount.amount,
    situation: (a, b) => TRANSACTION_SITUATIONS.indexOf(a.situation) - TRANSACTION_SITUATIONS.indexOf(b.situation),
};

/** A tabela filtrada e a linha-resumo. */
export interface TransactionTable {
    readonly rows: readonly TransactionRow[];
    /** Resultado das linhas visíveis sem transferências e investimentos; `null` sem linhas. */
    readonly result: MoneyResponse | null;
    /** `7 lançamentos · resultado +R$ 6.280,68`, ou `Nenhum lançamento`. */
    readonly summary: string;
}

/**
 * Monta a tabela de Transações: junta os nomes de conta, cartão e categoria, aplica os
 * filtros e calcula a linha-resumo. Os filtros rodam aqui, e não no SQL, porque um mês tem
 * centenas de linhas e filtrar no núcleo só acrescentaria rotas (desktop-mvp-plan §2).
 *
 * Regra de negócio (Transações): o "resultado" é o efeito no saldo das entradas e saídas
 * visíveis; transferências e investimentos ficam de fora porque só movem dinheiro entre
 * contas do próprio perfil — somá-los mostraria uma saída que não é gasto.
 *
 * @param source Transações do mês e os cadastros para os nomes.
 * @param filters Filtros escolhidos na tela.
 * @return As linhas filtradas, ordenadas por vencimento e nome, e o resumo.
 */
export function buildTransactionTable(source: TransactionTableSource, filters: TransactionFilters): TransactionTable {
    const lookup = createLookup(source);
    const rows = source.transactions
        .map((transaction) => toRow(transaction, lookup))
        .filter((row) => matches(row, filters))
        .sort(compareTransactionRows('date'));
    const result = sumResult(rows);
    return { rows, result, summary: summaryOf(rows.length, result) };
}

/** Índices por id dos cadastros, montados uma vez por tabela. */
interface Lookup {
    readonly accounts: ReadonlyMap<string, string>;
    readonly creditCards: ReadonlyMap<string, string>;
    readonly subCategories: ReadonlyMap<string, { readonly categoryId: string; readonly label: string }>;
    readonly paidInvoices: ReadonlySet<string>;
    readonly recurrences: ReadonlyMap<string, RecurrenceResponse>;
}

/**
 * @param source Cadastros da tela.
 * @return Os índices; evita uma busca linear por linha numa tabela de centenas de linhas.
 */
function createLookup(source: TransactionTableSource): Lookup {
    return {
        accounts: new Map(source.accounts.map((account) => [account.id, account.name])),
        creditCards: new Map(source.creditCards.map((creditCard) => [creditCard.id, creditCard.name])),
        subCategories: new Map(source.categories.flatMap((category) => category.subCategories.map((sub) => [
            sub.id,
            { categoryId: category.id, label: `${category.name} › ${sub.name}` },
        ]))),
        paidInvoices: new Set(source.invoices.filter((invoice) => invoice.status === 'paid').map((invoice) => invoice.id)),
        recurrences: new Map((source.recurrences ?? []).map((recurrence) => [recurrence.id, recurrence])),
    };
}

/**
 * @param transaction Transação do núcleo.
 * @param lookup Índices dos cadastros.
 * @return A linha com os textos da tabela.
 */
function toRow(transaction: TransactionResponse, lookup: Lookup): TransactionRow {
    const subCategory = lookup.subCategories.get(transaction.subCategoryId);
    const amount = formatTransactionAmount(transaction.type, transaction.originEffect);
    const situation = situationOf(transaction, lookup);
    return {
        id: transaction.id,
        transaction,
        dueDate: transaction.dueDate,
        date: formatDayMonth(transaction.dueDate),
        name: transaction.name,
        refund: transaction.type === 'expense' && transaction.value.amount < 0,
        categoryId: subCategory?.categoryId ?? null,
        category: subCategory?.label ?? '',
        container: containerLabel(transaction, lookup),
        amount: transaction.originEffect,
        amountText: amount.text,
        direction: amount.direction,
        situation,
        situationText: SITUATION_LABELS[situation],
        recurring: transaction.recurrenceId !== null,
        recurrenceTag: formatRecurrenceTag(transaction, transaction.recurrenceId === null ? undefined : lookup.recurrences.get(transaction.recurrenceId)),
    };
}

/**
 * Valor de um lançamento como a tabela e a prévia do formulário o mostram, sem depender só da
 * cor (decisão de interface 7): transferência e investimento com `⇄` e em módulo, porque só
 * movem dinheiro entre contas do perfil; o resto com o sinal do efeito no saldo, que já inclui
 * estorno e encargos.
 *
 * @param type Tipo do lançamento.
 * @param effect Efeito no saldo da origem, como o núcleo o calcula.
 * @return O texto (`−R$ 487,32`, `+R$ 23,90`, `⇄ R$ 500,00`) e o sentido.
 */
export function formatTransactionAmount(type: TransactionResponse['type'], effect: MoneyResponse): { readonly text: string; readonly direction: TransactionDirection } {
    if (type === 'transference' || type === 'investment') {
        return { text: `⇄ ${formatMoney(effect, 'absolute')}`, direction: 'transfer' };
    }
    return { text: formatMoney(effect, 'always'), direction: effect.amount < 0 ? 'out' : 'in' };
}

/**
 * @param transaction Transação do núcleo.
 * @param lookup Índices dos cadastros, com as faturas pagas.
 * @return A situação mostrada na coluna "Situação".
 */
function situationOf(transaction: TransactionResponse, lookup: Lookup): TransactionSituation {
    if (transaction.container.kind === 'invoice') {
        return lookup.paidInvoices.has(transaction.container.invoiceId) ? 'invoicePaid' : 'onInvoice';
    }
    return transaction.paid ? 'paid' : 'pending';
}

/**
 * @param transaction Transação do núcleo.
 * @param lookup Índices dos cadastros.
 * @return `Nubank`, `Roxinho · fat. nov`, ou origem `→` destino nas transferências.
 */
function containerLabel(transaction: TransactionResponse, lookup: Lookup): string {
    const { container } = transaction;
    const origin = container.kind === 'statement'
        ? lookup.accounts.get(container.accountId) ?? ''
        : `${lookup.creditCards.get(container.creditCardId) ?? ''} · fat. ${formatMonthAbbreviation(container.period)}`;
    return transaction.destinationAccountId === null
        ? origin
        : `${origin} → ${lookup.accounts.get(transaction.destinationAccountId) ?? ''}`;
}

/**
 * @param row Linha montada.
 * @param filters Filtros da tela.
 * @return `true` quando a linha passa por todos os filtros.
 */
function matches(row: TransactionRow, filters: TransactionFilters): boolean {
    return matchesContainer(row.transaction, filters.container)
        && matchesCategory(row, filters.category)
        && (filters.tagId === null || row.transaction.tagIds.includes(filters.tagId))
        && (filters.situation === null || row.situation === filters.situation)
        && matchesSearch(row.transaction, filters.search);
}

/**
 * Filtrar por conta mostra também o que **chega** nela (transferência recebida), porque no
 * extrato da conta essas linhas mexem no saldo do mesmo jeito.
 *
 * @param transaction Transação da linha.
 * @param filter Conta ou cartão escolhido.
 * @return `true` quando a transação é da conta ou do cartão, ou não há filtro.
 */
function matchesContainer(transaction: TransactionResponse, filter: TransactionFilters['container']): boolean {
    if (filter === null) {
        return true;
    }
    const { container } = transaction;
    if (filter.kind === 'creditCard') {
        return container.kind === 'invoice' && container.creditCardId === filter.creditCardId;
    }
    return (container.kind === 'statement' && container.accountId === filter.accountId) || transaction.destinationAccountId === filter.accountId;
}

/**
 * @param row Linha montada, com a categoria já resolvida.
 * @param filter Categoria ou subcategoria escolhida.
 * @return `true` quando a linha pertence ao filtro, ou não há filtro.
 */
function matchesCategory(row: TransactionRow, filter: TransactionFilters['category']): boolean {
    if (filter === null) {
        return true;
    }
    return filter.kind === 'category' ? row.categoryId === filter.categoryId : row.transaction.subCategoryId === filter.subCategoryId;
}

/**
 * Busca sem diferenciar maiúsculas nem acentos ("cafe" acha "Café"), no nome e na descrição,
 * como diz o placeholder do mockup ("nome, descrição…").
 *
 * @param transaction Transação da linha.
 * @param search Texto digitado.
 * @return `true` quando todo termo aparece no nome ou na descrição.
 */
function matchesSearch(transaction: TransactionResponse, search: string): boolean {
    return matchesAllTerms(search, `${transaction.name} ${transaction.description ?? ''}`);
}

/**
 * Soma com `Money` e arredonda uma vez no fim (database-design §3.7), para que o resultado
 * bata com a soma dos centavos exibidos.
 *
 * @param rows Linhas visíveis.
 * @return O resultado sem transferências; `null` quando não há linhas.
 */
function sumResult(rows: readonly TransactionRow[]): MoneyResponse | null {
    const first = rows[0];
    if (first === undefined) {
        return null;
    }
    const currency = Currency.of(first.amount.currency);
    const total = rows
        .filter((row) => row.direction !== 'transfer')
        .reduce((sum, row) => sum.add(Money.of(row.amount.amount, currency)), Money.zero(currency))
        .rounded();
    return { amount: total.amount, currency: currency.code };
}

/**
 * @param count Linhas visíveis.
 * @param result Resultado das linhas.
 * @return A linha-resumo do mockup.
 */
function summaryOf(count: number, result: MoneyResponse | null): string {
    if (result === null) {
        return 'Nenhum lançamento';
    }
    return `${String(count)} ${count === 1 ? 'lançamento' : 'lançamentos'} · resultado ${formatMoney(result, 'always')}`;
}

/**
 * @param a Primeiro texto.
 * @param b Segundo texto.
 * @return Ordem por ponto de código, estável entre runtimes (o `localeCompare` depende do ICU).
 */
function compareText(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * @param a Primeiro nome.
 * @param b Segundo nome.
 * @return Ordem sem diferenciar maiúsculas nem acentos; o texto original desempata, para que a
 * ordem seja total e não dependa da ordem de chegada.
 */
function compareNames(a: string, b: string): number {
    return compareText(normalizeForSearch(a), normalizeForSearch(b)) || compareText(a, b);
}
