import { fireEvent, render, screen } from '@testing-library/react-native';
import { StartScreen } from '../src/screens/StartScreen.tsx';
import type { MobileStartup } from '../src/startup/openMobileCore.ts';
import { StartupGate } from '../src/startup/StartupGate.tsx';
import { ThemeRoot } from '../src/theme/ThemeRoot.tsx';
import { readyStartup, renderWithCore, testCore, testQueryClient } from './support/renderWithCore.tsx';

/**
 * Renderiza a raiz do app (tema, portão da abertura e tela inicial) com uma abertura pronta,
 * sem tocar no `expo-sqlite`.
 *
 * @param startup Abertura que o portão vai receber.
 */
async function renderGate(startup: MobileStartup): Promise<void> {
    await render(
        <ThemeRoot preference="light">
            <StartupGate open={() => Promise.resolve(startup)} queryClient={testQueryClient()}>
                <StartScreen />
            </StartupGate>
        </ThemeRoot>,
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

        await renderWithCore(<StartScreen />, core);

        expect(await screen.findByText('Início')).toBeOnTheScreen();
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
