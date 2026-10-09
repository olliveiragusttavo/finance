import { Currency, Money, YearMonth } from '@finance/core';
import type { AccountResponse, CategoryBranchResponse, CreditCardResponse, InvoiceResponse, MoneyResponse, ProfileInvoiceResponse, RecurrenceResponse, TransactionResponse } from '@finance/core';
import { formatDayMonth, formatMonthAbbreviation } from '../format/dates.ts';
import { formatMoney } from '../format/money.ts';
import { matchesAllTerms, normalizeForSearch } from '../format/searchText.ts';
import { otherProfileAccountNames, type OtherProfileAccount } from './otherProfileAccounts.ts';
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

/**
 * Como o valor da linha se lê, sem depender só da cor (decisão de interface 7). `none` é o valor
 * zero, que nem entra nem sai — a fatura zerada por um estorno não pode aparecer como entrada.
 */
export type TransactionDirection = 'in' | 'out' | 'transfer' | 'none';

/** Os dados que a tela de Transações já tem em cache, juntados numa linha legível. */
export interface TransactionTableSource {
    /**
     * Perfil da tela. Uma transação com outro `profileId` é uma transferência que chega de
     * outro perfil: aparece como entrada e só para leitura.
     */
    readonly profileId: string;
    readonly transactions: readonly TransactionResponse[];
    /** Todas as contas do perfil, desativadas incluídas: o histórico continua mostrando o nome. */
    readonly accounts: readonly Pick<AccountResponse, 'id' | 'name'>[];
    /**
     * Cartões do perfil. A conta pagadora diz se a fatura do cartão pode ter linha própria na
     * tabela agrupada: só a fatura de uma conta listada em `accounts` é listada pelo núcleo.
     */
    readonly creditCards: readonly Pick<CreditCardResponse, 'id' | 'name' | 'accountId'>[];
    readonly categories: readonly CategoryBranchResponse[];
    /**
     * Faturas conhecidas, para a situação das compras no cartão. Uma compra cuja fatura não
     * está aqui é mostrada como "Na fatura" (em aberto) — o caso conservador: nunca diz que
     * um dinheiro saiu sem saber.
     */
    readonly invoices: readonly Pick<InvoiceResponse, 'id' | 'status'>[];
    /** Séries do perfil, para a coluna "Rec."; ausente, a coluna mostra só que há uma série. */
    readonly recurrences?: readonly RecurrenceResponse[];
    /**
     * Contas de outros perfis (`accounts.transferTargets`): nomeiam o outro lado das
     * transferências entre perfis e dizem quais saem do perfil; ausente, essas transferências
     * aparecem como internas e sem o nome do outro lado.
     */
    readonly otherProfileAccounts?: readonly OtherProfileAccount[];
    /**
     * Faturas que pesam no mês (`statements.profileInvoices`). Com elas e sem nenhum filtro, a
     * tabela agrupa as compras do cartão na linha da fatura; ausentes, as compras aparecem uma
     * a uma, como num filtro.
     */
    readonly monthInvoices?: readonly ProfileInvoiceResponse[];
}

/** Uma linha de lançamento da tabela, com os textos prontos e os valores crus para ordenar e filtrar. */
export interface TransactionRow {
    readonly kind: 'transaction';
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
    /**
     * Transferência recebida de outro perfil: quem edita, paga ou exclui é o perfil de
     * origem, dono da linha (database-design §4.13, uma transferência é uma linha só).
     */
    readonly readOnly: boolean;
    /**
     * Pagamento parcial de fatura: transferência que sai de uma fatura para a conta pagadora. Na
     * tabela agrupada, é parte do que o cartão tirou da conta: aparece com o sinal do efeito na
     * conta pagadora (`⇄ −R$ 50,00`) e conta no resultado, porque a linha da fatura já vem
     * líquida dele.
     */
    readonly invoicePayment: boolean;
}

/**
 * Linha de uma fatura na tabela agrupada, no lugar das compras do cartão: o valor que pesa na
 * conta pagadora, no dia em que pesa. Abre a fatura em Cartões em vez da edição.
 */
