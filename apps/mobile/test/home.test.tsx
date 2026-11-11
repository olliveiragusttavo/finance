import { fireEvent, screen, within } from 'expo-router/testing-library';
import { renderApp } from './support/renderApp.tsx';
import { testCore } from './support/renderWithCore.tsx';
import { ok, SCENARIO_PERIOD, SCENARIO_TODAY, seedScenario } from './support/scenario.ts';

jest.mock('expo-file-system', () => ({ Paths: {} }));

describe('Início (mobile-mvp-plan, Fase 8)', () => {
    it('mostra os atrasados no topo, com o valor de cada um e o que ainda vence no mês', async () => {
        const { core } = testCore(SCENARIO_TODAY);
        await seedScenario(core);

        await renderApp(core, { preferences: { lastPeriod: SCENARIO_PERIOD } });

        expect(await screen.findByText(/⚠ 2 atrasados/)).toBeOnTheScreen();
        expect(screen.getByRole('button', { name: 'Marcar como pago: Aluguel' })).toBeOnTheScreen();
        expect(screen.getByText('−R$ 2.300,00')).toBeOnTheScreen();
        expect(screen.getByRole('button', { name: 'Marcar como pago: Aporte' })).toBeOnTheScreen();
        expect(screen.getByText('Nada mais vence até 31/10.')).toBeOnTheScreen();
    });

    it('marca um atrasado como pago e desfaz', async () => {
        const { core } = testCore(SCENARIO_TODAY);
        const s = await seedScenario(core);
        await renderApp(core, { preferences: { lastPeriod: SCENARIO_PERIOD } });

        await fireEvent.press(await screen.findByRole('button', { name: 'Marcar como pago: Aluguel' }));

        expect(await screen.findByText('Aluguel marcado como pago em 15/10/2026.')).toBeOnTheScreen();
        expect((await ok(core, 'transactions.get', { id: s.expenseId })).paymentDate).toBe(SCENARIO_TODAY);
        expect(screen.queryByRole('button', { name: 'Marcar como pago: Aluguel' })).toBeNull();

        await fireEvent.press(screen.getByRole('button', { name: 'Desfazer' }));

        expect(await screen.findByRole('button', { name: 'Marcar como pago: Aluguel' })).toBeOnTheScreen();
        expect((await ok(core, 'transactions.get', { id: s.expenseId })).paymentDate).toBeNull();
    });

    it('sem atraso, diz "Nada atrasado"', async () => {
        const { core } = testCore('2026-03-15');
        await ok(core, 'onboarding.start', { profile: { name: 'Pessoal', type: 'personal', currency: 'BRL' }, account: { name: 'Nubank', type: 'checking' } });

        await renderApp(core);

        expect(await screen.findByText(/✓ Nada atrasado/)).toBeOnTheScreen();
    });

    it('saldo consolidado com o previsto, as contas fora do total à parte e a fatura do mês', async () => {
        const { core } = testCore(SCENARIO_TODAY);
        const s = await seedScenario(core);
        await ok(core, 'accounts.update', { id: s.savingsId, name: 'Tesouro', type: 'investment', currencyLabel: null, considerBalance: false, openingBalance: 0 });
        await renderApp(core, { preferences: { lastPeriod: SCENARIO_PERIOD } });

        const accounts = await ok(core, 'accounts.list', { profileId: s.profileId, period: SCENARIO_PERIOD });
        expect(await screen.findByText('Saldo consolidado')).toBeOnTheScreen();
        expect(screen.getByRole('button', { name: /^Nubank, / })).toBeOnTheScreen();
        expect(screen.getByText('Fora do saldo total')).toBeOnTheScreen();
        expect(screen.getByRole('button', { name: /^Tesouro, / })).toBeOnTheScreen();
        expect(accounts.total.consolidated.amount).toBeGreaterThan(0);
        const cards = screen.getByText('Cartões · fatura do mês').parent?.parent;
        expect(cards === null || cards === undefined ? null : within(cards).getByText('Roxinho')).toBeOnTheScreen();
    });
});
