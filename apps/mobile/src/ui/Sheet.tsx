import { useEffect, useRef, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, KeyboardAvoidingView, Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './AppText.tsx';
import { Icon } from './Icon.tsx';

/** Duração da subida da folha, em ms: curta o bastante para não atrasar a escolha. */
const ENTER_MS = 220;

/**
 * Entrada da folha: sobe da borda de baixo, como as folhas do sistema, pela `Animated` do React
 * Native no driver nativo (não ocupa a thread JavaScript, onde o núcleo roda). Com "remover
 * animações" ligado no sistema, a folha aparece já no lugar.
 *
 * @param open Se a folha está aberta; a animação recomeça a cada abertura.
 * @param distance Quanto a folha sobe, em px: a altura da janela, para começar fora da tela.
 * @return O deslocamento vertical a aplicar na folha.
 */
function useSlideIn(open: boolean, distance: number): Animated.Value {
    const offset = useRef(new Animated.Value(distance)).current;
    useEffect(() => {
        if (!open) {
            return undefined;
        }
        let cancelled = false;
        offset.setValue(distance);
        void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
            if (cancelled) {
                return;
            }
            if (reduce) {
                offset.setValue(0);
            } else {
                Animated.timing(offset, { toValue: 0, duration: ENTER_MS, useNativeDriver: true }).start();
            }
        });
        return () => {
            cancelled = true;
        };
    }, [open, distance, offset]);
    return offset;
}

/**
 * Folha inferior do app (decisão de interface 12 dos mockups: "escolhas em folhas inferiores").
 * Controlada por `open`, como um diálogo do desktop: a tela decide quando abre, e a folha avisa
 * por `onClose` quando o usuário a fecha — no véu, no "Fechar" ou no "voltar" do Android, que
 * fecha a folha antes de sair da tela.
 *
 * Usa o `Modal` do React Native, e não o `@gorhom/bottom-sheet` previsto no plano: no aparelho, a
 * folha da biblioteca não aparecia, sem erro (mobile-mvp-plan, Fase 6). O `Modal` abre numa
 * janela própria, por cima de tudo, e mantém os contextos de quem abriu (núcleo, perfil, tema),
 * porque é renderizado no lugar e não num portal. Perde só o arrastar para fechar.
 *
 * @param props.open Se a folha está aberta.
 * @param props.onClose Pedido de fechar; quem abriu põe `open` em `false`.
 * @param props.title Título da folha, anunciado como cabeçalho.
 * @param props.children Conteúdo, montado só com a folha aberta.
 * @return A folha.
 */
export function Sheet({ open, onClose, title, children }: { readonly open: boolean; readonly onClose: () => void; readonly title: string; readonly children: ReactNode }): ReactNode {
    const insets = useSafeAreaInsets();
    const { height } = useWindowDimensions();
    const offset = useSlideIn(open, height);
    return (
        <Modal testID="sheet-modal" visible={open} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
            <View className="flex-1 justify-end">
                <Pressable accessibilityLabel="Fechar a folha" onPress={onClose} style={{ opacity: 0.4 }} className="absolute bottom-0 left-0 right-0 top-0 bg-scrim" />
                <KeyboardAvoidingView behavior="padding">
                    <Animated.View testID="bottom-sheet" accessibilityViewIsModal style={{ maxHeight: height * 0.9, transform: [{ translateY: offset }] }} className="rounded-t-18 bg-surface">
                        <View className="items-center pb-1 pt-2">
                            <View className="h-1 w-9 rounded-full bg-line" />
                        </View>
                        <View className="flex-row items-center justify-between gap-2 px-4 pb-2">
                            <AppText className="flex-1 text-17 font-semibold" accessibilityRole="header">{title}</AppText>
                            <Pressable accessibilityRole="button" accessibilityLabel="Fechar" onPress={onClose} className="h-11 w-11 items-center justify-center rounded-full active:bg-line2">
                                <Icon name="close" tone="muted" />
                            </Pressable>
                        </View>
                        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
                            <View className="gap-3 px-4">{children}</View>
                        </ScrollView>
                    </Animated.View>
                </KeyboardAvoidingView>
            </View>
        </Modal>
    );
}
