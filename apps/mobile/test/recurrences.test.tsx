import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { fixToday, restoreToday } from './support/fixedToday.ts';
import { renderApp } from './support/renderApp.tsx';
import { testCore } from './support/renderWithCore.tsx';
import { ok, SCENARIO_PERIOD, SCENARIO_TODAY, seedScenario } from './support/scenario.ts';

jest.mock('expo-file-system', () => ({ Paths: {} }));

/** @return A folha aberta por último. */
function lastSheet(): ReturnType<typeof screen.getByTestId> {
    const sheet = screen.getAllByTestId('bottom-sheet').at(-1);
    if (sheet === undefined) {
        throw new Error('nenhuma folha aberta');
    }
    return sheet;
}

afterEach(restoreToday);

describe('recorrências (mobile-mvp-plan, Fase 11)', () => {
    it('parcela em 3x, revisa o que será lançado e grava a série', async () => {
        fixToday(2026, 10, 15);
        const { core } = testCore(SCENARIO_TODAY);
        const s = await seedScenario(core);
        await ok(core, 'profiles.setDefaultAccount', { profileId: s.profileId, accountId: s.checkingId });
        const app = await renderApp(core, { preferences: { lastPeriod: SCENARIO_PERIOD } });
        await fireEvent.press(await screen.findByRole('button', { name: 'Novo lançamento' }));

        await fireEvent.changeText(await screen.findByLabelText('Valor'), '300');
        await fireEvent.press(screen.getByRole('button', { name: 'Categoria: Escolha a categoria' }));
        await fireEvent.press(within(lastSheet()).getByRole('radio', { name: 'Alimentação › Mercado' }));
        await fireEvent.changeText(screen.getByLabelText('Nome'), 'Geladeira');
        await fireEvent.press(screen.getByRole('button', { name: 'Repetir ou parcelar: Não repetir' }));
        await fireEvent.press(within(lastSheet()).getByRole('radio', { name: 'Parcelado' }));
        await fireEvent.changeText(within(lastSheet()).getByLabelText('Parcelas'), '3');
        expect(await within(lastSheet()).findByLabelText('Prévia')).toBeOnTheScreen();
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Pronto' }));
        await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }));

        expect(await screen.findByText('Revisar o lançamento')).toBeOnTheScreen();
        await waitFor(() => {
            expect(within(lastSheet()).getByRole('button', { name: 'Lançar' })).toBeEnabled();
        });
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Lançar' }));

        await waitFor(() => {
            expect(app.getPathname()).toBe('/home');
        });
        const recurrences = await ok(core, 'recurrences.list', { profileId: s.profileId });
        const series = recurrences.find((recurrence) => recurrence.kind === 'installments');
        expect(series).toBeDefined();
        const occurrences = await ok(core, 'recurrences.occurrences', { recurrenceId: series?.id ?? '' });
        expect(occurrences.map((occurrence) => occurrence.value.amount)).toEqual([100, 100, 100]);
    });

    /**
     * @return O cenário com o aluguel fixo mensal de outubro a dezembro e o app aberto no detalhe
     * da ocorrência de novembro.
     */
    async function openFixedRent(): Promise<{ readonly core: ReturnType<typeof testCore>['core']; readonly ids: readonly string[]; readonly app: Awaited<ReturnType<typeof renderApp>> }> {
        const { core } = testCore(SCENARIO_TODAY);
        const s = await seedScenario(core);
        const first = await ok(core, 'transactions.create', {
            profileId: s.profileId,
            subCategoryId: s.subCategoryId,
            type: 'expense',
            source: { kind: 'account', accountId: s.checkingId },
            name: 'Condomínio',
            value: 800,
            dueDate: '2026-10-20',
            repeat: { kind: 'fixed', frequency: 'monthly', endAt: '2026-12-20' },
        });
        const occurrences = await ok(core, 'recurrences.occurrences', { recurrenceId: first.recurrenceId ?? '' });
        const ids = occurrences.map((occurrence) => occurrence.id);
        const app = await renderApp(core, { preferences: { lastPeriod: '2026-11' }, initialUrl: `/transactions/${ids[1] ?? ''}` });
        await screen.findByText('Condomínio');
        return { core, ids, app };
    }

    it('edita só esta ocorrência da série', async () => {
        const { core, ids, app } = await openFixedRent();

        await fireEvent.press(screen.getByRole('button', { name: 'Editar' }));
        await fireEvent.changeText(await screen.findByLabelText('Valor'), '850');
        await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }));
        await fireEvent.press(await within(lastSheet()).findByRole('radio', { name: /^Somente esta/ }));
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Salvar' }));

        await waitFor(() => {
            expect(app.getPathname()).toBe(`/transactions/${ids[1] ?? ''}`);
        });
        expect((await ok(core, 'transactions.get', { id: ids[1] ?? '' })).value.amount).toBe(850);
        expect((await ok(core, 'transactions.get', { id: ids[2] ?? '' })).value.amount).toBe(800);
    });

    it('exclui esta e as futuras depois de revisar', async () => {
        const { core, ids, app } = await openFixedRent();

        await fireEvent.press(screen.getByRole('button', { name: 'Excluir' }));
        await fireEvent.press(await within(lastSheet()).findByRole('radio', { name: /^Esta e as futuras/ }));
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Continuar' }));
        expect(await screen.findByText('Revisar a exclusão')).toBeOnTheScreen();
        // O botão só habilita com o ensaio do núcleo carregado.
        expect(await within(lastSheet()).findByText('2 transações serão excluídas')).toBeOnTheScreen();
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Excluir' }));

        // O detalhe aberto por link volta ao Início; aberto pela lista, volta a ela.
        await waitFor(() => {
            expect(app.getPathname()).not.toBe(`/transactions/${ids[1] ?? ''}`);
        });
        expect((await core.call('transactions.get', { id: ids[0] ?? '' })).ok).toBe(true);
        expect((await core.call('transactions.get', { id: ids[1] ?? '' })).ok).toBe(false);
        expect((await core.call('transactions.get', { id: ids[2] ?? '' })).ok).toBe(false);
    });
});