export interface InvoiceTableRow {
    readonly kind: 'invoice';
    /** `invoice:<id>`: nunca colide com o id de uma transação. */
    readonly id: string;
    readonly invoice: { readonly id: string; readonly creditCardId: string; readonly period: string };
    /** Data de caixa `YYYY-MM-DD`, para ordenar; a paga sem dia gravado usa o último dia do mês. */
    readonly dueDate: string;
    /** `10/10`, ou `—` na paga sem dia gravado. */
    readonly date: string;
    /** `Fatura Roxinho · out`. */
    readonly name: string;
    /** `Fatura do cartão`, como no extrato. */
    readonly category: string;
    /** Conta que paga a fatura. */
    readonly container: string;
    /** O que falta pagar, com o sinal do efeito na conta; já líquido dos pagamentos parciais. */
    readonly amount: MoneyResponse;
    readonly amountText: string;
    readonly direction: TransactionDirection;
    /** `onInvoice` na em aberto e `invoicePaid` na paga, para ordenar junto das compras. */
    readonly situation: TransactionSituation;
    /** `Em aberto` ou `Paga`, os rótulos da fatura. */
    readonly situationText: string;
    readonly recurrenceTag: null;
}

/** Uma linha da tabela de Transações: um lançamento ou, na tabela agrupada, uma fatura. */
export type TransactionTableRow = TransactionRow | InvoiceTableRow;

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
export function compareTransactionRows(key: TransactionSortKey): (a: TransactionTableRow, b: TransactionTableRow) => number {
    const primary = SORT_COMPARATORS[key];
    return (a, b) => primary(a, b) || compareText(a.dueDate, b.dueDate) || compareNames(a.name, b.name);
}

/**
 * Comparação de cada coluna. Textos comparam sem diferenciar maiúsculas nem acentos ("Água"
 * entre "Aluguel" e "Bar", e não depois do "Z"); o valor compara o efeito com sinal, então
 * crescente põe as maiores saídas primeiro; a situação segue `TRANSACTION_SITUATIONS`.
 */
const SORT_COMPARATORS: Readonly<Record<TransactionSortKey, (a: TransactionTableRow, b: TransactionTableRow) => number>> = {
    date: (a, b) => compareText(a.dueDate, b.dueDate),
    name: (a, b) => compareNames(a.name, b.name),
    category: (a, b) => compareNames(a.category, b.category),
    container: (a, b) => compareNames(a.container, b.container),
    amount: (a, b) => a.amount.amount - b.amount.amount,
    situation: (a, b) => TRANSACTION_SITUATIONS.indexOf(a.situation) - TRANSACTION_SITUATIONS.indexOf(b.situation),
};

/** A tabela filtrada e a linha-resumo. */
export interface TransactionTable {
    readonly rows: readonly TransactionTableRow[];
    /** As compras do cartão estão agrupadas nas linhas das faturas: a tela explica como vê-las. */
    readonly grouped: boolean;
    /** Resultado das linhas visíveis sem transferências e investimentos; `null` sem linhas. */
    readonly result: MoneyResponse | null;
    /**
     * `7 lançamentos · resultado +R$ 6.280,68`, `5 lançamentos · 2 faturas · resultado …` na
     * tabela agrupada, ou `Nenhum lançamento`.
     */
    readonly summary: string;
}

