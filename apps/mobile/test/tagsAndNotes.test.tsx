import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { fixToday, restoreToday } from './support/fixedToday.ts';
import { renderApp } from './support/renderApp.tsx';
import { testCore } from './support/renderWithCore.tsx';
import { ok, SCENARIO_PERIOD, SCENARIO_TODAY, seedScenario, type Scenario } from './support/scenario.ts';

jest.mock('expo-file-system', () => ({ Paths: {} }));

/** O que os testes usam: o núcleo, os ids do cenário e o app aberto. */
interface Opened {
    readonly core: ReturnType<typeof testCore>['core'];
    readonly s: Scenario;
    readonly app: Awaited<ReturnType<typeof renderApp>>;
}

/**
 * @return O núcleo com o cenário (a tag "viagem" na compra e a anotação "IPTU 2027") e o app
 * aberto em Mais.
 */
async function openMore(): Promise<Opened> {
    fixToday(2026, 10, 15);
    const { core } = testCore(SCENARIO_TODAY);
    const s = await seedScenario(core);
    const app = await renderApp(core, { preferences: { lastPeriod: SCENARIO_PERIOD, lastProfileId: s.profileId }, initialUrl: '/more' });
    await screen.findByRole('button', { name: /^Cadastros/ });
    return { core, s, app };
}

/**
 * Entra em Cadastros › Tags, como o usuário faz.
 *
 * @return O app aberto em Tags.
 */
async function openTags(): Promise<Opened> {
    const opened = await openMore();
    await fireEvent.press(screen.getByRole('button', { name: /^Cadastros/ }));
    await fireEvent.press(await screen.findByRole('button', { name: /^Tags, / }));
    await screen.findByRole('button', { name: 'viagem, 1 lançamento' });
    return opened;
}

/**
 * Entra em Anotações pelo menu Mais.
 *
 * @return O app aberto na lista de anotações.
 */
async function openNotes(): Promise<Opened> {
    const opened = await openMore();
    await fireEvent.press(screen.getByRole('button', { name: /^Anotações/ }));
    await screen.findByRole('button', { name: 'IPTU 2027' });
    return opened;
}

/**
 * @return A última folha aberta.
 * @throws {Error} Quando nenhuma folha está aberta.
 */
function lastSheet(): ReturnType<typeof screen.getByTestId> {
    const sheet = screen.getAllByTestId('bottom-sheet').at(-1);
    if (sheet === undefined) {
        throw new Error('nenhuma folha aberta');
    }
    return sheet;
}

afterEach(restoreToday);

describe('Tags (mobile-mvp-plan, Fase 16)', () => {
    it('cria uma tag pelo campo do topo e recusa o nome repetido', async () => {
        const { core, s } = await openTags();

        await fireEvent.changeText(screen.getByLabelText('Nova tag'), 'presente');
        await fireEvent.press(screen.getByRole('button', { name: 'Adicionar' }));
        expect(await screen.findByRole('button', { name: 'presente, 0 lançamentos' })).toBeOnTheScreen();

        await fireEvent.changeText(screen.getByLabelText('Nova tag'), 'Viagem');
        await fireEvent.press(screen.getByRole('button', { name: 'Adicionar' }));
        expect(await screen.findByLabelText(/^Nova tag\. /)).toBeOnTheScreen();
        expect((await ok(core, 'tags.list', { profileId: s.profileId })).map((tag) => tag.name)).toEqual(['presente', 'viagem']);
    });

    it('renomeia a tag na folha', async () => {
        const { core, s } = await openTags();

        await fireEvent.press(screen.getByRole('button', { name: 'viagem, 1 lançamento' }));
        expect(within(lastSheet()).getByText('Excluir remove a tag do lançamento. Os lançamentos continuam existindo.')).toBeOnTheScreen();
        await fireEvent.changeText(within(lastSheet()).getByLabelText('Nome'), 'férias');
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Salvar' }));

        expect(await screen.findByRole('button', { name: 'férias, 1 lançamento' })).toBeOnTheScreen();
        expect((await ok(core, 'tags.list', { profileId: s.profileId })).map((tag) => tag.name)).toEqual(['férias']);
    });

    it('Regra de negócio (Tags): excluir tira a tag do lançamento, que continua existindo', async () => {
        const { core, s } = await openTags();

        await fireEvent.press(screen.getByRole('button', { name: 'viagem, 1 lançamento' }));
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Excluir tag' }));

        expect(await screen.findByText('Nenhuma tag')).toBeOnTheScreen();
        expect((await ok(core, 'transactions.get', { id: s.purchaseId })).tagIds).toEqual([]);
    });
});

