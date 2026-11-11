import type { Core } from '@finance/core';
import { renderRouter, type RenderRouterResult } from 'expo-router/testing-library';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DEFAULT_PREFERENCES, DevicePreferencesProvider, DevicePreferencesStore, type DevicePreferences } from '../../src/preferences/devicePreferences.tsx';
import { FirstUseScreen } from '../../src/screens/FirstUseScreen.tsx';
import { AppNavigation } from '../../src/shell/AppNavigation.tsx';
import { AppShell } from '../../src/shell/AppShell.tsx';
import type { DatabaseCopies } from '../../src/startup/databaseCopy.ts';
import { StartupGate } from '../../src/startup/StartupGate.tsx';
import { PreferredTheme } from '../../src/theme/PreferredTheme.tsx';
import { MemoryFileSystem } from './MemoryFileSystem.ts';
import { readyStartup, testQueryClient } from './renderWithCore.tsx';

/** Onde o teste guarda as preferências no disco em memória. */
export const PREFERENCES_URI = 'file:///docs/preferences.json';

/** O app montado no teste, com o disco das preferências para conferir o que foi gravado. */
export interface RenderedApp extends RenderRouterResult {
    readonly files: MemoryFileSystem;
    /** @return As preferências como estão gravadas no disco. */
    readonly storedPreferences: () => DevicePreferences;
}

/** Tamanho de tela e área segura fixos: no Jest não há aparelho para informá-los. */
export const TEST_METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

/**
 * Monta o app inteiro — as rotas de verdade de `app/`, com o shell, as abas e as pilhas — sobre o
 * núcleo em memória. Só a raiz é trocada, porque a de verdade abre o `expo-sqlite`; o resto é o
 * mesmo código que roda no aparelho, inclusive a navegação.
 *
 * @param core Núcleo do teste.
 * @param options.preferences Preferências já gravadas no aparelho.
 * @param options.initialUrl Rota em que o app abre; o Início por padrão.
 * @param options.copies Dublê da cópia do banco, para os testes de Ajustes.
 * @return O app renderizado.
 */
export async function renderApp(core: Core, options: { readonly preferences?: Partial<DevicePreferences>; readonly initialUrl?: string; readonly copies?: DatabaseCopies } = {}): Promise<RenderedApp> {
    const files = new MemoryFileSystem();
    if (options.preferences !== undefined) {
        files.writeText(PREFERENCES_URI, JSON.stringify({ ...DEFAULT_PREFERENCES, ...options.preferences }));
    }
    const store = new DevicePreferencesStore(files, PREFERENCES_URI);
    const startup = readyStartup(core, options.copies ?? null);
    const queryClient = testQueryClient();

    /** @return A raiz do app sobre o núcleo do teste. */
    function TestRootLayout(): ReactNode {
        return (
            <SafeAreaProvider initialMetrics={TEST_METRICS}>
                <DevicePreferencesProvider store={store}>
                    <PreferredTheme>
                        <StartupGate open={() => Promise.resolve(startup)} queryClient={queryClient}>
                            <AppShell whenEmpty={<FirstUseScreen />}>
                                <AppNavigation />
                            </AppShell>
                        </StartupGate>
                    </PreferredTheme>
                </DevicePreferencesProvider>
            </SafeAreaProvider>
        );
    }

    const result = await renderRouter({ appDir: join(__dirname, '../../app'), overrides: { _layout: TestRootLayout } }, { initialUrl: options.initialUrl ?? '/' });
    return Object.assign(result, { files, storedPreferences: () => new DevicePreferencesStore(files, PREFERENCES_URI).read() });
}
