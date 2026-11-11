import { formatProfileSummary } from '@finance/client';
import type { ProfileResponse } from '@finance/core';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { ProfileFormSheet } from '../registries/ProfileFormSheet.tsx';
import { useActiveProfile } from '../shell/ActiveProfile.tsx';
import { Screen } from '../shell/Screen.tsx';
import { ScreenHeader } from '../shell/ScreenHeader.tsx';
import { AppText } from '../ui/AppText.tsx';
import { FormGroup } from '../ui/form.tsx';
import { IconButton } from '../ui/IconButton.tsx';

/** Folha aberta na tela: criar ou editar um perfil. */
type ProfileSheetState = { readonly mode: 'create' } | { readonly mode: 'edit'; readonly profile: ProfileResponse };

/**
 * Perfis (mobile-mvp-plan, Fase 15; sem mockup no celular, as informações da tela do desktop no
 * modelo das telas mobile — §5.1): a lista com o perfil em uso marcado, "Abrir" nos outros e a
 * edição em folha ao tocar na linha. Não há exclusão no MVP — o núcleo não tem rota para ela, e
 * apagar um perfil apagaria todo o histórico dele. O perfil criado aparece na lista com "Abrir",
 * como a ação do aviso do desktop.
 *
 * @return A tela.
 */
export function ProfilesScreen(): ReactNode {
    const { profile: active, profiles, switchTo } = useActiveProfile();
    const [sheet, setSheet] = useState<ProfileSheetState | null>(null);
    const [created, setCreated] = useState<string | null>(null);
    /** Fecha a folha aberta. */
    const close = (): void => {
        setSheet(null);
    };

    const header = (
        <ScreenHeader
            title="Perfis"
            back
            actions={
                <IconButton
                    icon="plus"
                    label="Novo perfil"
                    onPress={() => {
                        setSheet({ mode: 'create' });
                    }}
                />
            }
        />
    );

    return (
        <Screen header={header}>
            <AppText className="text-13 text-muted">Cada perfil tem as próprias contas, cartões e categorias, numa moeda só.</AppText>
            {created !== null && (
                <AppText accessibilityRole="alert" className="text-13 text-ink2">
                    Perfil {created} criado.
                </AppText>
            )}
            <FormGroup>
                {profiles.map((profile, index) => {
                    const current = profile.id === active.id;
                    return (
                        <View key={profile.id} className={`min-h-15 flex-row items-center gap-2 pr-2 ${index === 0 ? '' : 'border-t border-line2'}`}>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={[`Editar ${profile.name}`, current ? 'em uso' : null, formatProfileSummary(profile)].filter((part) => part !== null).join(', ')}
                                onPress={() => {
                                    setSheet({ mode: 'edit', profile });
                                }}
                                className="min-w-0 flex-1 px-3.5 py-2.5 active:bg-line2"
                            >
                                <View className="flex-row items-center gap-2">
                                    <AppText className="shrink font-medium" numberOfLines={1}>{profile.name}</AppText>
                                    {current && (
                                        <View className="rounded-full bg-line2 px-2 py-0.5">
                                            <AppText className="text-12 text-ink2">Em uso</AppText>
                                        </View>
                                    )}
                                </View>
                                <AppText className="text-12 text-muted">{formatProfileSummary(profile)}</AppText>
                            </Pressable>
                            {!current && (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`Abrir ${profile.name}`}
                                    onPress={() => {
                                        switchTo(profile.id);
                                    }}
                                    className="min-h-11 justify-center rounded-10 border border-line px-3 active:bg-line2"
                                >
                                    <AppText className="text-13 text-accent">Abrir</AppText>
                                </Pressable>
                            )}
                        </View>
                    );
                })}
            </FormGroup>
            {sheet?.mode === 'create' && (
                <ProfileFormSheet
                    profile={null}
                    onClose={close}
                    onCreated={(profile) => {
                        setCreated(profile.name);
                    }}
                />
            )}
            {sheet?.mode === 'edit' && <ProfileFormSheet key={sheet.profile.id} profile={sheet.profile} onClose={close} />}
        </Screen>
    );
}