describe('Anotações (mobile-mvp-plan, Fase 16)', () => {
    it('busca no texto e escreve uma anotação nova, que volta à lista com o título da primeira linha', async () => {
        const { core, s, app } = await openNotes();

        await fireEvent.changeText(screen.getByLabelText('Buscar anotações'), 'aluguel');
        expect(await screen.findByText('Nenhuma anotação encontrada')).toBeOnTheScreen();
        await fireEvent.changeText(screen.getByLabelText('Buscar anotações'), '');

        await fireEvent.press(screen.getByRole('button', { name: 'Nova anotação' }));
        await fireEvent.press(await screen.findByRole('button', { name: 'Salvar' }));
        expect(await screen.findByText('Escreva a anotação antes de salvar.')).toBeOnTheScreen();

        await fireEvent.changeText(screen.getByLabelText(/^Texto da anotação/), 'Reembolsos\nCobrar a empresa no fim do mês.');
        await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }));

        await waitFor(() => {
            expect(app.getPathname()).toBe('/more/notes');
        });
        expect(await screen.findByRole('button', { name: 'Reembolsos, Cobrar a empresa no fim do mês.' })).toBeOnTheScreen();
        expect(await ok(core, 'notes.list', { profileId: s.profileId })).toHaveLength(2);
    });

    it('sair com alteração não salva pergunta; "Descartar" sai sem gravar', async () => {
        const { core, s, app } = await openNotes();

        await fireEvent.press(screen.getByRole('button', { name: 'IPTU 2027' }));
        await fireEvent.changeText(await screen.findByLabelText(/^Texto da anotação/), 'IPTU 2027\nCota única.');
        await fireEvent.press(screen.getByRole('button', { name: 'Voltar' }));

        expect(await screen.findByText('Salvar a anotação?')).toBeOnTheScreen();
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Descartar' }));

        await waitFor(() => {
            expect(app.getPathname()).toBe('/more/notes');
        });
        expect((await ok(core, 'notes.list', { profileId: s.profileId }))[0]?.text).toBe('IPTU 2027');
    });

    it('sair com alteração não salva e escolher "Salvar" grava e sai', async () => {
        const { core, s, app } = await openNotes();

        await fireEvent.press(screen.getByRole('button', { name: 'IPTU 2027' }));
        await fireEvent.changeText(await screen.findByLabelText(/^Texto da anotação/), 'IPTU 2027\nCota única.');
        await fireEvent.press(screen.getByRole('button', { name: 'Voltar' }));
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Salvar' }));

        await waitFor(() => {
            expect(app.getPathname()).toBe('/more/notes');
        });
        expect((await ok(core, 'notes.list', { profileId: s.profileId }))[0]?.text).toBe('IPTU 2027\nCota única.');
    });

    it('exclui a anotação depois de confirmar com o título', async () => {
        const { core, s, app } = await openNotes();

        await fireEvent.press(screen.getByRole('button', { name: 'IPTU 2027' }));
        await fireEvent.press(await screen.findByRole('button', { name: 'Excluir' }));
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Excluir anotação' }));

        await waitFor(() => {
            expect(app.getPathname()).toBe('/more/notes');
        });
        expect(await screen.findByText('Nenhuma anotação')).toBeOnTheScreen();
        expect(await ok(core, 'notes.list', { profileId: s.profileId })).toHaveLength(0);
    });
});
