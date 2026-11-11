import { fireEvent, screen, within } from 'expo-router/testing-library';
import { renderApp } from './support/renderApp.tsx';
import { testCore } from './support/renderWithCore.tsx';

jest.mock('expo-file-system', () => ({ Paths: {} }));

describe('primeiro uso (mobile-mvp-plan, Fase 7)', () => {
    it('cria o perfil e a primeira conta e entra no Início, no perfil criado', async () => {
        const { core } = testCore();
        const app = await renderApp(core, { preferences: { lastPeriod: '2020-01' } });

        await fireEvent.changeText(await screen.findByLabelText('Nome do perfil'), 'Estúdio GO');
        await fireEvent.press(screen.getByRole('radio', { name: 'Empresarial' }));
        await fireEvent.changeText(screen.getByLabelText('Nome da conta'), 'Itaú');
        await fireEvent.changeText(screen.getByLabelText('Saldo inicial'), '1.234,56');
        await fireEvent.press(screen.getByRole('button', { name: 'Criar e começar' }));

        expect(await screen.findByRole('button', { name: 'Perfil: Estúdio GO · Empresarial. Trocar perfil' })).toBeOnTheScreen();
        const profiles = await core.call('profiles.list', {});
        expect(profiles.ok && profiles.data.map((profile) => profile.name)).toEqual(['Estúdio GO']);
        const profileId = profiles.ok ? profiles.data[0]?.id : undefined;
        const accounts = profileId === undefined ? null : await core.call('accounts.list', { profileId, period: '2026-03' });
        expect(accounts?.ok && accounts.data.accounts.map((account) => [account.name, account.type, account.openingBalance.amount])).toEqual([['Itaú', 'checking', 1234.56]]);
        expect(app.storedPreferences()).toMatchObject({ lastProfileId: profileId, lastPeriod: null });
    });

    it('sem nome, aponta o campo com a mesma frase do desktop e não grava nada', async () => {
        const { core } = testCore();
        await renderApp(core);

        await fireEvent.changeText(await screen.findByLabelText('Saldo inicial'), 'doze');
        await fireEvent.press(screen.getByRole('button', { name: 'Criar e começar' }));

        expect(await screen.findByLabelText('Nome do perfil. Informe o nome do perfil.')).toBeOnTheScreen();
        expect(screen.getByText('Informe o nome da conta.')).toBeOnTheScreen();
        expect(screen.getByText('Digite um valor como 1.234,56.')).toBeOnTheScreen();
        const profiles = await core.call('profiles.list', {});
        expect(profiles.ok && profiles.data).toEqual([]);
    });

    it('a moeda abre numa folha e "Entrar num grupo" fica desabilitado até a sincronização', async () => {
        const { core } = testCore();
        await renderApp(core);

        await fireEvent.press(await screen.findByRole('button', { name: 'Moeda: BRL — Real' }));
        await fireEvent.press(within(screen.getByTestId('bottom-sheet')).getByRole('radio', { name: 'USD — Dólar' }));

        expect(screen.getByRole('button', { name: 'Moeda: USD — Dólar' })).toBeOnTheScreen();
        expect(screen.getByRole('button', { name: 'Entrar num grupo existente' })).toBeDisabled();
    });
});
