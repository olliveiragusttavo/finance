import { createHashHistory, createRootRoute, createRoute, createRouter, Outlet, retainSearchParams } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AccountsScreen } from './accounts/AccountsScreen.tsx';
import { parseAccountsSearch, type AccountsSearch } from './accounts/accountsSearch.ts';
import { CardsScreen } from './cards/CardsScreen.tsx';
import { parseCardsSearch, type CardsSearch } from './cards/cardsSearch.ts';
import { RegistryScreen } from './registry/RegistryScreen.tsx';
import { parseRegistrySearch, type RegistrySearch } from './registry/registryKinds.ts';
import { blankScreen, PartnerReportScreen } from './screens/BlankScreen.tsx';
import { AppShell } from './shell/AppShell.tsx';
import type { AppPath } from './shell/navigation.ts';
import { parseShellSearch, type ShellSearch } from './shell/referenceMonth.ts';

/**
 * Raiz das rotas: o que vale para toda tela (avisos e dicas). O shell fica numa rota de
 * layout abaixo dela, para que uma tela fora do shell possa ser uma rota irmã. O primeiro uso
 * não é rota: abre antes do roteador, porque o roteador só monta com um perfil (`App.tsx`).
 *
 * @return O conteúdo da rota atual com os provedores de interface.
 */
function RootLayout(): ReactNode {
    return (
        <TooltipProvider>
            <Outlet />
            <Toaster />
        </TooltipProvider>
    );
}

const rootRoute = createRootRoute({ component: RootLayout });

/**
 * Rota de layout do shell, sem caminho próprio. É dona do *search param* `period` (mês de
 * referência): valida a URL e o preserva em toda navegação entre as telas do shell, para que
 * trocar de tela não volte ao mês corrente (desktop-mvp-plan Fase 4).
 */
const shellRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_shell',
    component: AppShell,
    validateSearch: (search: Record<string, unknown>): ShellSearch => parseShellSearch(search),
    search: { middlewares: [retainSearchParams<ShellSearch>(['period'])] },
});

/*
 * Telas do shell. Cada caminho é conferido contra `AppPath`, o tipo do menu, e cada item do
 * menu é um `Link` tipado pelas rotas registradas: caminho de menu sem rota não compila.
 */
const routeTree = rootRoute.addChildren([
    shellRoute.addChildren([
        // Telas do MVP, cada uma substituída na sua fase (desktop-mvp-plan §6).
        createRoute({ getParentRoute: () => shellRoute, path: '/' satisfies AppPath, component: blankScreen('Visão geral', false) }),
        createRoute({ getParentRoute: () => shellRoute, path: '/transactions' satisfies AppPath, component: blankScreen('Transações', false) }),
        createRoute({
            getParentRoute: () => shellRoute,
            path: '/accounts' satisfies AppPath,
            component: AccountsScreen,
            validateSearch: (search: Record<string, unknown>): AccountsSearch => parseAccountsSearch(search),
        }),
        createRoute({
            getParentRoute: () => shellRoute,
            path: '/cards' satisfies AppPath,
            component: CardsScreen,
            validateSearch: (search: Record<string, unknown>): CardsSearch => parseCardsSearch(search),
        }),
        createRoute({ getParentRoute: () => shellRoute, path: '/reports/category' satisfies AppPath, component: blankScreen('Relatório por categoria', false) }),
        createRoute({ getParentRoute: () => shellRoute, path: '/reports/card-impact' satisfies AppPath, component: blankScreen('Impacto do cartão', false) }),
        createRoute({
            getParentRoute: () => shellRoute,
            path: '/registry' satisfies AppPath,
            component: RegistryScreen,
            validateSearch: (search: Record<string, unknown>): RegistrySearch => parseRegistrySearch(search),
        }),
        createRoute({ getParentRoute: () => shellRoute, path: '/settings' satisfies AppPath, component: blankScreen('Ajustes', false) }),
        // Fora do MVP: tela em branco, com a rota e o mês já prontos (desktop-mvp-plan §5).
        createRoute({ getParentRoute: () => shellRoute, path: '/reports/account-flow' satisfies AppPath, component: blankScreen('Fluxo mensal por conta', true) }),
        createRoute({ getParentRoute: () => shellRoute, path: '/reports/partner' satisfies AppPath, component: PartnerReportScreen }),
        createRoute({ getParentRoute: () => shellRoute, path: '/reports/tag' satisfies AppPath, component: blankScreen('Relatório por tag', true) }),
        createRoute({ getParentRoute: () => shellRoute, path: '/goals' satisfies AppPath, component: blankScreen('Metas', true) }),
        createRoute({ getParentRoute: () => shellRoute, path: '/devices' satisfies AppPath, component: blankScreen('Dispositivos', true) }),
    ]),
]);

/**
 * Roteador do app. Histórico em hash porque o app empacotado é servido de `file://`, onde não
 * há servidor para responder a `/transactions` (desktop-mvp-plan §2); com hash, navegar nunca
 * troca o documento, e a trava de navegação do processo principal continua valendo.
 *
 * @return O roteador com a árvore de rotas.
 */
export function createAppRouter(): ReturnType<typeof createRouter<typeof routeTree>> {
    return createRouter({ routeTree, history: createHashHistory() });
}

declare module '@tanstack/react-router' {
    /** Registra as rotas para que `Link` e `useNavigate` sejam tipados pelo caminho. */
    interface Register {
        router: ReturnType<typeof createAppRouter>;
    }
}
