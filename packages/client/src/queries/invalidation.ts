import type { ReadRoute, WriteRoute } from './routes.ts';

/**
 * Leituras que mostram nomes de categoria e subcategoria.
 */
const CATEGORY_NAMES: readonly ReadRoute[] = ['categories.tree', 'reports.byCategory', 'reports.categoryTransactions'];

/**
 * Leituras que carregam transações inteiras (com a subcategoria de cada uma); mudam quando
 * a exclusão de uma subcategoria move os lançamentos para outra.
 */
const TRANSACTION_CONTENT: readonly ReadRoute[] = [
    'transactions.get',
    'transactions.listByPeriod',
    'statements.get',
    'invoices.get',
    'reports.categoryTransactions',
];

/**
 * Tudo que depende de saldo, transação, fatura ou cadastro de conta e cartão — todas as
 * leituras, menos a lista de perfis.
 *
 * A invalidação é por rota inteira, e não pelo mês da escrita, de propósito: uma transação
 * em outubro muda o extrato de outubro **e** o saldo de abertura de todos os meses
 * seguintes (a cadeia de fechamentos), a comparação "mês anterior" de novembro, a média dos
 * 3 meses de janeiro e a grade do impacto do cartão de quem olha para trás. Escopo exato é
 * onde o saldo velho na tela se esconde (desktop-mvp-plan §8); refazer as poucas consultas
 * ativas de uma tela custa milissegundos num SQLite local.
 */
const MONEY: readonly ReadRoute[] = [
    'accounts.list',
    'accounts.deletionImpact',
    'creditCards.list',
    'creditCards.deletionImpact',
    'categories.tree',
    'transactions.get',
    'transactions.listByPeriod',
    'statements.get',
    'balances.ofProfile',
    'invoices.suggest',
    'invoices.get',
    'invoices.listByCard',
    'integrity.verifyBalances',
    'reports.monthSummary',
    'reports.balanceEvolution',
    'reports.byCategory',
    'reports.categoryTransactions',
    'reports.cardImpact',
];

/** Toda leitura do núcleo; para escritas que mudam o perfil (moeda) ou criam um perfil novo. */
const EVERYTHING: readonly ReadRoute[] = ['profiles.list', ...MONEY];

/**
 * Mapa de invalidação: para cada escrita, as leituras que ela pode tornar velhas
 * (desktop-mvp-plan Fase 3.2). Centralizado, e não `invalidateQueries` espalhado pelas
 * telas, porque é o único jeito de testar que nenhuma escrita deixa saldo velho na tela
 * (desktop-mvp-plan §8): o teste executa cada escrita contra o núcleo de verdade e confere
 * que toda leitura cujo resultado mudou está na lista. `Record` sobre `WriteRoute` obriga a
 * mapear toda escrita nova.
 */
const INVALIDATIONS: Readonly<Record<WriteRoute, readonly ReadRoute[]>> = {
    'profiles.create': ['profiles.list'],
    // A moeda do perfil está em todo valor devolvido.
    'profiles.update': EVERYTHING,
    'onboarding.start': EVERYTHING,
    'accounts.create': MONEY,
    'accounts.update': MONEY,
    'accounts.disable': MONEY,
    'accounts.enable': MONEY,
    'accounts.delete': MONEY,
    'creditCards.create': MONEY,
    'creditCards.update': MONEY,
    'creditCards.disable': MONEY,
    'creditCards.enable': MONEY,
    'creditCards.delete': MONEY,
    'categories.create': CATEGORY_NAMES,
    'categories.update': CATEGORY_NAMES,
    'categories.delete': [...CATEGORY_NAMES, ...TRANSACTION_CONTENT],
    'subCategories.create': CATEGORY_NAMES,
    'subCategories.update': CATEGORY_NAMES,
    'subCategories.delete': [...CATEGORY_NAMES, ...TRANSACTION_CONTENT],
    'transactions.create': MONEY,
    'transactions.update': MONEY,
    'transactions.delete': MONEY,
    'transactions.setPaid': MONEY,
    'balances.rebuildAccount': MONEY,
    'invoices.pay': MONEY,
    'invoices.reopen': MONEY,
};

/**
 * @param route Escrita concluída.
 * @return As leituras a invalidar, sem repetição.
 */
export function invalidatedBy(route: WriteRoute): readonly ReadRoute[] {
    return [...new Set(INVALIDATIONS[route])];
}
