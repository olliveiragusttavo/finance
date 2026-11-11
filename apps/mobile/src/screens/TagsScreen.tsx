import { formatMoney, readNameForm, reportRejection, useCoreMutation, useTags } from '@finance/client';
import type { TagUsageResponse } from '@finance/core';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useActiveProfile } from '../shell/ActiveProfile.tsx';
import { Screen } from '../shell/Screen.tsx';
import { ScreenHeader } from '../shell/ScreenHeader.tsx';
import { AppText } from '../ui/AppText.tsx';
import { Button } from '../ui/Button.tsx';
import { FormGroup } from '../ui/form.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { EmptyState, QueryView } from '../ui/states.tsx';
import { TextField } from '../ui/TextField.tsx';

/** Nome do campo com artigo, para a frase do campo vazio. */
const TAG_NAME_LABEL = 'o nome da tag';

/**
 * @param count Lançamentos com a tag.
 * @return `1 lançamento`, `8 lançamentos`.
 */
function launches(count: number): string {
    return `${String(count)} ${count === 1 ? 'lançamento' : 'lançamentos'}`;
}

/**
 * "Nova tag" no topo, como no mockup: a tag é só um nome, e criá-la sem folha deixa cadastrar
 * várias seguidas. O nome repetido volta do núcleo como `CONFLICT` e aparece abaixo do campo.
 *
 * @return O campo e o botão.
 */
function NewTag(): ReactNode {
    const { profile } = useActiveProfile();
    const create = useCoreMutation('tags.create');
    const [name, setName] = useState('');
    const [error, setError] = useState<string | null>(null);

    /** Valida o nome com o campo das rotas e cria; o campo se esvazia para a próxima. */
    const submit = (): void => {
        const read = readNameForm(name, TAG_NAME_LABEL);
        if (!read.ok) {
            setError(read.error);
            return;
        }
        setError(null);
        create.mutateAsync({ profileId: profile.id, name: read.name }).then(
            () => {
                setName('');
            },
            (rejection: unknown) => {
                reportRejection(
                    rejection,
                    { name: 'name' },
                    (_field, message) => {
                        setError(message);
                    },
                    setError,
                );
            },
        );
    };

    return (
        <View className="gap-2">
            <TextField label="Nova tag" placeholder="Nova tag" maxLength={45} error={error} value={name} onChangeText={setName} onSubmitEditing={submit} returnKeyType="done" />
            <Button label="Adicionar" variant="secondary" busy={create.isPending} onPress={submit} />
        </View>
    );
}

/**
 * "Editar tag" numa folha, com o conteúdo do painel do desktop: o nome, o uso em números, salvar e
 * excluir. Sem o atalho "Ver lançamentos em Transações": os filtros de Transações do celular não
 * se abrem por link (mobile-mvp-plan, Fase 16).
 * Regra de negócio (Tags): excluir tira a tag dos lançamentos, que continuam existindo — o aviso
 * diz quantos, e por isso a exclusão não pede outra confirmação: nada além da etiqueta se perde.
 *
 * @param props.tag Tag aberta.
 * @param props.onClose Fecha a folha.
 * @return A folha.
 */
