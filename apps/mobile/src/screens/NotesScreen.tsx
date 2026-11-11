import { filterNotes, summarizeNote, useNotes } from '@finance/client';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useActiveProfile } from '../shell/ActiveProfile.tsx';
import { NEW_NOTE, noteRoute } from '../shell/routes.ts';
import { Screen } from '../shell/Screen.tsx';
import { ScreenHeader } from '../shell/ScreenHeader.tsx';
import { useThemeColor } from '../theme/ThemeRoot.tsx';
import { AppText } from '../ui/AppText.tsx';
import { Icon } from '../ui/Icon.tsx';
import { IconButton } from '../ui/IconButton.tsx';
import { EmptyState, QueryView } from '../ui/states.tsx';

/**
 * Anotações (mockup `MobileAnotacoes`; mobile-mvp-plan, Fase 16): a busca no texto inteiro
 * (`filterNotes`, sem acento e sem caixa) e cada anotação como um cartão com o título e a prévia.
 * Regra de interface (mockups, decisão 9): anotação é texto livre, e a primeira linha é o título
 * (`summarizeNote`). Tocar abre o editor; o "+" abre o editor vazio.
 *
 * @return A tela.
 */
export function NotesScreen(): ReactNode {
    const { profile } = useActiveProfile();
    const router = useRouter();
    const notes = useNotes({ profileId: profile.id });
    const [query, setQuery] = useState('');
    const placeholder = useThemeColor('muted');

    const header = (
        <ScreenHeader
            title="Anotações"
            back
            actions={
                <IconButton
                    icon="plus"
                    label="Nova anotação"
                    onPress={() => {
                        router.push(noteRoute(NEW_NOTE));
                    }}
                />
            }
        />
    );

    return (
        <Screen header={header}>
            <View className="flex-row items-center gap-2 rounded-10 border border-line bg-surface px-3">
                <Icon name="search" tone="muted" />
                <TextInput accessibilityLabel="Buscar anotações" placeholder="Buscar" placeholderTextColor={placeholder} value={query} onChangeText={setQuery} className="min-h-11 flex-1 font-sans text-15 text-ink" />
            </View>
            <QueryView query={notes} loadingLabel="Abrindo as anotações…">
                {(list) => {
                    if (list.length === 0) {
                        return <EmptyState title="Nenhuma anotação" body="Toque em + para escrever a primeira." />;
                    }
                    const visible = filterNotes(list, query);
                    if (visible.length === 0) {
                        return <EmptyState title="Nenhuma anotação encontrada" />;
                    }
                    return visible.map((note) => {
                        const { title, preview } = summarizeNote(note.text);
                        return (
                            <Pressable
                                key={note.id}
                                accessibilityRole="button"
                                accessibilityLabel={preview === '' ? title : `${title}, ${preview}`}
                                onPress={() => {
                                    router.push(noteRoute(note.id));
                                }}
                                className="gap-1 rounded-12 border border-line bg-surface p-3.5 active:bg-line2"
                            >
                                <AppText className="font-semibold" numberOfLines={1}>{title}</AppText>
                                {preview !== '' && (
                                    <AppText className="text-13 text-ink2" numberOfLines={2}>
                                        {preview}
                                    </AppText>
                                )}
                            </Pressable>
                        );
                    });
                }}
            </QueryView>
            <AppText className="text-12 text-muted">Observações e lembretes deste perfil.</AppText>
        </Screen>
    );
}
