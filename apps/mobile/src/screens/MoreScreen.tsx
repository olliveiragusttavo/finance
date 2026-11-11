import { formatProfileSummary, useGoals, useNotes } from '@finance/client';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useActiveProfile } from '../shell/ActiveProfile.tsx';
import { ProfileSheet } from '../shell/ProfileSheet.tsx';
import { ROUTES, type AppRoute } from '../shell/routes.ts';
import { Screen } from '../shell/Screen.tsx';
import { ScreenHeader } from '../shell/ScreenHeader.tsx';
import { useReferenceMonth } from '../shell/useReferenceMonth.ts';
import { AppText } from '../ui/AppText.tsx';
import { MenuGroup, MenuRow } from '../ui/menu.tsx';

/**
 * Menu Mais (mockup `MobileMais`): perfil com "Trocar perfil", Metas, Anotações, Cadastros,
 * Dispositivos e Ajustes. As contagens são das metas ativas e das anotações do perfil. Diverge
 * do mockup no rodapé e em Dispositivos, que dizem "Dados só neste aparelho": a sincronização
 * ainda não existe (mobile-mvp-plan §5.1), e dizer "sincronizado" seria falso.
 *
 * @return A tela.
 */
export function MoreScreen(): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const router = useRouter();
    const [profilesOpen, setProfilesOpen] = useState(false);
    const goals = useGoals({ profileId: profile.id, period });
    const notes = useNotes({ profileId: profile.id });
    const activeGoals = goals.data?.filter((goal) => !goal.archived).length;

    /**
     * @param route Tela a abrir, empilhada na aba Mais.
     * @return A ação do toque.
     */
    const open = (route: AppRoute) => (): void => {
        router.push(route);
    };

    return (
        <Screen header={<ScreenHeader title="Mais" />}>
            <MenuGroup>
                <MenuRow
                    first
                    label={profile.name}
                    detail={`Perfil ${formatProfileSummary(profile)}`}
                    trailing="Trocar perfil"
                    onPress={() => {
                        setProfilesOpen(true);
                    }}
                />
            </MenuGroup>
            <MenuGroup>
                <MenuRow first label="Metas" {...(activeGoals === undefined ? {} : { trailing: String(activeGoals) })} onPress={open(ROUTES.goals)} />
                <MenuRow label="Anotações" {...(notes.data === undefined ? {} : { trailing: String(notes.data.length) })} onPress={open(ROUTES.notes)} />
                <MenuRow label="Cadastros" onPress={open(ROUTES.registries)} />
            </MenuGroup>
            <MenuGroup>
                <MenuRow first label="Dispositivos e sincronização" detail="Dados só neste aparelho" onPress={open(ROUTES.devices)} />
                <MenuRow label="Ajustes" onPress={open(ROUTES.settings)} />
            </MenuGroup>
            <AppText className="text-12 text-muted">Relatórios detalhados ficam no app do computador.</AppText>
            <ProfileSheet
                open={profilesOpen}
                onClose={() => {
                    setProfilesOpen(false);
                }}
            />
        </Screen>
    );
}
