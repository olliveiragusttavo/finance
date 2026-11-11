import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../ui/AppText.tsx';
import { MonthStrip } from './MonthStrip.tsx';
import { ROUTES } from './routes.ts';
import { ThemeButton } from './ThemeButton.tsx';

/**
 * Botão "+" de lançamento (mockups `MobileInicio` e `MobileTransacoes`): flutua no canto de
 * baixo, acima da barra inferior, e abre o lançamento por cima da aba.
 *
 * @return O botão.
 */
export function NewTransactionButton(): ReactNode {
    const router = useRouter();
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Novo lançamento"
            onPress={() => {
                router.push(ROUTES.newTransaction);
            }}
            style={{ elevation: 6 }}
            className="absolute bottom-5 right-5 h-15 w-15 items-center justify-center rounded-full bg-accent active:opacity-80"
        >
            <AppText className="text-30 text-on-accent">+</AppText>
        </Pressable>
    );
}

/**
 * Esqueleto de uma tela do shell: cabeçalho, a faixa do mês quando a tela depende de período
 * (decisão de interface 2 dos mockups), o corpo com a rolagem e o espaçamento dos mockups
 * (`.bd`: 16 px nas laterais, 14 px entre blocos) e o "+" de lançamento nas telas que o têm.
 *
 * @param props.header O cabeçalho da tela.
 * @param props.withMonth Mostra a faixa do mês de referência.
 * @param props.withNewTransaction Mostra o "+" de lançamento.
 * @param props.scroll Rola o corpo; `false` para a tela que traz a própria lista virtualizada.
 * @param props.children Corpo.
 * @return A tela.
 */
export function Screen(props: {
    readonly header: ReactNode;
    readonly withMonth?: boolean;
    readonly withNewTransaction?: boolean;
    readonly scroll?: boolean;
    readonly children: ReactNode;
}): ReactNode {
    const { header, withMonth = false, withNewTransaction = false, scroll = true, children } = props;
    return (
        <View className="flex-1 bg-bg">
            {header}
            {withMonth && <MonthStrip />}
            {scroll ? (
                <ScrollView className="flex-1" contentContainerClassName={`gap-3.5 px-4 pt-3.5 ${withNewTransaction ? 'pb-24' : 'pb-6'}`}>
                    {children}
                </ScrollView>
            ) : (
                <View className="flex-1">{children}</View>
            )}
            {withNewTransaction && <NewTransactionButton />}
        </View>
    );
}

/**
 * @return O "voltar à tela anterior" de quem não está numa pilha (o lançamento, que abre por
 * cima das abas): volta quando há para onde, senão vai ao Início.
 */
export function useCloseModal(): () => void {
    const router = useRouter();
    return () => {
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace(ROUTES.home);
        }
    };
}

/**
 * Cabeçalho de uma tela que abre por cima das abas (o lançamento, mockup `MobileLancamento`):
 * "Cancelar", o título e o tema, sem a faixa do mês (decisão de interface 2 dos mockups).
 *
 * @param props.title Título.
 * @return O cabeçalho.
 */
export function ModalHeader({ title }: { readonly title: string }): ReactNode {
    const close = useCloseModal();
    const insets = useSafeAreaInsets();
    return (
        <View style={{ paddingTop: insets.top }} className="border-b border-line bg-surface">
            <View className="min-h-16.5 flex-row items-center justify-between gap-2 pb-2 pl-2 pr-3 pt-2.5">
                <Pressable accessibilityRole="button" onPress={close} className="min-h-11 justify-center rounded-10 px-2 active:bg-line2">
                    <AppText className="text-accent">Cancelar</AppText>
                </Pressable>
                <AppText className="shrink text-17 font-semibold" accessibilityRole="header" numberOfLines={1}>{title}</AppText>
                <ThemeButton />
            </View>
        </View>
    );
}
