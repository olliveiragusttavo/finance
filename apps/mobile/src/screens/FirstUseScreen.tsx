import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../ui/AppText.tsx';

/**
 * Primeiro uso (mockup `MobilePrimeiroUso`), a tela do banco sem perfil: o shell não abre sem
 * perfil, porque toda rota do núcleo pede um. Por enquanto só o cabeçalho do mockup, para o teste
 * de fumaça provar que o app abre num banco vazio e chega aqui; o formulário é da Fase 7.
 *
 * @return A tela.
 */
export function FirstUseScreen(): ReactNode {
    const insets = useSafeAreaInsets();
    return (
        <View style={{ paddingTop: insets.top }} className="flex-1 bg-bg">
            <View className="gap-3.5 px-5 pb-6 pt-14">
                <AppText className="text-26 font-semibold" accessibilityRole="header">Vamos começar</AppText>
                <AppText className="text-13 text-muted">Seus dados ficam só neste aparelho e nos dispositivos que você parear.</AppText>
            </View>
        </View>
    );
}
