import { describeGoalDeletion, describeGoalListItem } from '@finance/client';
import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { fixToday, restoreToday } from './support/fixedToday.ts';
import { renderApp } from './support/renderApp.tsx';
import { testCore } from './support/renderWithCore.tsx';
import { ok, SCENARIO_PERIOD, SCENARIO_TODAY, seedScenario, type Scenario } from './support/scenario.ts';

jest.mock('expo-file-system', () => ({ Paths: {} }));

/** O que os testes de Metas usam: o núcleo, os ids do cenário e o app aberto. */
interface OpenedGoals {
    readonly core: ReturnType<typeof testCore>['core'];
    readonly s: Scenario;
    readonly app: Awaited<ReturnType<typeof renderApp>>;
}

/**
 * Abre o app em Mais e entra em Metas, como o usuário faz.
 *
 * @return O núcleo com o cenário (a Reserva, com o salário vinculado) e a lista de Metas aberta.
 */
async function openGoals(): Promise<OpenedGoals> {
    fixToday(2026, 10, 15);
    const { core } = testCore(SCENARIO_TODAY);
    const s = await seedScenario(core);
    const app = await renderApp(core, { preferences: { lastPeriod: SCENARIO_PERIOD }, initialUrl: '/more' });
    await fireEvent.press(await screen.findByRole('button', { name: /^Metas/ }));
    await screen.findByRole('button', { name: /^Reserva, / });
    return { core, s, app };
}

/**
 * Abre o detalhe da Reserva pela lista.
 *
 * @param opened O app aberto em Metas.
 */
async function openReserve(opened: OpenedGoals): Promise<void> {
    await fireEvent.press(screen.getByRole('button', { name: /^Reserva, / }));
    await waitFor(() => {
        expect(opened.app.getPathname()).toBe(`/more/goal/${opened.s.goalId}`);
    });
    await screen.findByText('Ritmo necessário');
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

describe('Metas (mobile-mvp-plan, Fase 14)', () => {
    it('lista as metas com o progresso do núcleo e troca a visualização', async () => {
        const { core, s } = await openGoals();
        const [reserve] = await ok(core, 'goals.list', { profileId: s.profileId, period: SCENARIO_PERIOD });
        if (reserve === undefined) {
            throw new Error('sem a meta');
        }
        const item = describeGoalListItem(reserve);

        expect(screen.getByRole('button', { name: new RegExp(`^Reserva, ${item.percentText}, `) })).toBeOnTheScreen();
        expect(screen.getByText(item.summary)).toBeOnTheScreen();

        await fireEvent.press(screen.getByRole('radio', { name: 'Arquivadas' }));
        expect(await screen.findByText('Nenhuma meta arquivada')).toBeOnTheScreen();
    });

    it('o detalhe mostra as vinculadas, e a vinculada abre o lançamento na aba Mais', async () => {
        const opened = await openGoals();
        await openReserve(opened);

        await fireEvent.press(await screen.findByRole('button', { name: /^Salário, / }));
        await waitFor(() => {
            expect(opened.app.getPathname()).toBe(`/more/transaction/${opened.s.incomeId}`);
        });
        expect(await screen.findByText('Receita')).toBeOnTheScreen();
    });

    it('cria uma meta vinculada ao saldo de uma conta de investimento e abre o detalhe', async () => {
        const { core, s, app } = await openGoals();

        await fireEvent.press(screen.getByRole('button', { name: 'Nova meta' }));
        await fireEvent.changeText(screen.getByLabelText('Nome da meta'), 'Casa');
        await fireEvent.changeText(screen.getByLabelText('Valor-alvo'), '20.000,00');
        await fireEvent.press(screen.getByRole('radio', { name: 'Saldo de uma conta' }));
        await fireEvent.press(screen.getByRole('button', { name: 'Conta de investimento: Escolha a conta' }));
        await fireEvent.press(within(lastSheet()).getByRole('radio', { name: 'Tesouro' }));
        await fireEvent.press(screen.getByRole('button', { name: 'Criar meta' }));

        await waitFor(() => {
            expect(app.getPathname()).toMatch(/^\/more\/goal\/[^/]+$/);
        });
        expect(await screen.findByText('Meta de economia · Saldo de Tesouro')).toBeOnTheScreen();
        expect(screen.getByRole('link', { name: 'Ver extrato da conta ›' })).toBeOnTheScreen();
        const goals = await ok(core, 'goals.list', { profileId: s.profileId, period: SCENARIO_PERIOD });
        expect(goals.find((goal) => goal.name === 'Casa')).toMatchObject({ funding: { kind: 'account', accountId: s.savingsId }, value: { amount: 20000 }, targetDate: null });
    });

    it('arquiva a meta pelo ⋯, e ela passa para as arquivadas', async () => {
        const opened = await openGoals();
        const { core, s } = opened;
        await openReserve(opened);

        await fireEvent.press(screen.getByRole('button', { name: 'Ações da meta' }));
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Arquivar meta' }));

        expect(await screen.findByText('Arquivada')).toBeOnTheScreen();
        const goals = await ok(core, 'goals.list', { profileId: s.profileId, period: SCENARIO_PERIOD });
        expect(goals.find((goal) => goal.id === s.goalId)?.archived).toBe(true);
    });

    it('exclui a meta com o aviso dos vínculos e volta à lista', async () => {
        const opened = await openGoals();
        const { core, s, app } = opened;
        await openReserve(opened);
        const [reserve] = await ok(core, 'goals.list', { profileId: s.profileId, period: SCENARIO_PERIOD });
        if (reserve === undefined) {
            throw new Error('sem a meta');
        }

        await fireEvent.press(screen.getByRole('button', { name: 'Ações da meta' }));
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Excluir meta…' }));
        expect(await screen.findByText(describeGoalDeletion(reserve))).toBeOnTheScreen();
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Excluir meta' }));

        await waitFor(() => {
            expect(app.getPathname()).toBe('/more/goals');
        });
        expect(await screen.findByText('Nenhuma meta')).toBeOnTheScreen();
        expect(await ok(core, 'goals.list', { profileId: s.profileId, period: SCENARIO_PERIOD })).toHaveLength(0);
    });
});
