import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { fixToday, restoreToday } from './support/fixedToday.ts';
import { renderApp } from './support/renderApp.tsx';
import { testCore } from './support/renderWithCore.tsx';
import { ok, SCENARIO_PERIOD, SCENARIO_TODAY, seedScenario, type Scenario } from './support/scenario.ts';

jest.mock('expo-file-system', () => ({ Paths: {} }));

/**
 * Escolhe uma opção na folha aberta por último.
 *
 * @param name Nome acessível da opção.
 */
async function pickInSheet(name: string | RegExp): Promise<void> {
    const sheet = screen.getAllByTestId('bottom-sheet').at(-1);
    if (sheet === undefined) {
        throw new Error('nenhuma folha aberta');
    }
    await fireEvent.press(within(sheet).getByRole('radio', { name }));
}

/**
 * @return O núcleo com o cenário, a Nubank e o Roxinho como padrão, e o lançamento novo aberto
 * pelo "+" do Início, como o usuário faz.
 */
async function openNew(): Promise<{ readonly core: ReturnType<typeof testCore>['core']; readonly s: Scenario; readonly app: Awaited<ReturnType<typeof renderApp>> }> {
    fixToday(2026, 10, 15);
    const { core } = testCore(SCENARIO_TODAY);
    const s = await seedScenario(core);
    await ok(core, 'profiles.setDefaultAccount', { profileId: s.profileId, accountId: s.checkingId });
    await ok(core, 'profiles.setDefaultCreditCard', { profileId: s.profileId, creditCardId: s.creditCardId });
    const app = await renderApp(core, { preferences: { lastPeriod: SCENARIO_PERIOD } });
    await fireEvent.press(await screen.findByRole('button', { name: 'Novo lançamento' }));
    await screen.findByLabelText('Valor');
    return { core, s, app };
}

afterEach(restoreToday);

describe('lançamento (mobile-mvp-plan, Fase 10)', () => {
    it('lança uma despesa no débito, com a conta padrão já escolhida, e volta', async () => {
        const { core, s, app } = await openNew();

        expect(screen.getByRole('button', { name: 'Conta ou cartão: Nubank' })).toBeOnTheScreen();
        await fireEvent.changeText(screen.getByLabelText('Valor'), '45,90');
        expect(screen.getByText('−R$ 45,90')).toBeOnTheScreen();
        await fireEvent.press(screen.getByRole('button', { name: 'Categoria: Escolha a categoria' }));
        await pickInSheet('Alimentação › Mercado');
        await fireEvent.changeText(screen.getByLabelText('Nome'), 'Padaria');
        await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }));

        await waitFor(() => {
            expect(app.getPathname()).toBe('/home');
        });
        const october = await ok(core, 'transactions.listByPeriod', { profileId: s.profileId, period: SCENARIO_PERIOD });
        const saved = october.find((transaction) => transaction.name === 'Padaria');
        expect(saved).toMatchObject({ type: 'expense', dueDate: SCENARIO_TODAY, value: { amount: 45.9 }, container: { kind: 'statement', accountId: s.checkingId } });
    });

    it('no crédito, vai para o cartão padrão e mostra a fatura sugerida pela data da compra', async () => {
        const { core, s, app } = await openNew();

        await fireEvent.press(screen.getByRole('radio', { name: 'Crédito' }));
        expect(screen.getByRole('button', { name: 'Conta ou cartão: Roxinho' })).toBeOnTheScreen();
        expect(await screen.findByText(/Sugerida pela data da compra: nov\/2026, vence 10\/11/)).toBeOnTheScreen();
        await fireEvent.changeText(screen.getByLabelText('Valor'), '120');
        await fireEvent.press(screen.getByRole('button', { name: 'Categoria: Escolha a categoria' }));
        await pickInSheet('Alimentação › Restaurantes');
        await fireEvent.changeText(screen.getByLabelText('Nome'), 'Jantar');
        await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }));

        await waitFor(() => {
            expect(app.getPathname()).toBe('/home');
        });
        const purchases = await ok(core, 'transactions.listByPeriod', { profileId: s.profileId, period: SCENARIO_PERIOD });
        expect(purchases.find((transaction) => transaction.name === 'Jantar')?.container).toMatchObject({ kind: 'invoice', creditCardId: s.creditCardId, period: '2026-11' });
    });

    it('sem nome nem categoria, aponta os campos e não grava', async () => {
        const { core, s } = await openNew();

        await fireEvent.changeText(screen.getByLabelText('Valor'), '10');
        await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }));

        expect(await screen.findByLabelText('Nome. Informe o nome.')).toBeOnTheScreen();
        expect(screen.getByText('Escolha a categoria.')).toBeOnTheScreen();
        const october = await ok(core, 'transactions.listByPeriod', { profileId: s.profileId, period: SCENARIO_PERIOD });
        expect(october).toHaveLength(4);
    });

    it('a transferência pede o destino e o nome sugerido copia categoria e origem', async () => {
        const { core, s, app } = await openNew();

        await fireEvent.press(screen.getByRole('radio', { name: 'Transf.' }));
        expect(screen.getByRole('button', { name: 'Conta de destino: Escolha a conta' })).toBeOnTheScreen();
        const name = screen.getByLabelText('Nome');
        await fireEvent(name, 'focus');
        await fireEvent.changeText(name, 'Apo');
        await fireEvent.press(await screen.findByRole('button', { name: 'Usar Aporte' }));
        await fireEvent.press(screen.getByRole('button', { name: 'Conta de destino: Escolha a conta' }));
        await pickInSheet('Tesouro');
        await fireEvent.changeText(screen.getByLabelText('Valor'), '200');
        await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }));

        await waitFor(() => {
            expect(app.getPathname()).toBe('/home');
        });
        const october = await ok(core, 'transactions.listByPeriod', { profileId: s.profileId, period: SCENARIO_PERIOD });
        expect(october.find((transaction) => transaction.name === 'Aporte' && transaction.value.amount === 200)).toMatchObject({ type: 'transference', destinationAccountId: s.savingsId, subCategoryId: s.subCategoryId });
    });

    it('edita um lançamento aberto pelo detalhe', async () => {
        const { core } = testCore(SCENARIO_TODAY);
        const s = await seedScenario(core);
        const app = await renderApp(core, { preferences: { lastPeriod: SCENARIO_PERIOD }, initialUrl: `/transactions/${s.expenseId}` });

        await fireEvent.press(await screen.findByRole('button', { name: 'Editar' }));
        const value = await screen.findByLabelText('Valor');
        expect(value).toHaveDisplayValue('2.300,00');
        await fireEvent.changeText(value, '2.450,00');
        await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }));

        await waitFor(() => {
            expect(app.getPathname()).toBe(`/transactions/${s.expenseId}`);
        });
        expect((await ok(core, 'transactions.get', { id: s.expenseId })).value.amount).toBe(2450);
    });
});
