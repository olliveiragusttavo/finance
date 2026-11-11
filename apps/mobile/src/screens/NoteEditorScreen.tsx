import { describeError, noteTitle, readNoteForm, reportRejection, useCoreMutation, useNotes } from '@finance/client';
import type { NoteResponse } from '@finance/core';
import { useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useActiveProfile } from '../shell/ActiveProfile.tsx';
import { NEW_NOTE } from '../shell/routes.ts';
import { Screen } from '../shell/Screen.tsx';
import { ScreenHeader } from '../shell/ScreenHeader.tsx';
import { useThemeColor } from '../theme/ThemeRoot.tsx';
import { AppText } from '../ui/AppText.tsx';
import { Button } from '../ui/Button.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { EmptyState, QueryView } from '../ui/states.tsx';

/**
 * Editor de uma anotação (mockup `MobileAnotacaoEditar`): o texto inteiro num campo só, "Salvar"
 * no cabeçalho e "Excluir" embaixo, numa existente.
 * Sair com alteração não salva — o "voltar" do cabeçalho ou do Android — pergunta antes se salva
 * ou descarta, como o desktop: o texto de uma anotação não está em nenhum outro lugar, e
 * descartá-lo em silêncio o perderia. A exclusão pede confirmação com o título, pelo mesmo motivo.
 *
 * @param props.note Anotação aberta, ou `null` para escrever uma nova.
 * @return O editor.
 */
