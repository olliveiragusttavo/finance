import { formatProfileSummary, formatProfileType } from '@finance/client';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable } from 'react-native';
import { AppText } from '../ui/AppText.tsx';
import { Button } from '../ui/Button.tsx';
import { OptionList } from '../ui/Select.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { useActiveProfile } from './ActiveProfile.tsx';
import { ROUTES } from './routes.ts';

/**
 * Folha de troca de perfil (mobile-mvp-plan, Fase 6): os perfis com tipo e moeda — o que muda o
 * que a tela mostra — e "Gerenciar perfis", que leva a Cadastros, onde perfis são criados e
 * renomeados, como o menu do seletor do desktop.
 *
 * @param props.open Se a folha está aberta.
 * @param props.onClose Fecha a folha.
 * @return A folha.
 */
export function ProfileSheet({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }): ReactNode {
    const { profile, profiles, switchTo } = useActiveProfile();
    const router = useRouter();
    return (
        <Sheet open={open} onClose={onClose} title="Perfis">
            <OptionList
                options={profiles.map((option) => ({ value: option.id, label: option.name, description: formatProfileSummary(option) }))}
                value={profile.id}
                onSelect={(profileId) => {
                    if (profileId !== profile.id) {
                        switchTo(profileId);
                    }
                    onClose();
                }}
            />
            <Button
                label="Gerenciar perfis"
                variant="ghost"
                onPress={() => {
                    onClose();
                    router.push(ROUTES.registries);
                }}
            />
        </Sheet>
    );
}

/**
 * Seletor de perfil do cabeçalho do Início (mockup `MobileInicio`): o nome e o tipo do perfil
 * aberto, numa pílula que abre a folha de perfis.
 *
 * @return O botão e a folha.
 */
export function ProfileButton(): ReactNode {
    const { profile } = useActiveProfile();
    const [open, setOpen] = useState(false);
    const summary = `${profile.name} · ${formatProfileType(profile.type)}`;
    return (
        <>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Perfil: ${summary}. Trocar perfil`}
                onPress={() => {
                    setOpen(true);
                }}
                className="min-h-11 max-w-72 flex-row items-center rounded-full border border-line bg-bg px-3.5 py-2 active:bg-line2"
            >
                <AppText className="shrink text-14 font-medium" numberOfLines={1}>{summary} ▾</AppText>
            </Pressable>
            <ProfileSheet
                open={open}
                onClose={() => {
                    setOpen(false);
                }}
            />
        </>
    );
}
