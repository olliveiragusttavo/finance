import { Link, Outlet, useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ListPane, PaneLayout } from '@/components/PaneLayout';
import { cn } from '@/lib/cn';
import { useActiveProfile } from '@/shell/activeProfile';
import { visibleReports } from '@/shell/navigation';

/**
 * Página de Relatórios: a lista dos relatórios à esquerda e o relatório aberto à direita, como
 * Contas e Cartões. Diverge da decisão de interface 5 dos mockups (relatórios como subitens do
 * menu) a pedido do usuário: a lista vai receber os relatórios personalizados, e no menu cada um
 * empurraria os itens de baixo. É a rota de layout dos relatórios, então trocar de relatório não
 * remonta a lista.
 *
 * @return A lista de relatórios e o relatório da rota.
 */
export function ReportsLayout(): ReactNode {
    const pathname = useLocation({ select: (location) => location.pathname });
    const { profile } = useActiveProfile();
    return (
        <PaneLayout>
            <ListPane label="Lista de relatórios" width="w-95" header={<div className="px-5 pt-5 pb-3 text-20 font-semibold">Relatórios</div>}>
                <ul aria-label="Relatórios">
                    {visibleReports(profile.type).map((report) => {
                        const current = pathname === report.to;
                        return (
                            <li key={report.to}>
                                <Link
                                    to={report.to}
                                    aria-current={current ? 'page' : undefined}
                                    className={cn(
                                        'block border-t border-line2 px-5 py-3 text-14 text-ink hover:bg-surface2',
                                        current && 'bg-soft font-semibold shadow-[inset_3px_0_0_var(--color-accent)] hover:bg-soft',
                                    )}
                                >
                                    {report.label}
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            </ListPane>
            <Outlet />
        </PaneLayout>
    );
}
