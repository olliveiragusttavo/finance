import { createHashHistory, createRootRoute, createRoute, createRouter, Outlet, retainSearchParams } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AccountsScreen } from './accounts/AccountsScreen.tsx';
import { parseAccountsSearch, type AccountsSearch } from './accounts/accountsSearch.ts';
import { CardsScreen } from './cards/CardsScreen.tsx';
import { parseCardsSearch, type CardsSearch } from './cards/cardsSearch.ts';
import { CategoriesScreen } from './categories/CategoriesScreen.tsx';
import { parseCategoriesSearch, type CategoriesSearch } from './categories/categoriesSearch.ts';
import { GoalsScreen } from './goals/GoalsScreen.tsx';
import { OverviewScreen } from './overview/OverviewScreen.tsx';
import { parseGoalsSearch, type GoalsSearch } from './goals/goalsSearch.ts';
import { NotesScreen } from './notes/NotesScreen.tsx';
import { parseNotesSearch, type NotesSearch } from './notes/notesSearch.ts';
import { PartnersScreen } from './partners/PartnersScreen.tsx';
import { ProfilesScreen } from './profiles/ProfilesScreen.tsx';
import { ReportEditorScreen } from './reports/ReportEditorScreen.tsx';
import { ReportsScreen } from './reports/ReportsScreen.tsx';
import { parseReportsSearch, type ReportsSearch } from './reports/reportsSearch.ts';
import { blankScreen } from './screens/BlankScreen.tsx';
import { ImportScreen } from './import/ImportScreen.tsx';
import { SettingsScreen } from './settings/SettingsScreen.tsx';
import { AppShell } from './shell/AppShell.tsx';
import { TagsScreen } from './tags/TagsScreen.tsx';
import { TransactionsScreen } from './transactions/TransactionsScreen.tsx';
import { parseTransactionsSearch, type TransactionsSearch } from './transactions/transactionsSearch.ts';
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
        // Telas do MVP (desktop-mvp-plan §6).
        createRoute({ getParentRoute: () => shellRoute, path: '/' satisfies AppPath, component: OverviewScreen }),
        createRoute({
            getParentRoute: () => shellRoute,
            path: '/transactions' satisfies AppPath,
            component: TransactionsScreen,
            validateSearch: (search: Record<string, unknown>): TransactionsSearch => parseTransactionsSearch(search),
        }),
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
        // Relatórios personalizados (reports-design, Fase 15): a lista com o aberto e o editor.
        createRoute({
            getParentRoute: () => shellRoute,
            path: '/reports' satisfies AppPath,
            component: ReportsScreen,
            validateSearch: (search: Record<string, unknown>): ReportsSearch => parseReportsSearch(search),
        }),
        createRoute({
            getParentRoute: () => shellRoute,
            path: '/reports/edit' satisfies AppPath,
            component: ReportEditorScreen,
            validateSearch: (search: Record<string, unknown>): ReportsSearch => parseReportsSearch(search),
        }),
        createRoute({
            getParentRoute: () => shellRoute,
            path: '/goals' satisfies AppPath,
            component: GoalsScreen,
            validateSearch: (search: Record<string, unknown>): GoalsSearch => parseGoalsSearch(search),
        }),
        // Cadastros, cada um com item próprio no menu (desktop-mvp-plan Fase 13.11).
        createRoute({
            getParentRoute: () => shellRoute,
            path: '/categories' satisfies AppPath,
            component: CategoriesScreen,
            validateSearch: (search: Record<string, unknown>): CategoriesSearch => parseCategoriesSearch(search),
        }),
        createRoute({ getParentRoute: () => shellRoute, path: '/partners' satisfies AppPath, component: PartnersScreen }),
        createRoute({ getParentRoute: () => shellRoute, path: '/tags' satisfies AppPath, component: TagsScreen }),
        createRoute({
            getParentRoute: () => shellRoute,
            path: '/notes' satisfies AppPath,
            component: NotesScreen,
            validateSearch: (search: Record<string, unknown>): NotesSearch => parseNotesSearch(search),
        }),
        createRoute({ getParentRoute: () => shellRoute, path: '/profiles' satisfies AppPath, component: ProfilesScreen }),
        createRoute({ getParentRoute: () => shellRoute, path: '/settings' satisfies AppPath, component: SettingsScreen }),
        createRoute({ getParentRoute: () => shellRoute, path: '/settings/import' satisfies AppPath, component: ImportScreen }),
        // Fora do MVP: tela em branco, com a rota e o mês já prontos (desktop-mvp-plan §5).
        createRoute({ getParentRoute: () => shellRoute, path: '/devices' satisfies AppPath, component: blankScreen('Dispositivos') }),
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
