import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../ui/AppText.tsx';
import { ThemeButton } from './ThemeButton.tsx';

/**
 * Cabeçalho das telas (`.hdr` dos mockups): título — ou o conteúdo de `left`, como o seletor de
 * perfil do Início —, as ações da tela e o botão de tema, que todo mockup tem. Telas empilhadas
 * dentro de uma aba ganham o "voltar", que faz o mesmo que o "voltar" do Android. Desce abaixo
 * da barra de status, que no Android 15+ fica por cima do app.
 *
 * @param props.title Título da tela; anunciado como cabeçalho.
 * @param props.left Substitui o título (o seletor de perfil do Início).
 * @param props.actions Botões da tela, antes do tema.
 * @param props.back Mostra o "voltar"; só nas telas empilhadas.
 * @return O cabeçalho.
 */
export function ScreenHeader(props: { readonly title?: string; readonly left?: ReactNode; readonly actions?: ReactNode; readonly back?: boolean }): ReactNode {
    const { title, left, actions, back = false } = props;
    const insets = useSafeAreaInsets();
    const router = useRouter();
    return (
        <View style={{ paddingTop: insets.top }} className="border-b border-line bg-surface">
            <View className="min-h-16.5 flex-row items-center justify-between gap-2 pb-2 pl-4 pr-3 pt-2.5">
                <View className="min-w-0 flex-1 flex-row items-center gap-1">
                    {back && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Voltar"
                            onPress={() => {
                                router.back();
                            }}
                            className="-ml-2 h-11 w-11 items-center justify-center rounded-full active:bg-line2"
                        >
                            <AppText className="text-22">‹</AppText>
                        </Pressable>
                    )}
                    {left ?? (
                        <AppText className="shrink text-20 font-semibold" accessibilityRole="header" numberOfLines={1}>{title}</AppText>
                    )}
                </View>
                <View className="flex-row items-center gap-2">
                    {actions}
                    <ThemeButton />
                </View>
            </View>
        </View>
    );
}