/**
 * Monta a tabela de Transações: junta os nomes de conta, cartão e categoria, aplica os
 * filtros e calcula a linha-resumo. Os filtros rodam aqui, e não no SQL, porque um mês tem
 * centenas de linhas e filtrar no núcleo só acrescentaria rotas (desktop-mvp-plan §2).
 *
 * Regra de negócio (Transações): o "resultado" é o efeito no saldo das entradas e saídas
 * visíveis; transferências e investimentos dentro do perfil ficam de fora porque só movem
 * dinheiro entre contas do próprio perfil — somá-los mostraria uma saída que não é gasto. A
 * transferência entre perfis entra, como nos relatórios: para este perfil, o dinheiro de fato
 * saiu ou chegou.
 *
 * Regra de negócio (Transações, desktop-mvp-plan Fase 11.1): sem nenhum filtro, as compras e os
 * estornos do cartão não aparecem um a um — poluiriam a lista do mês — e cada fatura que pesa no
 * mês vira uma linha só, no dia do pagamento ou, em aberto, no do vencimento, com o valor que
 * falta pagar, como no extrato da conta. O pagamento parcial continua como linha própria, porque
 * saiu da conta noutro dia, e conta no resultado com o sinal da saída na conta pagadora, já que a
 * linha da fatura vem líquida dele. A compra de um cartão cuja conta pagadora não está entre as
 * contas do perfil continua uma a uma: o núcleo não lista a fatura dela, e escondê-la tiraria o
 * gasto da lista e do resultado. Com qualquer filtro, quem filtra procura um item, e as compras
 * voltam uma a uma.
 *
 * @param source Transações do mês, as faturas do mês e os cadastros para os nomes.
 * @param filters Filtros escolhidos na tela.
 * @return As linhas filtradas, ordenadas por data e nome, e o resumo.
 */
export function buildTransactionTable(source: TransactionTableSource, filters: TransactionFilters): TransactionTable {
    const lookup = createLookup(source);
    const grouped = source.monthInvoices !== undefined && hasNoFilter(filters);
    const transactions = source.transactions
        .map((transaction) => toRow(transaction, lookup))
        .filter((row) => matches(row, filters) && !(grouped && isGroupedCardPurchase(row.transaction, lookup)))
        .map((row) => (grouped && row.invoicePayment ? asPaymentFromAccount(row) : row));
    const invoices = grouped ? (source.monthInvoices ?? []).map((invoice) => invoiceRow(invoice, lookup)) : [];
    const rows = [...transactions, ...invoices].sort(compareTransactionRows('date'));
    const result = sumResult(rows);
    return { rows, grouped, result, summary: summaryOf(transactions.length, invoices.length, result) };
}

/**
 * Agrupar só sem filtro porque o filtro é a forma de achar uma compra no cartão: com a busca,
 * a tag ou a categoria escolhida, quem procura quer o item, e a fatura inteira o esconderia.
 * Regra de negócio (Transações, desktop-mvp-plan Fase 11.1): qualquer filtro desfaz o
 * agrupamento.
 *
 * @param filters Filtros da tela.
 * @return `true` quando nenhum filtro está escolhido — só então a tabela agrupa as faturas.
 */
function hasNoFilter(filters: TransactionFilters): boolean {
    return filters.container === null && filters.category === null && filters.tagId === null && filters.situation === null && filters.search.trim() === '';
}

/**
 * Decide quais lançamentos a linha da fatura representa na tabela agrupada. O pagamento parcial
 * fica de fora porque saiu da conta pagadora noutro dia e tem linha própria; a compra de um cartão
 * cuja conta pagadora não está entre as contas do perfil (excluída, por exemplo) também, porque o
 * núcleo só lista as faturas dessas contas e escondê-la sumiria com o gasto sem nenhuma linha que o
 * represente.
 *
 * @param transaction Transação do mês.
 * @param lookup Índices dos cadastros, com os cartões cuja fatura tem linha na tabela agrupada.
 * @return `true` na compra, no estorno e em qualquer lançamento que fica dentro da fatura de um
 * cartão pago por conta do perfil.
 */
function isGroupedCardPurchase(transaction: TransactionResponse, lookup: Lookup): boolean {
    return transaction.container.kind === 'invoice'
        && transaction.destinationAccountId === null
        && lookup.groupedCreditCards.has(transaction.container.creditCardId);
}

/**
 * Mostra o pagamento parcial pelo efeito na conta pagadora. Na tabela agrupada ele conta no
 * resultado, porque a linha da fatura vem líquida dele; em módulo e neutro, como transferência
 * interna, a soma das linhas visíveis não bateria com o resumo.
 * Regra de negócio (Transações, desktop-mvp-plan Fase 11.1): na lista agrupada, o parcial conta no
 * resultado pelo efeito na conta pagadora.
 *
 * @param row Linha do pagamento parcial, montada como transferência saindo da fatura.
 * @return Uma nova linha com o valor, o texto e o sentido da saída na conta pagadora.
 */
