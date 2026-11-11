import '../global.css';
import { Slot } from 'expo-router';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppLifecycleRoot } from '../src/startup/AppLifecycle.tsx';
import { openMobileCore } from '../src/startup/openMobileCore.ts';
import { StartupGate } from '../src/startup/StartupGate.tsx';
import { ThemeRoot } from '../src/theme/ThemeRoot.tsx';

/**
 * Raiz do app no Expo Router: tema, ciclo de vida e portão da abertura envolvem todas as rotas,
 * para que nenhuma tela renderize antes de o banco abrir nem fora do tema. A navegação (abas e
 * pilhas) é da Fase 6; até lá, a única rota é a tela inicial.
 *
 * @return A árvore do app.
 */
export default function RootLayout(): ReactNode {
    return (
        <SafeAreaProvider>
            <ThemeRoot>
                <AppLifecycleRoot>
                    <StartupGate open={openMobileCore}>
                        <Slot />
                    </StartupGate>
                </AppLifecycleRoot>
            </ThemeRoot>
        </SafeAreaProvider>
    );
}