function NoteEditor({ note }: { readonly note: NoteResponse | null }): ReactNode {
    const { profile } = useActiveProfile();
    const router = useRouter();
    const create = useCoreMutation('notes.create');
    const update = useCoreMutation('notes.update');
    const remove = useCoreMutation('notes.delete');
    const [saved, setSaved] = useState(note?.text ?? '');
    const [draft, setDraft] = useState(note?.text ?? '');
    const [error, setError] = useState<string | null>(null);
    const [askLeave, setAskLeave] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    // O "voltar" barrado espera aqui até o rascunho ficar salvo ou descartado.
    const pendingLeave = useRef<(() => void) | null>(null);
    const placeholder = useThemeColor('muted');
    const selection = useThemeColor('accent');
    const dirty = draft !== saved;

    const disablePrevention = usePreventRemove(dirty, ({ repeat }) => {
        pendingLeave.current = repeat;
        setAskLeave(true);
    });

    useEffect(() => {
        // Salvo ou descartado, o "voltar" que estava barrado segue — só depois do render em que
        // `dirty` virou falso, senão a prevenção ainda o barraria.
        if (!dirty && pendingLeave.current !== null) {
            const leave = pendingLeave.current;
            pendingLeave.current = null;
            leave();
        }
    }, [dirty]);

    /**
     * Valida e grava o rascunho; a anotação nova é criada.
     *
     * @return Promessa resolvida com `true` quando gravou, `false` quando o erro apareceu.
     */
    const save = async (): Promise<boolean> => {
        const read = readNoteForm(draft);
        if (!read.ok) {
            setError(read.error);
            return false;
        }
        setError(null);
        try {
            if (note === null) {
                await create.mutateAsync({ profileId: profile.id, text: read.text });
            } else {
                await update.mutateAsync({ id: note.id, text: read.text });
            }
            setDraft(read.text);
            setSaved(read.text);
            return true;
        } catch (rejection) {
            reportRejection(rejection, {}, () => undefined, setError);
            return false;
        }
    };

    /**
     * "Salvar" do cabeçalho: grava e volta à lista, como o link do mockup. Desliga a prevenção
     * antes de voltar, porque o render que a desligaria pelo `dirty` pode ainda não ter
     * acontecido quando a gravação responde.
     */
    const saveAndLeave = (): void => {
        void save().then((ok) => {
            if (ok) {
                disablePrevention();
                router.back();
            }
        });
    };

    const header = (
        <ScreenHeader
            title={note === null ? 'Nova anotação' : 'Anotação'}
            back
            actions={
                <Pressable accessibilityRole="button" onPress={saveAndLeave} disabled={create.isPending || update.isPending} className="min-h-11 justify-center rounded-10 px-3 active:bg-line2">
                    <AppText className="font-semibold text-accent">Salvar</AppText>
                </Pressable>
            }
        />
    );

    return (
        <Screen header={header}>
            <TextInput
                accessibilityLabel={error === null ? 'Texto da anotação' : `Texto da anotação. ${error}`}
                multiline
                textAlignVertical="top"
                placeholder={'Título na primeira linha\nO resto do texto embaixo'}
                placeholderTextColor={placeholder}
                selectionColor={selection}
                value={draft}
                onChangeText={setDraft}
                className={`min-h-60 rounded-12 border bg-surface p-3.5 font-sans text-15 text-ink ${error === null ? 'border-line' : 'border-danger'}`}
            />
            {error !== null && (
                <AppText accessibilityRole="alert" className="text-13 text-danger">
                    {error}
                </AppText>
            )}
            <View className="flex-row items-center justify-between">
                <AppText className="text-12 text-muted">A primeira linha vira o título</AppText>
                {note !== null && (
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                            setConfirmDelete(true);
                        }}
                        className="min-h-11 justify-center rounded-10 px-3 active:bg-line2"
                    >
                        <AppText className="text-danger">Excluir</AppText>
                    </Pressable>
                )}
            </View>
            {askLeave && (
                <Sheet
                    open
                    title="Salvar a anotação?"
                    onClose={() => {
                        pendingLeave.current = null;
                        setAskLeave(false);
                    }}
                >
                    <AppText className="text-ink2">A anotação tem alterações que ainda não foram salvas.</AppText>
                    <Button
                        label="Salvar"
                        busy={create.isPending || update.isPending}
                        onPress={() => {
                            void save().then((ok) => {
                                if (!ok) {
                                    pendingLeave.current = null;
                                }
                                setAskLeave(false);
                            });
                        }}
                    />
                    <Button
                        label="Descartar"
                        variant="danger"
                        onPress={() => {
                            setAskLeave(false);
                            setDraft(saved);
                        }}
                    />
                    <Button
                        label="Continuar editando"
                        variant="secondary"
                        onPress={() => {
                            pendingLeave.current = null;
                            setAskLeave(false);
                        }}
                    />
                </Sheet>
            )}
            {confirmDelete && note !== null && (
                <Sheet
                    open
                    title={`Excluir a anotação ${noteTitle(note)}?`}
                    onClose={() => {
                        setConfirmDelete(false);
                    }}
                >
                    <AppText className="text-ink2">A anotação não existe em outro lugar: excluí-la apaga o texto.</AppText>
                    {remove.error !== null && (
                        <AppText accessibilityRole="alert" className="text-13 text-danger">
                            {describeError(remove.error.error).message}
                        </AppText>
                    )}
                    <Button
                        label="Excluir anotação"
                        variant="danger"
                        busy={remove.isPending}
                        onPress={() => {
                            remove.mutateAsync({ id: note.id }).then(() => {
                                setConfirmDelete(false);
                                // O texto foi apagado de propósito: sair sem perguntar.
                                disablePrevention();
                                router.back();
                            }, () => undefined);
                        }}
                    />
                    <Button
                        label="Cancelar"
                        variant="secondary"
                        onPress={() => {
                            setConfirmDelete(false);
                        }}
                    />
                </Sheet>
            )}
        </Screen>
    );
}

/**
 * Rota do editor (mobile-mvp-plan, Fase 16): `new` escreve uma anotação nova; um id abre a
 * anotação, que vem da lista do perfil, já em cache.
 *
 * @return A tela.
 */
export function NoteEditorScreen(): ReactNode {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { profile } = useActiveProfile();
    const notes = useNotes(id === NEW_NOTE ? null : { profileId: profile.id });
    if (id === NEW_NOTE) {
        return <NoteEditor note={null} />;
    }
    const note = notes.data?.find((candidate) => candidate.id === id);
    if (note === undefined) {
        return (
            <Screen header={<ScreenHeader title="Anotação" back />}>
                <QueryView query={notes} loadingLabel="Abrindo a anotação…">
                    {() => <EmptyState title="Esta anotação não existe mais" body="Ela pode ter sido excluída." />}
                </QueryView>
            </Screen>
        );
    }
    return <NoteEditor key={note.id} note={note} />;
}
