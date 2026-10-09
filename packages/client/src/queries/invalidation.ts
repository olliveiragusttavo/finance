import type { ReadRoute, WriteRoute } from './routes.ts';

/**
 * Leituras que mostram nomes de categoria e subcategoria.
 */
const CATEGORY_NAMES: readonly ReadRoute[] = ['categories.tree', 'reports.byCategory', 'reports.categoryTransactions'];

/**
 * Leituras que carregam transações inteiras (com a subcategoria e as tags de cada uma);
 * mudam quando a exclusão de uma subcategoria move os lançamentos para outra ou quando a
 * exclusão de uma tag a tira dos lançamentos.
 */
const TRANSACTION_CONTENT: readonly ReadRoute[] = [
    'transactions.get',
    'transactions.listByPeriod',
    'statements.get',
    'invoices.get',
    'reports.categoryTransactions',
    'recurrences.occurrences',
    'goals.contributions',
];

/**
 * Ensaios do diálogo de revisão (database-design §4.12): cada um executa uma escrita
 * numa transação desfeita para mostrar o que ela faria. Ficam fora do mapa de propósito — não
 * são uma visão do estado a manter atualizada, e sim a prévia de uma intenção. Invalidados, a
 * própria escrita confirmada no diálogo fazia o plano ainda aberto ser ensaiado de novo sobre o
 * estado já gravado: a exclusão confirmada ensaiava excluir um id já excluído e o diálogo mostrava
 * o erro antes de fechar, e a criação ensaiava outra série inteira só para descartá-la. Para não
 * mostrar um plano velho ao reabrir, a consulta de um ensaio não fica no cache (`useCoreRehearsal`).
 */
export const REHEARSAL_ROUTES = ['recurrences.planCreate', 'recurrences.planUpdate', 'recurrences.planDelete'] as const satisfies readonly ReadRoute[];

/** Rota de leitura que ensaia uma escrita do diálogo de revisão. */
export type RehearsalRoute = (typeof REHEARSAL_ROUTES)[number];

/**
 * @param route Rota de leitura.
 * @return `true` quando ela é um ensaio, que nenhuma escrita invalida.
 */
export function isRehearsalRoute(route: ReadRoute): route is RehearsalRoute {
    return REHEARSAL_ROUTES.some((rehearsal) => rehearsal === route);
}

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
    // As contas de outros perfis mudam com o cadastro de contas (criar, renomear, desativar).
    'accounts.transferTargets',
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
    // O uso de cada tag (contagem, total, último uso) sai dos lançamentos.
    'tags.list',
    // O progresso de cada meta é a soma das transações vinculadas pagas (database-design §4.11):
    // lançar, pagar, excluir ou reabrir a fatura muda o que já conta.
    'goals.list',
    'goals.contributions',
    // As séries mudam com as escritas de transação (escopos, exclusão em cadeia) e a prévia
    // depende do ciclo do cartão. Os planos do diálogo de revisão ficam de fora (`REHEARSAL_ROUTES`).
    'recurrences.list',
    'recurrences.occurrences',
    'recurrences.preview',
];

/** Toda leitura do núcleo; para escritas que mudam o perfil (moeda) ou criam um perfil novo. */
const EVERYTHING: readonly ReadRoute[] = ['profiles.list', 'notes.list', ...MONEY];

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
    'tags.create': ['tags.list'],
    'tags.update': ['tags.list'],
    // Excluir a tag a tira dos lançamentos, que continuam existindo.
    'tags.delete': ['tags.list', ...TRANSACTION_CONTENT],
    // Anotação é uma lista à parte: não toca em dinheiro nem em cadastro.
    'notes.create': ['notes.list'],
    'notes.update': ['notes.list'],
    'notes.delete': ['notes.list'],
    // Criar e editar mudam só a meta: as transações vinculadas continuam as mesmas. As opções
    // do campo "Meta" só mudam aqui, e não com o dinheiro: por isso ficam fora do `MONEY`.
    'goals.create': ['goals.list', 'goals.options'],
    'goals.update': ['goals.list', 'goals.options'],
    // Excluir tira a meta dos lançamentos e das séries, que continuam existindo.
    'goals.delete': ['goals.list', 'goals.options', 'recurrences.list', ...TRANSACTION_CONTENT],
    'transactions.create': MONEY,
    'transactions.update': MONEY,
    'transactions.delete': MONEY,
    'transactions.setPaid': MONEY,
    // O complemento emite ocorrências: mexe em extratos, faturas e relatórios dos meses à frente.
    'recurrences.topUp': MONEY,
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
