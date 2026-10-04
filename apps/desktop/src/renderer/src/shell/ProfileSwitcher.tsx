import { formatProfileSummary } from '@finance/client';
import { Link } from '@tanstack/react-router';
import { ChevronDownIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useActiveProfile } from './activeProfile.tsx';

/**
 * Seletor de perfil da barra lateral (mockups, todas as telas desktop). Mostra nome, tipo e
 * moeda porque é isso que muda o que a tela mostra; trocar o perfil invalida o cache inteiro
 * (`useActiveProfile`). Criar e renomear perfis fica em Cadastros, para onde o menu leva.
 *
 * @return O botão do perfil ativo com o menu dos demais.
 */
export function ProfileSwitcher(): ReactNode {
    const { profile, profiles, switchTo } = useActiveProfile();
    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                data-testid="profile-switcher"
                className="flex items-center justify-between rounded-8 border border-line bg-bg px-3 py-2.5 text-left text-14 outline-none focus-visible:ring-[3px] focus-visible:ring-accent/50"
            >
                <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-medium">{profile.name}</span>
                    <span className="text-12 text-muted">{formatProfileSummary(profile)}</span>
                </span>
                <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 text-muted" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
                <DropdownMenuLabel className="text-12 font-normal text-muted">Perfis</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={profile.id} onValueChange={switchTo}>
                    {profiles.map((option) => (
                        <DropdownMenuRadioItem key={option.id} value={option.id}>
                            <span className="flex min-w-0 flex-col">
                                <span className="truncate">{option.name}</span>
                                <span className="text-12 text-muted">{formatProfileSummary(option)}</span>
                            </span>
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                    <Link to="/registry">Gerenciar perfis</Link>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
