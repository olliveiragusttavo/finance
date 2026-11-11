import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { renderApp } from './support/renderApp.tsx';
import { testCore } from './support/renderWithCore.tsx';
import { ok, SCENARIO_PERIOD, SCENARIO_TODAY, seedScenario } from './support/scenario.ts';

jest.mock('expo-file-system', () => ({ Paths: {} }));

/**
 * @return O núcleo com o cenário e o app aberto na aba Transações de outubro.
 */
async function openTransactions(): Promise<{ readonly core: ReturnType<typeof testCore>['core']; readonly s: Awaited<ReturnType<typeof seedScenario>>; readonly app: Awaited<ReturnType<typeof renderApp>> }> {
    const { core } = testCore(SCENARIO_TODAY);
    const s = await seedScenario(core);
    const app = await renderApp(core, { preferences: { lastPeriod: SCENARIO_PERIOD }, initialUrl: '/transactions' });
    await screen.findByRole('button', { name: /^Salário, / });
    return { core, s, app };
}

describe('Transações (mobile-mvp-plan, Fase 9)', () => {
    it('lista o mês por dia, com as compras do cartão na linha da fatura e os totais', async () => {
        await openTransactions();

        expect(screen.getByText('Qui, 01/10')).toBeOnTheScreen();
        expect(screen.getByRole('button', { name: /^Fatura Roxinho · set, / })).toBeOnTheScreen();
        expect(screen.queryByRole('button', { name: /^Supermercado, / })).toBeNull();
        const summary = screen.getByText('↑ Entradas').parent?.parent;
        if (summary === null || summary === undefined) {
            throw new Error('sem o resumo do mês');
        }
        expect(within(summary).getByText('+R$ 9.500,00')).toBeOnTheScreen();
        expect(within(summary).getByText('−R$ 2.420,00')).toBeOnTheScreen();
        expect(within(summary).getByText('+R$ 7.080,00')).toBeOnTheScreen();
    });

    it('a busca desfaz o agrupamento e acha a compra no cartão', async () => {
        await openTransactions();

        await fireEvent.press(screen.getByRole('button', { name: 'Buscar' }));
        await fireEvent.changeText(screen.getByLabelText('Buscar lançamentos'), 'super');

        expect(await screen.findByRole('button', { name: /^Supermercado, / })).toBeOnTheScreen();
        expect(screen.queryByRole('button', { name: /^Salário, / })).toBeNull();
    });

    it('filtra pela situação numa folha e conta o filtro ativo', async () => {
        await openTransactions();

        await fireEvent.press(screen.getByRole('button', { name: 'Filtrar, nenhum filtro ativo' }));
        await fireEvent.press(screen.getByRole('button', { name: 'Situação: Todas as situações' }));
        // A escolha abre uma segunda folha por cima da de filtros: a última é a da situação.
        const sheet = screen.getAllByTestId('bottom-sheet').at(-1);
        if (sheet === undefined) {
            throw new Error('a folha da situação não abriu');
        }
        await fireEvent.press(within(sheet).getByRole('radio', { name: 'Pendente' }));

        expect(await screen.findByRole('button', { name: 'Filtrar, 1 filtro ativo' })).toBeOnTheScreen();
        await waitFor(() => {
            expect(screen.queryByRole('button', { name: /^Salário, / })).toBeNull();
        });
        expect(screen.getByRole('button', { name: /^Aluguel, / })).toBeOnTheScreen();
    });

    it('o detalhe marca como pago e volta a pendente', async () => {
        const { core, s, app } = await openTransactions();

        await fireEvent.press(screen.getByRole('button', { name: /^Aluguel, / }));
        expect(app.getPathname()).toBe(`/transactions/${s.expenseId}`);
        expect(await screen.findByText('Despesa')).toBeOnTheScreen();

        await fireEvent.press(screen.getByRole('button', { name: 'Marcar como pago' }));
        expect(await screen.findByRole('button', { name: 'Voltar a pendente' })).toBeOnTheScreen();
        expect((await ok(core, 'transactions.get', { id: s.expenseId })).paid).toBe(true);

        await fireEvent.press(screen.getByRole('button', { name: 'Voltar a pendente' }));
        expect(await screen.findByRole('button', { name: 'Marcar como pago' })).toBeOnTheScreen();
    });

    it('a compra no cartão não se paga pelo detalhe: segue a fatura', async () => {
        const { s } = await openTransactions();
        await fireEvent.press(screen.getByRole('button', { name: 'Buscar' }));
        await fireEvent.changeText(screen.getByLabelText('Buscar lançamentos'), 'super');
        await fireEvent.press(await screen.findByRole('button', { name: /^Supermercado, / }));

        expect(await screen.findByText(/A situação de uma compra no cartão é a da fatura/)).toBeOnTheScreen();
        expect(screen.queryByRole('button', { name: 'Marcar como pago' })).toBeNull();
        expect(s.purchaseId).not.toBe('');
    });

    it('exclui um lançamento avulso depois de confirmar e volta à lista', async () => {
        const { core, s, app } = await openTransactions();
        await fireEvent.press(screen.getByRole('button', { name: /^Aluguel, / }));

        await fireEvent.press(await screen.findByRole('button', { name: 'Excluir' }));
        await fireEvent.press(within(screen.getByTestId('bottom-sheet')).getByRole('button', { name: 'Excluir lançamento' }));

        await waitFor(() => {
            expect(app.getPathname()).toBe('/transactions');
        });
        expect((await core.call('transactions.get', { id: s.expenseId })).ok).toBe(false);
    });
});
