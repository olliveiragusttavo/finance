import { categoryTransactionCount, filterCategories, formatCategoryCount, useCategoryTree, useCoreMutation } from '@finance/client';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { NameSheet } from '../registries/NameSheet.tsx';
import { useActiveProfile } from '../shell/ActiveProfile.tsx';
import { categoryRoute } from '../shell/routes.ts';
import { Screen } from '../shell/Screen.tsx';
import { ScreenHeader } from '../shell/ScreenHeader.tsx';
import { useThemeColor } from '../theme/ThemeRoot.tsx';
import { AppText } from '../ui/AppText.tsx';
import { FormGroup } from '../ui/form.tsx';
import { Icon } from '../ui/Icon.tsx';
import { IconButton } from '../ui/IconButton.tsx';
import { EmptyState, QueryView } from '../ui/states.tsx';

/**
 * @param count Quantidade.
 * @param singular Palavra para um.
 * @param plural Palavra para vários.
 * @return `1 lançamento`, `3 lançamentos`.
 */
function counted(count: number, singular: string, plural: string): string {
    return `${String(count)} ${count === 1 ? singular : plural}`;
}

/**
 * Categorias (mobile-mvp-plan, Fase 15; sem mockup no celular, a lista da tela do desktop — Fase
 * 13.12 — no modelo das telas mobile): a busca por categoria **ou** subcategoria
 * (`filterCategories`, sem acento e sem caixa), o resumo do que a lista mostra e, em cada linha,
 * quantas subcategorias e lançamentos a categoria tem. Tocar abre as subcategorias; o "+" cria
 * uma categoria e a abre, para que criar as subcategorias já esteja à mão. Fora do mês de
 * referência: nenhum número daqui depende do mês.
 *
 * @return A tela.
 */
export function CategoriesScreen(): ReactNode {
    const { profile } = useActiveProfile();
    const router = useRouter();
    const tree = useCategoryTree({ profileId: profile.id });
    const create = useCoreMutation('categories.create');
    const [query, setQuery] = useState('');
    const [creating, setCreating] = useState(false);
    const placeholder = useThemeColor('muted');

    const header = (
        <ScreenHeader
            title="Categorias"
            back
            actions={
                <IconButton
                    icon="plus"
                    label="Nova categoria"
                    onPress={() => {
                        setCreating(true);
                    }}
                />
            }
        />
    );

    return (
        <Screen header={header}>
            <View className="flex-row items-center gap-2 rounded-10 border border-line bg-surface px-3">
                <Icon name="search" tone="muted" />
                <TextInput accessibilityLabel="Buscar categoria ou subcategoria" placeholder="Buscar categoria ou subcategoria" placeholderTextColor={placeholder} value={query} onChangeText={setQuery} className="min-h-11 flex-1 font-sans text-15 text-ink" />
            </View>
            <QueryView query={tree} loadingLabel="Abrindo as categorias…">
                {(branches) => {
                    if (branches.length === 0) {
                        return <EmptyState title="Nenhuma categoria" body="Toque em + para criar a primeira categoria do perfil." />;
                    }
                    const visible = filterCategories(branches, query);
                    return (
                        <>
                            <AppText className="text-12 text-muted">{formatCategoryCount(visible)}</AppText>
                            {visible.length === 0 ? (
                                <EmptyState title="Nenhuma categoria encontrada" />
                            ) : (
                                <FormGroup>
                                    {visible.map((branch, index) => {
                                        const detail = `${counted(branch.subCategories.length, 'subcategoria', 'subcategorias')} · ${counted(categoryTransactionCount(branch), 'lançamento', 'lançamentos')}`;
                                        return (
                                            <Pressable
                                                key={branch.id}
                                                accessibilityRole="button"
                                                accessibilityLabel={`${branch.name}, ${detail}`}
                                                onPress={() => {
                                                    router.push(categoryRoute(branch.id));
                                                }}
                                                className={`min-h-15 flex-row items-center justify-between gap-3 px-3.5 py-2.5 active:bg-line2 ${index === 0 ? '' : 'border-t border-line2'}`}
                                            >
                                                <View className="min-w-0 flex-1">
                                                    <AppText numberOfLines={1}>{branch.name}</AppText>
                                                    <AppText className="text-12 text-muted">{detail}</AppText>
                                                </View>
                                                <AppText className="text-muted">›</AppText>
                                            </Pressable>
                                        );
                                    })}
                                </FormGroup>
                            )}
                        </>
                    );
                }}
            </QueryView>
            {creating && (
                <NameSheet
                    title="Nova categoria"
                    description="A categoria agrupa subcategorias nos relatórios; os lançamentos apontam para a subcategoria."
                    label="Nome da categoria"
                    fieldLabel="o nome da categoria"
                    initial=""
                    submitLabel="Criar categoria"
                    pending={create.isPending}
                    onSave={async (name) => {
                        const created = await create.mutateAsync({ profileId: profile.id, name });
                        router.push(categoryRoute(created.id));
                    }}
                    onClose={() => {
                        setCreating(false);
                    }}
                />
            )}
        </Screen>
    );
}
