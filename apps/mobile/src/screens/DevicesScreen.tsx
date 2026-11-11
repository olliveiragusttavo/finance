import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Screen } from '../shell/Screen.tsx';
import { ScreenHeader } from '../shell/ScreenHeader.tsx';
import { AppText } from '../ui/AppText.tsx';

/**
 * Dispositivos antes da sincronização (mobile-mvp-plan §5.1): a rota existe no menu Mais desde já,
 * e a tela diz que os dados ficam só neste aparelho, como o rodapé do desktop antes do sync. O
 * pareamento e a lista do grupo (mockup `MobileDispositivos`) chegam com o plano de
 * sincronização, que troca esta tela.
 *
 * @return A tela.
 */
export function DevicesScreen(): ReactNode {
    return (
        <Screen header={<ScreenHeader title="Dispositivos" back />}>
            <View className="gap-1.5 rounded-12 border border-line bg-surface p-4">
                <AppText className="font-medium">Dados só neste aparelho</AppText>
                <AppText className="text-13 text-muted">
                    Os lançamentos feitos aqui ficam no banco deste celular e não aparecem no computador, nem os de lá aparecem aqui. A sincronização entre os seus aparelhos, pela rede Wi-Fi, chega numa próxima versão.
                </AppText>
            </View>
        </Screen>
    );
}
