import { Outlet, useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { showsReferenceMonth } from './navigation.ts';
import type { ShortcutAction } from './shortcuts.ts';
import { Sidebar } from './Sidebar.tsx';
import { TopBar } from './TopBar.tsx';
import { TransactionPanelProvider, useTransactionPanel } from './TransactionPanel.tsx';
import { useGlobalShortcuts } from './useGlobalShortcuts.ts';
import { useReferenceMonth } from './useReferenceMonth.ts';

/**
 * Shell do desktop (desktop-mvp-plan Fase 4; brief D1): barra lateral fixa à esquerda e, à
 * direita, a barra superior presa ao topo sobre a tela da rota. Só a área de conteúdo rola,
 * para que menu e mês de referência fiquem sempre à mão em tabelas longas.
 *
 * @return O layout com a tela da rota atual.
 */
export function AppShell(): ReactNode {
    return (
        <TransactionPanelProvider>
            <ShellLayout />
        </TransactionPanelProvider>
    );
}

/**
 * O layout em si, abaixo do provedor do painel para poder abri-lo pelo atalho.
 *
 * @return A barra lateral, a barra superior e a tela da rota.
 */
function ShellLayout(): ReactNode {
    const pathname = useLocation({ select: (location) => location.pathname });
    const showMonth = showsReferenceMonth(pathname);
    const month = useReferenceMonth();
    const panel = useTransactionPanel();

    useGlobalShortcuts({ referenceMonthVisible: showMonth }, (action: ShortcutAction) => {
        switch (action) {
            case 'newTransaction':
                panel.openNew();
                return;
            case 'previousMonth':
                month.previous();
                return;
            case 'nextMonth':
                month.next();
                return;
        }
    });

    return (
        <div className="flex h-full">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
                <TopBar showMonth={showMonth} />
                <main className="flex flex-col gap-5 px-8 py-6">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
