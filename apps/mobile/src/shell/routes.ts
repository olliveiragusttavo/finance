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
    notes: '/more/notes',
    devices: '/more/devices',
    settings: '/more/settings',
    newTransaction: '/new-transaction',
} as const;

/** Um dos caminhos do app. */
export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];
