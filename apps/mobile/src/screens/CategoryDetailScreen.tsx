import { categoryTransactionCount, readNameForm, reportRejection, useCategoryTree, useCoreMutation, type CategoryDeletionTarget } from '@finance/client';
import type { CategoryBranchResponse, SubCategoryUsageResponse } from '@finance/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { CategoryDeletionSheet } from '../registries/CategoryDeletionSheet.tsx';
import { NameSheet } from '../registries/NameSheet.tsx';
import { useActiveProfile } from '../shell/ActiveProfile.tsx';
import { ROUTES } from '../shell/routes.ts';
import { Screen } from '../shell/Screen.tsx';
import { ScreenHeader } from '../shell/ScreenHeader.tsx';
import { AppText } from '../ui/AppText.tsx';
import { Button } from '../ui/Button.tsx';
import { FormGroup, FormSection } from '../ui/form.tsx';
import { IconButton } from '../ui/IconButton.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { EmptyState, QueryView } from '../ui/states.tsx';
import { TextField } from '../ui/TextField.tsx';

/** Rótulo do campo do nome da subcategoria, com artigo, para a frase do campo vazio. */
const SUB_CATEGORY_NAME_LABEL = 'o nome da subcategoria';

/** Folha aberta no detalhe. */
type CategorySheet =
    | { readonly mode: 'actions' }
    | { readonly mode: 'rename' }
    | { readonly mode: 'subActions'; readonly subCategory: SubCategoryUsageResponse }
    | { readonly mode: 'renameSub'; readonly subCategory: SubCategoryUsageResponse }
    | { readonly mode: 'delete'; readonly target: CategoryDeletionTarget };

/**
 * "Nova subcategoria" no fim da lista, como a última linha da tabela do desktop: a subcategoria é
 * só um nome, e criá-la sem folha deixa cadastrar várias seguidas. O nome repetido volta do
 * núcleo como `CONFLICT` e aparece abaixo do campo.
 *
 * @param props.category Categoria que recebe a subcategoria.
 * @return O campo e o botão.
 */
