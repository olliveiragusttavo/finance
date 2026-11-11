import { useCoreQuery } from '@finance/client';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { AppText } from '../ui/AppText.tsx';

/**
 * Primeira tela depois da abertura: o primeiro uso quando o banco não tem perfil, senão o
 * Início. No esqueleto (mobile-mvp-plan, Fase 4) as duas são só o cabeçalho, para o teste de
 * fumaça provar que o app abre num banco vazio e chega ao primeiro uso; o formulário do
 * primeiro uso é da Fase 7 e o Início, da Fase 8, com o texto do `MobilePrimeiroUso`.
 *
 * @return A tela inicial.
 */
export function StartScreen(): ReactNode {
    const profiles = useCoreQuery('profiles.list', {});
    if (profiles.data === undefined) {
        return <View className="flex-1 bg-bg" />;
    }
    if (profiles.data.length === 0) {
        return (
            <View className="flex-1 gap-3.5 bg-bg px-5 pb-6 pt-14">
                <AppText className="text-26 font-semibold" accessibilityRole="header">Vamos começar</AppText>
                <AppText className="text-13 text-muted">Seus dados ficam só neste aparelho e nos dispositivos que você parear.</AppText>
            </View>
        );
    }
    return (
        <View className="flex-1 bg-bg px-5 pt-14">
            <AppText className="text-22 font-semibold" accessibilityRole="header">Início</AppText>
        </View>
    );
}
