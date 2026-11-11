/**
 * Caminhos das telas do app, num lugar só. O Expo Router tipa as rotas só com os tipos que o
 * servidor de desenvolvimento gera, e o `pnpm check` roda sem ele; com as constantes, um caminho
 * que mudou de nome quebra a compilação aqui, e não vira um link morto numa tela.
 */
export const ROUTES = {
    home: '/home',
    transactions: '/transactions',
    accounts: '/accounts',
    cards: '/cards',
    more: '/more',
    goals: '/more/goals',
    registries: '/more/registries',
    categories: '/more/categories',
    profiles: '/more/profiles',
    tags: '/more/tags',
    notes: '/more/notes',
    devices: '/more/devices',
    settings: '/more/settings',
    newTransaction: '/new-transaction',
} as const;

/** Um dos caminhos do app. */
export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];

/**
 * @param transactionId Lançamento.
 * @return O caminho do detalhe do lançamento, empilhado na aba Transações.
 */
export function transactionRoute(transactionId: string): `/transactions/${string}` {
    return `/transactions/${transactionId}`;
}

/**
 * @param transactionId Lançamento a editar.
 * @return O caminho do formulário de lançamento aberto na edição dele.
 */
export function editTransactionRoute(transactionId: string): { readonly pathname: typeof ROUTES.newTransaction; readonly params: { readonly id: string } } {
    return { pathname: ROUTES.newTransaction, params: { id: transactionId } };
}

/**
 * @param accountId Conta.
 * @return O caminho do extrato da conta, empilhado na aba Contas.
 */
export function accountRoute(accountId: string): `/accounts/${string}` {
    return `/accounts/${accountId}`;
}

/**
 * Detalhe do lançamento aberto pelo extrato. Fica na pilha da aba Contas, e não em
 * `transactionRoute`, para que o "voltar" devolva ao extrato em vez de deixar o usuário na aba
 * Transações.
 *
 * @param transactionId Lançamento.
 * @return O caminho do detalhe do lançamento na aba Contas.
 */
export function accountTransactionRoute(transactionId: string): `/accounts/transaction/${string}` {
    return `/accounts/transaction/${transactionId}`;
}

/**
 * Fatura de um cartão, empilhada na aba Cartões (mockup `MobileFatura`). Sem competência, a tela
 * mostra a fatura do mês de referência; com ela, a pedida — a "ver fatura" de um extrato ou de
 * Transações abre a fatura daquela linha, que pode ser de outro mês.
 *
 * @param creditCardId Cartão.
 * @param period Competência `YYYY-MM` da fatura, ou `null` para a do mês de referência.
 * @return O caminho da fatura, com a competência como parâmetro.
 */
export function invoiceRoute(creditCardId: string, period: string | null): { readonly pathname: '/cards/[id]'; readonly params: { readonly id: string; readonly invoice?: string } } {
    return { pathname: '/cards/[id]', params: period === null ? { id: creditCardId } : { id: creditCardId, invoice: period } };
}

/**
 * Detalhe de uma compra aberta pela fatura, na pilha da aba Cartões: é ali que se editam as
 * compras do cartão, que em Transações ficam agrupadas na linha da fatura, e o "voltar" devolve
 * à fatura.
 *
 * @param transactionId Lançamento.
 * @return O caminho do detalhe do lançamento na aba Cartões.
 */
export function cardTransactionRoute(transactionId: string): `/cards/transaction/${string}` {
    return `/cards/transaction/${transactionId}`;
}

/**
 * @param goalId Meta.
 * @return O caminho do detalhe da meta, empilhado na aba Mais, acima da lista de Metas.
 */
export function goalRoute(goalId: string): `/more/goal/${string}` {
    return `/more/goal/${goalId}`;
}

/**
 * Detalhe de uma transação vinculada aberta pela meta, na pilha da aba Mais: o "voltar" devolve à
 * meta, onde se nota a vinculada errada.
 *
 * @param transactionId Lançamento.
 * @return O caminho do detalhe do lançamento na aba Mais.
 */
export function moreTransactionRoute(transactionId: string): `/more/transaction/${string}` {
    return `/more/transaction/${transactionId}`;
}

/**
 * @param categoryId Categoria.
 * @return O caminho do detalhe da categoria, empilhado sobre a lista de Categorias na aba Mais.
 */
export function categoryRoute(categoryId: string): `/more/category/${string}` {
    return `/more/category/${categoryId}`;
}

/** Parâmetro da rota do editor de anotação que abre uma anotação nova. */
export const NEW_NOTE = 'new';

/**
 * @param noteId Anotação a editar, ou `NEW_NOTE` para escrever uma nova.
 * @return O caminho do editor, empilhado sobre a lista de Anotações na aba Mais.
 */
export function noteRoute(noteId: string): `/more/note/${string}` {
    return `/more/note/${noteId}`;
}