function asPaymentFromAccount(row: TransactionRow): TransactionRow {
    const effect = row.transaction.destinationEffect ?? row.amount;
    const amount = formatSignedTransfer(effect);
    return { ...row, amount: effect, amountText: amount.text, direction: amount.direction };
}

/** Rótulos da situação da linha da fatura, os mesmos do extrato. */
const INVOICE_SITUATION_LABELS = { onInvoice: 'Em aberto', invoicePaid: 'Paga' } as const;

/**
 * Linha que substitui as compras do cartão na tabela agrupada, com o valor que pesa na conta
 * pagadora. O sentido segue o sinal do saldo, e a fatura zerada (compra e estorno iguais) fica
 * neutra: zero não é entrada nem saída.
 *
 * @param invoice Fatura que pesa no mês.
 * @param lookup Índices dos cadastros, para o nome do cartão.
 * @return A linha da fatura na tabela agrupada.
 */
function invoiceRow(invoice: ProfileInvoiceResponse, lookup: Lookup): InvoiceTableRow {
    const situation = invoice.status === 'paid' ? 'invoicePaid' : 'onInvoice';
    // A paga sem dia gravado ordena no fim do mês do extrato em que foi paga.
    const sortDate = invoice.cashDate ?? lastDayOf(invoice.paidInPeriod ?? invoice.period);
    return {
        kind: 'invoice',
        id: `invoice:${invoice.id}`,
        invoice: { id: invoice.id, creditCardId: invoice.creditCardId, period: invoice.period },
        dueDate: sortDate,
        date: invoice.cashDate === null ? '—' : formatDayMonth(invoice.cashDate),
        name: `Fatura ${lookup.creditCards.get(invoice.creditCardId) ?? invoice.creditCardName} · ${formatMonthAbbreviation(invoice.period)}`,
        category: 'Fatura do cartão',
        container: lookup.accounts.get(invoice.accountId) ?? invoice.accountName,
        amount: invoice.balance,
        amountText: formatMoney(invoice.balance, 'always'),
        direction: directionOf(invoice.balance),
        situation,
        situationText: INVOICE_SITUATION_LABELS[situation],
        recurrenceTag: null,
    };
}

/**
 * Dá à fatura paga sem dia gravado (pagas antes de existir `payment_date`) um lugar na ordem por
 * data: o fim do mês do extrato, depois de tudo que tem dia, em vez de uma data inventada no meio
 * do mês.
 *
 * @param period Competência `YYYY-MM` do extrato em que a fatura foi paga.
 * @return O último dia do mês, `YYYY-MM-DD`.
 */
function lastDayOf(period: string): string {
    const month = YearMonth.parse(period);
    return `${period}-${String(month.lengthInDays()).padStart(2, '0')}`;
}

/** Índices por id dos cadastros, montados uma vez por tabela. */
interface Lookup {
    readonly profileId: string;
    readonly accounts: ReadonlyMap<string, string>;
    /** Rótulos das contas de outros perfis, "Nubank (Empresa)". */
    readonly otherProfileAccounts: ReadonlyMap<string, string>;
    readonly creditCards: ReadonlyMap<string, string>;
    readonly subCategories: ReadonlyMap<string, { readonly categoryId: string; readonly label: string }>;
    readonly paidInvoices: ReadonlySet<string>;
    readonly recurrences: ReadonlyMap<string, RecurrenceResponse>;
    /** Cartões pagos por uma conta do perfil: só a fatura deles tem linha na tabela agrupada. */
    readonly groupedCreditCards: ReadonlySet<string>;
}

/**
 * @param source Cadastros da tela.
 * @return Os índices; evita uma busca linear por linha numa tabela de centenas de linhas.
 */
