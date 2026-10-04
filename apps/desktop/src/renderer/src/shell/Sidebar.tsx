import { Link, useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useActiveProfile } from './activeProfile.tsx';
import { isItemActive, MENU, visibleChildren } from './navigation.ts';
import { ProfileSwitcher } from './ProfileSwitcher.tsx';

/**
 * Barra lateral do shell (mockups `Main` e `DesktopRelCategoria`): marca, seletor de perfil,
 * menu e rodapé. O rodapé diz só "Dados só neste aparelho" porque a sincronização está fora do
 * MVP (desktop-mvp-plan §1): o indicador verde do mockup prometeria uma cópia que não existe.
 *
 * @return A navegação principal.
 */
export function Sidebar(): ReactNode {
    const pathname = useLocation({ select: (location) => location.pathname });
    const { profile } = useActiveProfile();
    return (
        <nav aria-label="Navegação principal" className="flex h-full w-58 shrink-0 flex-col gap-5 overflow-y-auto border-r border-line bg-surface px-3.5 py-5">
            <div className="px-2 text-17 font-semibold">Finanças</div>
            <ProfileSwitcher />
            <ul className="flex flex-col gap-0.5 text-14">
                {MENU.map((item) => {
                    const active = isItemActive(item, pathname);
                    return (
                        <li key={item.to} className="flex flex-col gap-0.5">
                            <Link
                                to={item.to}
                                aria-current={active && item.children.length === 0 ? 'page' : undefined}
                                className={cn('rounded-6 px-3 py-2.25 text-ink hover:bg-surface2', active && 'bg-soft font-medium text-soft-ink hover:bg-soft')}
                            >
                                {item.label}
                            </Link>
                            {visibleChildren(item, pathname, profile.type).map((child) => {
                                const current = pathname === child.to;
                                return (
                                    <Link
                                        key={child.to}
                                        to={child.to}
                                        aria-current={current ? 'page' : undefined}
                                        className={cn(
                                            'rounded-6 py-1.5 pr-3 pl-6.5 text-13 text-ink2 hover:bg-surface2',
                                            current && 'font-semibold text-soft-ink shadow-[inset_2px_0_0_var(--color-accent)]',
                                        )}
                                    >
                                        {child.label}
                                    </Link>
                                );
                            })}
                        </li>
                    );
                })}
            </ul>
            <div className="mt-auto border-t border-line p-3 text-12 text-muted">Dados só neste aparelho</div>
        </nav>
    );
}
