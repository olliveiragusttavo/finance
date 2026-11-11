import {
    BottomSheetBackdrop,
    BottomSheetModal,
    BottomSheetScrollView,
    type BottomSheetBackdropProps,
    type BottomSheetBackgroundProps,
} from '@gorhom/bottom-sheet';
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { BackHandler, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColor } from '../theme/ThemeRoot.tsx';
import { AppText } from './AppText.tsx';
import { Icon } from './Icon.tsx';

/**
 * Se o componente está dentro de uma folha. O campo de texto lê isto para usar a entrada da
 * própria folha, que sobe junto com o teclado; a entrada comum ficaria escondida atrás dele.
 */
const InSheetContext = createContext(false);

/** @return `true` dentro de uma `Sheet`. */
export function useInSheet(): boolean {
    return useContext(InSheetContext);
}

/**
 * Fundo da folha com o token `surface` e os cantos de cima arredondados, pela classe, para seguir
 * o tema como o resto da tela.
 *
 * @param props.style Posição e tamanho que a folha calcula.
 * @return O fundo.
 */
function SheetBackground({ style }: BottomSheetBackgroundProps): ReactNode {
    return <View style={style} className="rounded-t-18 bg-surface" />;
}

/**
 * Alça da folha: a barra que indica que ela pode ser arrastada para baixo.
 *
 * @return A alça.
 */
function SheetHandle(): ReactNode {
    return (
        <View className="items-center pb-1 pt-2">
            <View className="h-1 w-9 rounded-full bg-line" />
        </View>
    );
}

/**
 * Véu atrás da folha, no token `scrim`; tocar nele fecha a folha.
 *
 * @param props Posição e animação que a folha calcula.
 * @return O véu.
 */
function SheetBackdrop(props: BottomSheetBackdropProps): ReactNode {
    const scrim = useThemeColor('scrim');
    return <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.4} pressBehavior="close" style={[props.style, { backgroundColor: scrim }]} />;
}

/**
 * Folha inferior do app (decisão de interface 12 dos mockups: "escolhas em folhas inferiores"),
 * sobre o `@gorhom/bottom-sheet` (mobile-mvp-plan §2). Controlada por `open`, como um diálogo do
 * desktop: a tela decide quando abre, e a folha avisa por `onClose` quando o usuário a fecha —
 * arrastando, tocando no véu, no "Fechar" ou no "voltar" do Android, que fecha a folha antes de
 * sair da tela. A altura acompanha o conteúdo, e a animação segue o "remover animações" do
 * sistema: sem `overrideReduceMotion`, a folha anima com o `ReduceMotion.System` do Reanimated.
 * A folha é desenhada no hospedeiro do `AppShell`, e não no lugar da tela: o conteúdo só enxerga
 * os contextos acima dele (núcleo, cache, preferências, perfil ativo) e o roteador global.
 *
 * @param props.open Se a folha está aberta.
 * @param props.onClose Pedido de fechar; quem abriu põe `open` em `false`.
 * @param props.title Título da folha, anunciado como cabeçalho.
 * @param props.children Conteúdo, montado só com a folha aberta.
 * @return A folha.
 */
export function Sheet({ open, onClose, title, children }: { readonly open: boolean; readonly onClose: () => void; readonly title: string; readonly children: ReactNode }): ReactNode {
    const ref = useRef<BottomSheetModal>(null);
    const insets = useSafeAreaInsets();
    // Em ref para o `onDismiss` saber se a folha fechou por gesto (avisar quem abriu) ou porque
    // quem abriu já pôs `open` em `false` (não avisar de novo).
    const openRef = useRef(open);
    const onCloseRef = useRef(onClose);
    openRef.current = open;
    onCloseRef.current = onClose;

    useEffect(() => {
        if (open) {
            ref.current?.present();
            const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
                onCloseRef.current();
                return true;
            });
            return () => {
                subscription.remove();
            };
        }
        ref.current?.dismiss();
        return undefined;
    }, [open]);

    return (
        <BottomSheetModal
            ref={ref}
            enableDynamicSizing
            keyboardBehavior="interactive"
            keyboardBlurBehavior="restore"
            android_keyboardInputMode="adjustResize"
            backgroundComponent={SheetBackground}
            handleComponent={SheetHandle}
            backdropComponent={SheetBackdrop}
            onDismiss={() => {
                if (openRef.current) {
                    onCloseRef.current();
                }
            }}
        >
            <BottomSheetScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
                <View className="flex-row items-center justify-between gap-2 px-4 pb-2">
                    <AppText className="flex-1 text-17 font-semibold" accessibilityRole="header">{title}</AppText>
                    <Pressable accessibilityRole="button" accessibilityLabel="Fechar" onPress={onClose} className="h-11 w-11 items-center justify-center rounded-full active:bg-line2">
                        <Icon name="close" tone="muted" />
                    </Pressable>
                </View>
                <InSheetContext value>
                    <View className="gap-3 px-4">{children}</View>
                </InSheetContext>
            </BottomSheetScrollView>
        </BottomSheetModal>
    );
}