function createLookup(source: TransactionTableSource): Lookup {
    const accountIds = new Set(source.accounts.map((account) => account.id));
    return {
        profileId: source.profileId,
        accounts: new Map(source.accounts.map((account) => [account.id, account.name])),
        otherProfileAccounts: otherProfileAccountNames(source.otherProfileAccounts),
        creditCards: new Map(source.creditCards.map((creditCard) => [creditCard.id, creditCard.name])),
        subCategories: new Map(source.categories.flatMap((category) => category.subCategories.map((sub) => [
            sub.id,
            { categoryId: category.id, label: `${category.name} › ${sub.name}` },
        ]))),
        paidInvoices: new Set(source.invoices.filter((invoice) => invoice.status === 'paid').map((invoice) => invoice.id)),
        recurrences: new Map((source.recurrences ?? []).map((recurrence) => [recurrence.id, recurrence])),
        groupedCreditCards: new Set(source.creditCards.filter((creditCard) => accountIds.has(creditCard.accountId)).map((creditCard) => creditCard.id)),
    };
}

/**
 * @param transaction Transação do núcleo.
 * @param lookup Índices dos cadastros.
 * @return A linha com os textos da tabela.
 */
function toRow(transaction: TransactionResponse, lookup: Lookup): TransactionRow {
    const subCategory = lookup.subCategories.get(transaction.subCategoryId);
    const side = crossProfileSide(transaction, lookup);
    const effect = side === 'incoming' ? (transaction.destinationEffect ?? transaction.originEffect) : transaction.originEffect;
    const amount = side === null ? formatTransactionAmount(transaction.type, effect) : formatSignedTransfer(effect);
    const situation = situationOf(transaction, lookup);
    return {
        kind: 'transaction',
        id: transaction.id,
        transaction,
        dueDate: transaction.dueDate,
        date: formatDayMonth(transaction.dueDate),
        name: transaction.name,
        refund: transaction.type === 'expense' && transaction.value.amount < 0,
        categoryId: subCategory?.categoryId ?? null,
        // A subcategoria da transferência recebida é do perfil de origem e não está no lookup.
        category: side === 'incoming' ? 'Transferência recebida' : (subCategory?.label ?? ''),
        container: containerLabel(transaction, lookup),
        amount: effect,
        amountText: amount.text,
        direction: amount.direction,
        situation,
        situationText: SITUATION_LABELS[situation],
        recurring: transaction.recurrenceId !== null,
        recurrenceTag: formatRecurrenceTag(transaction, transaction.recurrenceId === null ? undefined : lookup.recurrences.get(transaction.recurrenceId)),
        readOnly: side === 'incoming',
        invoicePayment: transaction.container.kind === 'invoice' && transaction.destinationAccountId !== null,
    };
}

/**
 * Lado de uma transferência entre perfis visto deste perfil. A saída se reconhece pela conta
 * de destino, que é de outro perfil; a entrada, pelo dono da linha, que é outro perfil — o
 * núcleo só lista transação alheia quando ela chega a uma conta daqui.
 *
 * @param transaction Transação da linha.
 * @param lookup Índices com o perfil da tela e as contas de outros perfis.
 * @return `incoming`, `outgoing`, ou `null` quando a transação não cruza perfis.
 */
function crossProfileSide(transaction: TransactionResponse, lookup: Lookup): 'incoming' | 'outgoing' | null {
    if (transaction.profileId !== lookup.profileId) {
        return 'incoming';
    }
    const destination = transaction.destinationAccountId;
    return destination !== null && lookup.otherProfileAccounts.has(destination) ? 'outgoing' : null;
}

/**
 * Valor de uma transferência que conta no resultado — a entre perfis e, na tabela agrupada, o
 * pagamento parcial de fatura: `⇄` diz que é transferência e o sinal diz se o dinheiro saiu ou
 * chegou, porque para a conta é entrada ou saída de verdade (decisão de interface 7: sem
 * depender só da cor).
 *
 * @param effect Efeito no saldo da conta deste perfil: o da origem na saída, o do destino na
 * entrada.
 * @return O texto (`⇄ +R$ 500,00`) e o sentido.
 */
