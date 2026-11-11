import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { FirstUseScreen } from '../src/screens/FirstUseScreen.tsx';
import { AppShell } from '../src/shell/AppShell.tsx';
import type { MobileStartup } from '../src/startup/openMobileCore.ts';
import { StartupGate } from '../src/startup/StartupGate.tsx';
import { ThemeRoot } from '../src/theme/ThemeRoot.tsx';
import { AppText } from '../src/ui/AppText.tsx';
import { DevicePreferencesProvider, DevicePreferencesStore } from '../src/preferences/devicePreferences.tsx';
import { MemoryFileSystem } from './support/MemoryFileSystem.ts';
import { PREFERENCES_URI, renderApp, TEST_METRICS } from './support/renderApp.tsx';
import { readyStartup, testCore, testQueryClient } from './support/renderWithCore.tsx';

/**
 * Renderiza a raiz do app (tema, portão da abertura e shell) com uma abertura pronta, sem tocar
 * no `expo-sqlite`; no lugar da navegação, um marcador.
 *
 * @param startup Abertura que o portão vai receber.
 */
async function renderGate(startup: MobileStartup): Promise<void> {
    await render(
        <SafeAreaProvider initialMetrics={TEST_METRICS}>
            <DevicePreferencesProvider store={new DevicePreferencesStore(new MemoryFileSystem(), PREFERENCES_URI)}>
                <ThemeRoot preference="light">
                    <StartupGate open={() => Promise.resolve(startup)} queryClient={testQueryClient()}>
                        <AppShell whenEmpty={<FirstUseScreen />}>
                            <AppText>App aberto</AppText>
                        </AppShell>
                    </StartupGate>
                </ThemeRoot>
            </DevicePreferencesProvider>
        </SafeAreaProvider>,
    );
}

describe('abertura do app (mobile-mvp-plan, Fase 4)', () => {
    it('banco vazio: abre e chega ao primeiro uso', async () => {
        await renderGate(readyStartup(testCore().core));

        expect(await screen.findByText('Vamos começar')).toBeOnTheScreen();
    });

    it('banco com perfil: abre no Início', async () => {
        const { core } = testCore();
        await core.call('onboarding.start', {
            profile: { name: 'Pessoal', type: 'personal', currency: 'BRL' },
            account: { name: 'Conta', type: 'checking' },
        });

        await renderApp(core);

        expect(await screen.findByRole('tab', { name: 'Início', selected: true })).toBeOnTheScreen();
    });

    it('banco mais novo que o app: bloqueia com o texto compartilhado com o desktop, sem oferecer restauração', async () => {
        await renderGate({
            status: { kind: 'schemaNewerThanApp', databaseVersion: 9, appVersion: 7 },
            client: null,
            close: () => undefined,
            restore: () => ({ ok: false, reason: 'not-blocked' }),
        });

        expect(await screen.findByText('Este banco é de uma versão mais nova do app')).toBeOnTheScreen();
        expect(screen.queryByText('Restaurar a cópia anterior')).toBeNull();
    });

    it('migration que falhou: oferece a cópia e diz onde ficou o banco depois de restaurar', async () => {
        const restore = jest.fn(() => ({ ok: true, restoredFrom: 'pre-v4.sqlite', failedCopy: 'falha-20260315-120000.sqlite' }) as const);
        await renderGate({ status: { kind: 'migrationFailed', backupFile: 'pre-v4.sqlite' }, client: null, close: () => undefined, restore });

        await fireEvent.press(await screen.findByText('Restaurar a cópia anterior'));

        expect(await screen.findByText(/falha-20260315-120000\.sqlite/)).toBeOnTheScreen();
        expect(restore).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Tentar restaurar de novo')).toBeNull();
    });
});
