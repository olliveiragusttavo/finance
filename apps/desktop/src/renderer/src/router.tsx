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
import { AccountFlowScreen } from './reports/AccountFlowScreen.tsx';
import { parseAccountFlowSearch, type AccountFlowSearch } from './reports/accountFlowSearch.ts';
import { CardImpactScreen } from './reports/CardImpactScreen.tsx';
import { CategoryReportScreen } from './reports/CategoryReportScreen.tsx';
import { parseCategoryReportSearch, type CategoryReportSearch } from './reports/categoryReportSearch.ts';
import { PartnerReportScreen } from './reports/PartnerReportScreen.tsx';
import { ReportsLayout } from './reports/ReportsLayout.tsx';
import { TagReportScreen } from './reports/TagReportScreen.tsx';
import { parseTagReportSearch, type TagReportSearch } from './reports/tagReportSearch.ts';
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

/**
 * Rota de layout dos relatórios, sem caminho próprio: desenha a lista de relatórios à esquerda
 * (`ReportsLayout`) e o relatório aberto à direita, para que trocar de relatório mantenha a lista
 * montada. Sem caminho para que cada relatório continue com o caminho de `AppPath`.
 */
const reportsRoute = createRoute({ getParentRoute: () => shellRoute, id: '_reports', component: ReportsLayout });

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
        reportsRoute.addChildren([
            createRoute({
                getParentRoute: () => reportsRoute,
                path: '/reports/category' satisfies AppPath,
                component: CategoryReportScreen,
                validateSearch: (search: Record<string, unknown>): CategoryReportSearch => parseCategoryReportSearch(search),
            }),
            createRoute({
                getParentRoute: () => reportsRoute,
                path: '/reports/account-flow' satisfies AppPath,
                component: AccountFlowScreen,
                validateSearch: (search: Record<string, unknown>): AccountFlowSearch => parseAccountFlowSearch(search),
            }),
            createRoute({ getParentRoute: () => reportsRoute, path: '/reports/card-impact' satisfies AppPath, component: CardImpactScreen }),
            createRoute({ getParentRoute: () => reportsRoute, path: '/reports/partner' satisfies AppPath, component: PartnerReportScreen }),
            createRoute({
                getParentRoute: () => reportsRoute,
                path: '/reports/tag' satisfies AppPath,
                component: TagReportScreen,
                validateSearch: (search: Record<string, unknown>): TagReportSearch => parseTagReportSearch(search),
            }),
        ]),
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