function NewSubCategory({ category }: { readonly category: CategoryBranchResponse }): ReactNode {
    const create = useCoreMutation('subCategories.create');
    const [name, setName] = useState('');
    const [error, setError] = useState<string | null>(null);

    /** Valida o nome com o campo das rotas e cria; o campo se esvazia para a próxima. */
    const submit = (): void => {
        const read = readNameForm(name, SUB_CATEGORY_NAME_LABEL);
        if (!read.ok) {
            setError(read.error);
            return;
        }
        setError(null);
        create.mutateAsync({ categoryId: category.id, name: read.name }).then(
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
            <TextField label={`Nova subcategoria em ${category.name}`} error={error} value={name} onChangeText={setName} onSubmitEditing={submit} returnKeyType="done" />
            <Button label="Adicionar subcategoria" variant="secondary" busy={create.isPending} onPress={submit} />
        </View>
    );
}

/**
 * Detalhe da categoria (mobile-mvp-plan, Fase 15; as informações do detalhe do desktop, Fase
 * 13.12, no modelo das telas mobile): quantas subcategorias e lançamentos tem, as subcategorias
 * com a contagem de lançamentos e a criação no fim. Renomear e excluir a categoria ficam no "⋯";
 * tocar numa subcategoria abre renomear e excluir dela.
 * Regra de negócio (Categorias): nomes são únicos no perfil, sem diferenciar maiúsculas, e
 * excluir com lançamentos pede para onde movê-los (`CategoryDeletionSheet`). Sem "mover
 * subcategoria para outra categoria", como no desktop: o núcleo não move.
 *
 * @return A tela.
 */
export function CategoryDetailScreen(): ReactNode {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { profile } = useActiveProfile();
    const router = useRouter();
    const tree = useCategoryTree({ profileId: profile.id });
    const renameCategory = useCoreMutation('categories.update');
    const renameSubCategory = useCoreMutation('subCategories.update');
    const [sheet, setSheet] = useState<CategorySheet | null>(null);
    const category = tree.data?.find((branch) => branch.id === id);

    if (category === undefined || tree.data === undefined) {
        return (
            <Screen header={<ScreenHeader title="Categoria" back />}>
                <QueryView query={tree} loadingLabel="Abrindo a categoria…">
                    {() => <EmptyState title="Esta categoria não existe mais" body="Ela pode ter sido excluída." />}
                </QueryView>
            </Screen>
        );
    }

    const branches = tree.data;
    /** Fecha a folha aberta. */
    const close = (): void => {
        setSheet(null);
    };

    const header = (
        <ScreenHeader
            back
            left={
                <View className="min-w-0 flex-1">
                    <AppText accessibilityRole="header" className="text-17 font-semibold" numberOfLines={1}>{category.name}</AppText>
                    <AppText className="text-12 text-muted">Categoria</AppText>
                </View>
            }
            actions={
                <IconButton
                    icon="more"
                    label="Ações da categoria"
                    onPress={() => {
                        setSheet({ mode: 'actions' });
                    }}
                />
            }
        />
    );

    return (
        <Screen header={header}>
            <View className="flex-row gap-3 rounded-12 border border-line bg-surface p-3.5">
                <View className="flex-1">
                    <AppText className="text-12 text-muted">Subcategorias</AppText>
                    <AppText className="text-20 font-semibold">{String(category.subCategories.length)}</AppText>
                </View>
                <View className="flex-1 items-end">
                    <AppText className="text-12 text-muted">Lançamentos (todo o período)</AppText>
                    <AppText className="text-20 font-semibold">{String(categoryTransactionCount(category))}</AppText>
                </View>
            </View>
            <View className="gap-1.5">
                <FormSection>Subcategorias</FormSection>
                {category.subCategories.length === 0 ? (
                    <EmptyState title="Nenhuma subcategoria" body="Os lançamentos apontam para uma subcategoria; crie a primeira abaixo." />
                ) : (
                    <FormGroup>
                        {category.subCategories.map((subCategory, index) => (
                            <Pressable
                                key={subCategory.id}
                                accessibilityRole="button"
                                accessibilityLabel={`${subCategory.name}, ${String(subCategory.transactionCount)} ${subCategory.transactionCount === 1 ? 'lançamento' : 'lançamentos'}`}
                                onPress={() => {
                                    setSheet({ mode: 'subActions', subCategory });
                                }}
                                className={`min-h-12.5 flex-row items-center justify-between gap-3 px-3.5 active:bg-line2 ${index === 0 ? '' : 'border-t border-line2'}`}
                            >
                                <AppText className="min-w-0 flex-1" numberOfLines={1}>{subCategory.name}</AppText>
                                <AppText className="text-muted">{String(subCategory.transactionCount)}</AppText>
                            </Pressable>
                        ))}
                    </FormGroup>
                )}
            </View>
            <NewSubCategory category={category} />
            <AppText className="rounded-8 bg-soft px-3 py-2.5 text-13 text-soft-ink">
                Nomes são únicos no perfil, sem diferenciar maiúsculas. Excluir uma subcategoria com lançamentos pede para escolher outra subcategoria para recebê-los.
            </AppText>
            {sheet?.mode === 'actions' && (
                <Sheet open title={category.name} onClose={close}>
                    <Button
                        label="Renomear"
                        variant="secondary"
                        onPress={() => {
                            setSheet({ mode: 'rename' });
                        }}
                    />
                    <Button
                        label="Excluir categoria…"
                        variant="danger"
                        onPress={() => {
                            setSheet({ mode: 'delete', target: { kind: 'category', category } });
                        }}
                    />
                </Sheet>
            )}
            {sheet?.mode === 'rename' && (
                <NameSheet
                    title={`Renomear ${category.name}`}
                    description="A categoria agrupa subcategorias nos relatórios; os lançamentos apontam para a subcategoria."
                    label="Nome da categoria"
                    fieldLabel="o nome da categoria"
                    initial={category.name}
                    submitLabel="Salvar"
                    pending={renameCategory.isPending}
                    onSave={(name) => renameCategory.mutateAsync({ id: category.id, name })}
                    onClose={close}
                />
            )}
            {sheet?.mode === 'subActions' && (
                <Sheet open title={sheet.subCategory.name} onClose={close}>
                    <Button
                        label="Renomear"
                        variant="secondary"
                        onPress={() => {
                            setSheet({ mode: 'renameSub', subCategory: sheet.subCategory });
                        }}
                    />
                    <Button
                        label="Excluir subcategoria…"
                        variant="danger"
                        onPress={() => {
                            setSheet({ mode: 'delete', target: { kind: 'subCategory', category, subCategory: sheet.subCategory } });
                        }}
                    />
                </Sheet>
            )}
            {sheet?.mode === 'renameSub' && (
                <NameSheet
                    title={`Renomear ${sheet.subCategory.name}`}
                    description="Renomear não muda os lançamentos: eles continuam na mesma subcategoria."
                    label="Nome da subcategoria"
                    fieldLabel={SUB_CATEGORY_NAME_LABEL}
                    initial={sheet.subCategory.name}
                    submitLabel="Salvar"
                    pending={renameSubCategory.isPending}
                    onSave={(name) => renameSubCategory.mutateAsync({ id: sheet.subCategory.id, name })}
                    onClose={close}
                />
            )}
            {sheet?.mode === 'delete' && (
                <CategoryDeletionSheet
                    tree={branches}
                    target={sheet.target}
                    onClose={close}
                    onDeleted={() => {
                        close();
                        if (sheet.target.kind === 'category') {
                            if (router.canGoBack()) {
                                router.back();
                            } else {
                                router.replace(ROUTES.categories);
                            }
                        }
                    }}
                />
            )}
        </Screen>
    );
}
