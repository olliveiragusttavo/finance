import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { renderApp } from './support/renderApp.tsx';
import { testCore } from './support/renderWithCore.tsx';
import { ok, SCENARIO_PERIOD, SCENARIO_TODAY } from './support/scenario.ts';

jest.mock('expo-file-system', () => ({ Paths: {} }));

/**
 * @return O núcleo com um perfil empresarial sem sócios, aberto no aparelho, e o app na tela de
 * Sócios, aberta por Cadastros como o usuário faz.
 */
async function openPartners(): Promise<{ readonly core: ReturnType<typeof testCore>['core']; readonly profileId: string }> {
    const { core } = testCore(SCENARIO_TODAY);
    const { profile } = await ok(core, 'onboarding.start', {
        profile: { name: 'Estúdio', type: 'business', currency: 'BRL' },
        account: { name: 'Caixa', type: 'checking', openingBalance: 0 },
        suggestedCategories: false,
    });
    await renderApp(core, { preferences: { lastPeriod: SCENARIO_PERIOD, lastProfileId: profile.id }, initialUrl: '/more/registries' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Sócios, 0' }));
    await screen.findByText('Soma das participações');
    return { core, profileId: profile.id };
}

describe('Sócios (mobile-mvp-plan, Fase 17)', () => {
    it('Regra de negócio (Sócios): a soma aparece ao vivo e só salva quando fecha em 100%', async () => {
        const { core, profileId } = await openPartners();

        await fireEvent.changeText(screen.getByLabelText('Nome do novo sócio'), 'Ana');
        await fireEvent.press(screen.getByRole('button', { name: 'Adicionar' }));
        await fireEvent.changeText(screen.getByLabelText('Nome do novo sócio'), 'Bia');
        await fireEvent.press(screen.getByRole('button', { name: 'Adicionar' }));

        await fireEvent.changeText(screen.getByLabelText('Participação de Ana'), '60');
        expect(await screen.findByText('Faltam 40% para fechar 100%.')).toBeOnTheScreen();
        expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();

        await fireEvent.changeText(screen.getByLabelText('Participação de Bia'), '50');
        expect(await screen.findByText('A soma passou 10% de 100%. Reduza a participação de alguém.')).toBeOnTheScreen();

        await fireEvent.changeText(screen.getByLabelText('Participação de Bia'), '40');
        expect(await screen.findByText('A soma dá 100%. Pode salvar.')).toBeOnTheScreen();
        await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }));

        await waitFor(() => {
            expect(screen.queryByRole('button', { name: 'Descartar alterações' })).toBeNull();
        });
        const partners = await ok(core, 'partners.list', { profileId });
        expect(partners.map((partner) => [partner.name, partner.percentage])).toEqual([
            ['Ana', 60],
            ['Bia', 40],
        ]);
    });

    it('remove um sócio e descarta as alterações, voltando ao gravado', async () => {
        const { core, profileId } = await openPartners();
        await fireEvent.changeText(screen.getByLabelText('Nome do novo sócio'), 'Ana');
        await fireEvent.press(screen.getByRole('button', { name: 'Adicionar' }));
        await fireEvent.changeText(screen.getByLabelText('Participação de Ana'), '100');
        await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }));
        await waitFor(() => {
            expect(screen.queryByRole('button', { name: 'Descartar alterações' })).toBeNull();
        });

        await fireEvent.press(screen.getByRole('button', { name: 'Remover Ana' }));
        expect(await screen.findByRole('button', { name: 'Descartar alterações' })).toBeOnTheScreen();
        await fireEvent.press(screen.getByRole('button', { name: 'Descartar alterações' }));

        expect(await screen.findByLabelText('Participação de Ana')).toBeOnTheScreen();
        expect(await ok(core, 'partners.list', { profileId })).toHaveLength(1);
    });
});
