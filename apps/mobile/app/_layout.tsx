// Primeiro import: marca o início do JavaScript para a medição da abertura (Fase 5).
import '../src/startup/startupTiming.ts';
import '../global.css';
import { useState, type ReactNode } from 'react';
import { LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { appPreferencesStore } from '../src/preferences/appPreferencesStore.ts';
import { DevicePreferencesProvider } from '../src/preferences/devicePreferences.tsx';
import { FirstUseScreen } from '../src/screens/FirstUseScreen.tsx';
import { AppNavigation } from '../src/shell/AppNavigation.tsx';
import { AppShell } from '../src/shell/AppShell.tsx';
import { AppLifecycleRoot } from '../src/startup/AppLifecycle.tsx';
import { openMobileCore } from '../src/startup/openMobileCore.ts';
import { StartupGate } from '../src/startup/StartupGate.tsx';
import { PreferredTheme } from '../src/theme/PreferredTheme.tsx';

// O NativeWind registra o `ImageBackground` ao carregar, e o React Native avisa que ele está
// obsoleto. O aviso não é do app e, no desenvolvimento, a faixa do LogBox cobre a barra inferior
// e engole os toques nela.
LogBox.ignoreLogs(['ImageBackground is deprecated']);

/**
 * Raiz do app no Expo Router: gestos, área segura, preferências do aparelho, tema, ciclo de vida
 * e portão da abertura envolvem todas as rotas, para que nenhuma tela renderize antes de o banco
 * abrir nem fora do tema. Depois do banco, o shell decide entre o primeiro uso e a navegação: as
 * abas e, por cima delas, o lançamento, que abre sem a barra inferior.
 *
 * @return A árvore do app.
 */
export default function RootLayout(): ReactNode {
    const [preferences] = useState(appPreferencesStore);
    return (
        <GestureHandlerRootView className="flex-1">
            <SafeAreaProvider>
                <DevicePreferencesProvider store={preferences}>
                    <PreferredTheme>
                        <AppLifecycleRoot>
                            <StartupGate open={openMobileCore}>
                                <AppShell whenEmpty={<FirstUseScreen />}>
                                    <AppNavigation />
                                </AppShell>
                            </StartupGate>
                        </AppLifecycleRoot>
                    </PreferredTheme>
                </DevicePreferencesProvider>
            </SafeAreaProvider>
        </GestureHandlerRootView>
    );
}
