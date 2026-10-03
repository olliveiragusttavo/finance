import type { CoreInput, CoreRoute } from '@finance/core';

/**
 * Natureza de cada rota: leitura vira consulta em cache, escrita vira mutação que invalida
 * leituras. `satisfies Record<CoreRoute, …>` obriga a classificar toda rota nova do núcleo —
 * sem isso, uma rota esquecida não teria hook nem entraria no mapa de invalidação.
 */
const ROUTE_KINDS = {
    'profiles.list': 'read',
    'profiles.create': 'write',
    'profiles.update': 'write',
    'onboarding.start': 'write',
    'accounts.list': 'read',
    'accounts.create': 'write',
    'accounts.update': 'write',
    'accounts.disable': 'write',
    'accounts.enable': 'write',
    'accounts.deletionImpact': 'read',
    'accounts.delete': 'write',
    'creditCards.list': 'read',
    'creditCards.create': 'write',
    'creditCards.update': 'write',
    'creditCards.disable': 'write',
    'creditCards.enable': 'write',
    'creditCards.deletionImpact': 'read',
    'creditCards.delete': 'write',
    'categories.tree': 'read',
    'categories.create': 'write',
    'categories.update': 'write',
    'categories.delete': 'write',
    'subCategories.create': 'write',
    'subCategories.update': 'write',
    'subCategories.delete': 'write',
    'transactions.create': 'write',
    'transactions.update': 'write',
    'transactions.delete': 'write',
    'transactions.get': 'read',
    'transactions.listByPeriod': 'read',
    'transactions.setPaid': 'write',
    'statements.get': 'read',
    'balances.ofProfile': 'read',
    'balances.rebuildAccount': 'write',
    'invoices.suggest': 'read',
    'invoices.get': 'read',
    'invoices.listByCard': 'read',
    'invoices.pay': 'write',
    'invoices.reopen': 'write',
    'integrity.verifyBalances': 'read',
    'reports.monthSummary': 'read',
    'reports.balanceEvolution': 'read',
    'reports.byCategory': 'read',
    'reports.categoryTransactions': 'read',
    'reports.cardImpact': 'read',
} as const satisfies Record<CoreRoute, 'read' | 'write'>;

/** Rotas que só leem: viram `useQuery`. */
export type ReadRoute = { [R in CoreRoute]: (typeof ROUTE_KINDS)[R] extends 'read' ? R : never }[CoreRoute];

/** Rotas que escrevem: viram `useMutation` e invalidam leituras. */
export type WriteRoute = Exclude<CoreRoute, ReadRoute>;

/** Prefixo de toda chave de consulta do núcleo; trocar de perfil invalida tudo sob ele. */
export const CORE_QUERY_ROOT = 'core';

/**
 * Chave de consulta de uma leitura: `['core', rota, entrada]`. A rota vem antes da entrada
 * para que a invalidação por rota (`['core', rota]`) alcance todas as entradas de uma vez.
 *
 * @param route Rota de leitura.
 * @param input Entrada da consulta; faz parte da chave porque o mesmo extrato de outro mês
 * é outra consulta.
 * @return A chave da consulta.
 */
export function coreQueryKey<R extends ReadRoute>(route: R, input: CoreInput<R>): readonly [typeof CORE_QUERY_ROOT, R, CoreInput<R>] {
    return [CORE_QUERY_ROOT, route, input];
}

/**
 * @param route Rota de leitura.
 * @return O prefixo que casa com toda consulta da rota, qualquer que seja a entrada.
 */
export function coreRouteKey(route: ReadRoute): readonly [typeof CORE_QUERY_ROOT, ReadRoute] {
    return [CORE_QUERY_ROOT, route];
}

/**
 * @param route Qualquer rota do núcleo.
 * @return `true` quando é leitura; estreita o tipo para os testes que percorrem todas as rotas.
 */
export function isReadRoute(route: CoreRoute): route is ReadRoute {
    return ROUTE_KINDS[route] === 'read';
}

/** @return Todas as rotas do núcleo, na ordem do mapa — para os testes que percorrem o contrato. */
export function allRoutes(): readonly CoreRoute[] {
    return Object.keys(ROUTE_KINDS).filter((route): route is CoreRoute => Object.hasOwn(ROUTE_KINDS, route));
}
