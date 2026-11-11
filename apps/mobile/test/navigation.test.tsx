import type { Core } from '@finance/core';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { fixToday, restoreToday } from './support/fixedToday.ts';
import { renderApp } from './support/renderApp.tsx';
import { testCore } from './support/renderWithCore.tsx';

jest.mock('expo-file-system', () => ({ Paths: {} }));

/**
 * @param core Núcleo do teste.
 * @param name Nome do perfil.
 * @param type Tipo do perfil.
 * @return O id do perfil criado pelo primeiro uso.
 */
async function createProfile(core: Core, name: string, type: 'personal' | 'business' = 'personal'): Promise<string> {
    const result = await core.call('onboarding.start', { profile: { name, type, currency: 'BRL' }, account: { name: `Conta ${name}`, type: 'checking' } });
    if (!result.ok) {
        throw new Error(result.error.message);
    }
    return result.data.profile.id;
}

describe('shell e navegação (mobile-mvp-plan, Fase 6)', () => {
    it('abre no Início, com a barra inferior na ordem dos mockups e a aba aberta anunciada', async () => {
        const { core } = testCore();
        await createProfile(core, 'Gustavo');

        const app = await renderApp(core);

        expect(await screen.findByRole('tab', { name: 'Início', selected: true })).toBeOnTheScreen();
        const tabs = screen.getAllByRole('tab');
        ['Início', 'Transações', 'Contas', 'Cartões', 'Mais'].forEach((name, index) => {
            expect(tabs[index]).toHaveAccessibleName(name);
        });
        expect(app.getPathname()).toBe('/home');
    });

    it('cada aba guarda a própria pilha, e tocar na aba aberta volta ao topo dela', async () => {
        const { core } = testCore();
        await createProfile(core, 'Gustavo');
        const app = await renderApp(core);

        await fireEvent.press(await screen.findByRole('tab', { name: 'Mais' }));
        await fireEvent.press(await screen.findByRole('button', { name: 'Ajustes' }));
        expect(app.getPathname()).toBe('/more/settings');

        await fireEvent.press(screen.getByRole('tab', { name: 'Contas' }));
        expect(app.getPathname()).toBe('/accounts');

        await fireEvent.press(screen.getByRole('tab', { name: 'Mais' }));
        expect(app.getPathname()).toBe('/more/settings');

        await fireEvent.press(screen.getByRole('tab', { name: 'Mais' }));
        await waitFor(() => {
            expect(app.getPathname()).toBe('/more');
        });
    });

    it('o "+" abre o lançamento por cima das abas, sem a faixa do mês, e "Cancelar" volta', async () => {
        const { core } = testCore();
        await createProfile(core, 'Gustavo');
        const app = await renderApp(core);

        await fireEvent.press(await screen.findByRole('button', { name: 'Novo lançamento' }));

        expect(app.getPathname()).toBe('/new-transaction');
        expect(screen.queryByRole('button', { name: 'Mês anterior' })).toBeNull();
        await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
        expect(app.getPathname()).toBe('/home');
    });

    it('o mês de referência vale em todas as abas e fica gravado no aparelho', async () => {
        const { core } = testCore();
        await createProfile(core, 'Gustavo');
        const app = await renderApp(core, { preferences: { lastPeriod: '2026-03' } });

        expect(await screen.findByText('Março de 2026')).toBeOnTheScreen();
        await fireEvent.press(screen.getByRole('button', { name: 'Próximo mês' }));
        expect(screen.getByText('Abril de 2026')).toBeOnTheScreen();

        await fireEvent.press(screen.getByRole('tab', { name: 'Transações' }));
        expect(await screen.findByText('Abril de 2026')).toBeOnTheScreen();
        expect(app.storedPreferences().lastPeriod).toBe('2026-04');
    });

    it('fora do mês corrente, o centro da faixa volta ao mês atual', async () => {
        fixToday(2026, 10, 20);
        try {
            const { core } = testCore();
            await createProfile(core, 'Gustavo');
            await renderApp(core, { preferences: { lastPeriod: '2026-03' } });

            await fireEvent.press(await screen.findByRole('button', { name: 'Mês de referência: Março de 2026. Voltar ao mês atual' }));

            expect(await screen.findByText('Outubro de 2026')).toBeOnTheScreen();
            expect(screen.getByText('Mês de referência')).toBeOnTheScreen();
        } finally {
            restoreToday();
        }
    });

    it('a troca de perfil grava o último perfil e refaz as consultas no perfil novo', async () => {
        const { core } = testCore();
        const personal = await createProfile(core, 'Gustavo');
        const business = await createProfile(core, 'Estúdio GO', 'business');
        await core.call('notes.create', { profileId: business, text: 'Reunião com o contador' });
        // Sem preferência gravada, abre no primeiro perfil por nome: Estúdio GO.
        const app = await renderApp(core, { initialUrl: '/more' });

        expect(await screen.findByRole('button', { name: 'Anotações, 1' })).toBeOnTheScreen();
        await fireEvent.press(screen.getByRole('button', { name: /Trocar perfil/ }));
        const sheet = await screen.findByTestId('bottom-sheet');
        await fireEvent.press(within(sheet).getByRole('radio', { name: 'Gustavo, Pessoal · BRL' }));

        expect(await screen.findByRole('button', { name: 'Anotações, 0' })).toBeOnTheScreen();
        expect(screen.queryByTestId('bottom-sheet')).toBeNull();
        expect(app.storedPreferences().lastProfileId).toBe(personal);
    });

    it('reabre no último perfil do aparelho', async () => {
        const { core } = testCore();
        await createProfile(core, 'Gustavo');
        const business = await createProfile(core, 'Estúdio GO', 'business');

        await renderApp(core, { preferences: { lastProfileId: business } });

        expect(await screen.findByRole('button', { name: 'Perfil: Estúdio GO · Empresarial. Trocar perfil' })).toBeOnTheScreen();
    });

    it('o tema escolhido no cabeçalho fica gravado no aparelho', async () => {
        const { core } = testCore();
        await createProfile(core, 'Gustavo');
        const app = await renderApp(core);

        await fireEvent.press(await screen.findByRole('button', { name: 'Tema: Seguir o sistema' }));
        await fireEvent.press(within(await screen.findByTestId('bottom-sheet')).getByRole('radio', { name: 'Tema escuro' }));

        expect(await screen.findByRole('button', { name: 'Tema: Tema escuro' })).toBeOnTheScreen();
        expect(app.storedPreferences().theme).toBe('dark');
    });

    it('Dispositivos diz que os dados ficam só neste aparelho, e o "voltar" volta ao Mais', async () => {
        const { core } = testCore();
        await createProfile(core, 'Gustavo');
        const app = await renderApp(core, { initialUrl: '/more' });

        await fireEvent.press(await screen.findByRole('button', { name: 'Dispositivos e sincronização, Dados só neste aparelho' }));
        expect(await screen.findByText('Dados só neste aparelho')).toBeOnTheScreen();

        await act(async () => {
            await fireEvent.press(screen.getByRole('button', { name: 'Voltar' }));
        });
        expect(app.getPathname()).toBe('/more');
    });
});
