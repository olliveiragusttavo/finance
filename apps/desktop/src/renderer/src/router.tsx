import { createHashHistory, createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HomeScreen } from './screens/HomeScreen.tsx';

/**
 * Raiz das rotas: o que vale para toda tela (avisos e dicas). O shell com menu e mês de
 * referência entra aqui na Fase 4.
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

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomeScreen });

/**
 * Roteador do app. Histórico em hash porque o app empacotado é servido de `file://`, onde não
 * há servidor para responder a `/transacoes` (desktop-mvp-plan §2); com hash, navegar nunca
 * troca o documento, e a trava de navegação do processo principal continua valendo.
 *
 * @return O roteador com a árvore de rotas.
 */
export function createAppRouter(): ReturnType<typeof createRouter<typeof routeTree>> {
    return createRouter({ routeTree, history: createHashHistory() });
}

const routeTree = rootRoute.addChildren([homeRoute]);

declare module '@tanstack/react-router' {
    /** Registra as rotas para que `Link` e `useNavigate` sejam tipados pelo caminho. */
    interface Register {
        router: ReturnType<typeof createAppRouter>;
    }
}