function TagSheet({ tag, onClose }: { readonly tag: TagUsageResponse; readonly onClose: () => void }): ReactNode {
    const rename = useCoreMutation('tags.update');
    const remove = useCoreMutation('tags.delete');
    const [name, setName] = useState(tag.name);
    const [error, setError] = useState<string | null>(null);

    /** Valida e grava o novo nome; a folha fecha quando grava. */
    const save = (): void => {
        const read = readNameForm(name, TAG_NAME_LABEL);
        if (!read.ok) {
            setError(read.error);
            return;
        }
        setError(null);
        rename.mutateAsync({ id: tag.id, name: read.name }).then(onClose, (rejection: unknown) => {
            reportRejection(
                rejection,
                { name: 'name' },
                (_field, message) => {
                    setError(message);
                },
                setError,
            );
        });
    };

    return (
        <Sheet open title="Editar tag" onClose={onClose}>
            <TextField label="Nome" hint="Até 45 caracteres. Não pode repetir outra tag do perfil, nem com maiúsculas diferentes." maxLength={45} error={error} value={name} onChangeText={setName} />
            <View className="flex-row gap-2.5">
                <View className="flex-1 rounded-10 border border-line2 p-3">
                    <AppText className="text-12 text-muted">Lançamentos</AppText>
                    <AppText className="text-18 font-semibold">{String(tag.transactionCount)}</AppText>
                </View>
                <View className="flex-1 rounded-10 border border-line2 p-3">
                    <AppText className="text-12 text-muted">Total</AppText>
                    <AppText className="text-18 font-semibold">{formatMoney(tag.total)}</AppText>
                </View>
            </View>
            <AppText className="rounded-8 bg-warn-bg px-3 py-2.5 text-13 text-warn-ink">
                {tag.transactionCount === 0
                    ? 'Nenhum lançamento usa esta tag; excluir só apaga o nome.'
                    : `Excluir remove a tag ${tag.transactionCount === 1 ? 'do lançamento' : `dos ${String(tag.transactionCount)} lançamentos`}. Os lançamentos continuam existindo.`}
            </AppText>
            <Button label="Salvar" busy={rename.isPending} onPress={save} />
            <Button
                label="Excluir tag"
                variant="danger"
                busy={remove.isPending}
                onPress={() => {
                    // `mutateAsync`: a tag sai da lista, a tela desmonta esta folha, e o retorno do
                    // `mutate` não viria.
                    remove.mutateAsync({ id: tag.id }).then(onClose, (rejection: unknown) => {
                        reportRejection(rejection, {}, () => undefined, setError);
                    });
                }}
            />
        </Sheet>
    );
}

/**
 * Tags (mockup `MobileTags`; mobile-mvp-plan, Fase 16): "Nova tag" no topo, a lista com quantos
 * lançamentos usam cada uma e "Editar tag" numa folha ao tocar. As tags se aplicam no lançamento.
 *
 * @return A tela.
 */
export function TagsScreen(): ReactNode {
    const { profile } = useActiveProfile();
    const tags = useTags({ profileId: profile.id });
    const [openId, setOpenId] = useState<string | null>(null);

    return (
        <Screen header={<ScreenHeader title="Tags" back />}>
            <NewTag />
            <QueryView query={tags} loadingLabel="Abrindo as tags…">
                {(list) => {
                    const open = list.find((tag) => tag.id === openId) ?? null;
                    return (
                        <>
                            {list.length === 0 ? (
                                <EmptyState title="Nenhuma tag" body="Crie uma tag acima para marcar lançamentos." />
                            ) : (
                                <FormGroup>
                                    {list.map((tag, index) => (
                                        <Pressable
                                            key={tag.id}
                                            accessibilityRole="button"
                                            accessibilityLabel={`${tag.name}, ${launches(tag.transactionCount)}`}
                                            onPress={() => {
                                                setOpenId(tag.id);
                                            }}
                                            className={`min-h-12.5 flex-row items-center justify-between gap-3 px-3.5 active:bg-line2 ${index === 0 ? '' : 'border-t border-line2'}`}
                                        >
                                            <View className="shrink rounded-full bg-track px-2.5 py-0.75">
                                                <AppText className="text-13" numberOfLines={1}>{tag.name}</AppText>
                                            </View>
                                            <AppText className="text-12 text-muted">{launches(tag.transactionCount)} ›</AppText>
                                        </Pressable>
                                    ))}
                                </FormGroup>
                            )}
                            {open !== null && (
                                <TagSheet
                                    key={open.id}
                                    tag={open}
                                    onClose={() => {
                                        setOpenId(null);
                                    }}
                                />
                            )}
                        </>
                    );
                }}
            </QueryView>
            <AppText className="text-12 text-muted">Tags são aplicadas no lançamento, em “Mais detalhes”.</AppText>
        </Screen>
    );
}