function formatSignedTransfer(effect: MoneyResponse): { readonly text: string; readonly direction: TransactionDirection } {
    return { text: `⇄ ${formatMoney(effect, 'always')}`, direction: directionOf(effect) };
}

/**
 * @param effect Efeito no saldo.
 * @return `out` no negativo, `in` no positivo e `none` no zero, que não pode se passar por
 * entrada só por não ser negativo.
 */
function directionOf(effect: MoneyResponse): TransactionDirection {
    return effect.amount < 0 ? 'out' : effect.amount > 0 ? 'in' : 'none';
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
 * O pagamento parcial sai da fatura mas é dinheiro que deixou a conta pagadora no dia dele: a
 * situação é a do próprio pagamento, e não a da fatura, que pode continuar em aberto.
 *
 * @param transaction Transação do núcleo.
 * @param lookup Índices dos cadastros, com as faturas pagas.
 * @return A situação mostrada na coluna "Situação".
 */
function situationOf(transaction: TransactionResponse, lookup: Lookup): TransactionSituation {
    if (transaction.container.kind === 'invoice' && transaction.destinationAccountId === null) {
        return lookup.paidInvoices.has(transaction.container.invoiceId) ? 'invoicePaid' : 'onInvoice';
    }
    return transaction.paid ? 'paid' : 'pending';
}

/**
 * @param transaction Transação do núcleo.
 * @param lookup Índices dos cadastros.
 * @return `Nubank`, `Roxinho · fat. nov`, ou origem `→` destino nas transferências; a conta do
 * outro perfil vem com o perfil, `Nubank → Itaú (Empresa)`.
 */
function containerLabel(transaction: TransactionResponse, lookup: Lookup): string {
    const { container } = transaction;
    const accountName = (id: string): string => lookup.accounts.get(id) ?? lookup.otherProfileAccounts.get(id) ?? '';
    const origin = container.kind === 'statement'
        ? accountName(container.accountId)
        : `${lookup.creditCards.get(container.creditCardId) ?? ''} · fat. ${formatMonthAbbreviation(container.period)}`;
    return transaction.destinationAccountId === null
        ? origin
        : `${origin} → ${accountName(transaction.destinationAccountId)}`;
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
 * bata com a soma dos centavos exibidos. Só as linhas neutras (`⇄` em módulo) ficam de fora: o
 * que conta no resultado é exatamente o que a tabela mostra com sinal — inclusive o pagamento
 * parcial da tabela agrupada, que `asPaymentFromAccount` já mostra como saída. Sem agrupar, o
 * parcial continua neutro, porque as compras já contam e somá-lo contaria o mesmo dinheiro duas
 * vezes.
 *
 * @param rows Linhas visíveis.
 * @return O resultado sem transferências; `null` quando não há linhas.
 */
function sumResult(rows: readonly TransactionTableRow[]): MoneyResponse | null {
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
 * Conta faturas e lançamentos separados porque a linha da fatura representa várias compras: somá-las
 * como lançamentos faria a contagem mudar ao filtrar sem nenhum lançamento novo.
 *
 * @param transactions Lançamentos visíveis.
 * @param invoices Linhas de fatura visíveis (só na tabela agrupada).
 * @param result Resultado das linhas; `null` quando não há nenhuma.
 * @return A linha-resumo do mockup, com as faturas à parte quando houver.
 */
function summaryOf(transactions: number, invoices: number, result: MoneyResponse | null): string {
    if (result === null) {
        return 'Nenhum lançamento';
    }
    const counts = [
        transactions > 0 || invoices === 0 ? `${String(transactions)} ${transactions === 1 ? 'lançamento' : 'lançamentos'}` : null,
        invoices > 0 ? `${String(invoices)} ${invoices === 1 ? 'fatura' : 'faturas'}` : null,
    ].filter((part) => part !== null);
    return `${counts.join(' · ')} · resultado ${formatMoney(result, 'always')}`;
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
