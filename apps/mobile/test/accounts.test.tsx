import { formatMoney } from '@finance/client';
import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { fixToday, restoreToday } from './support/fixedToday.ts';
import { renderApp } from './support/renderApp.tsx';
import { testCore } from './support/renderWithCore.tsx';
import { ok, SCENARIO_PERIOD, SCENARIO_TODAY, seedScenario, type Scenario } from './support/scenario.ts';

jest.mock('expo-file-system', () => ({ Paths: {} }));

/** O que os testes de Contas usam: o núcleo, os ids do cenário e o app aberto. */
interface OpenedAccounts {
    readonly core: ReturnType<typeof testCore>['core'];
    readonly s: Scenario;
    readonly app: Awaited<ReturnType<typeof renderApp>>;
}

/**
 * @return O núcleo com o cenário, a Nubank como conta padrão, e o app aberto na aba Contas de
 * outubro.
 */
async function openAccounts(): Promise<OpenedAccounts> {
    fixToday(2026, 10, 15);
    const { core } = testCore(SCENARIO_TODAY);
    const s = await seedScenario(core);
    await ok(core, 'profiles.setDefaultAccount', { profileId: s.profileId, accountId: s.checkingId });
    const app = await renderApp(core, { preferences: { lastPeriod: SCENARIO_PERIOD }, initialUrl: '/accounts' });
    await screen.findByRole('button', { name: /^Nubank, / });
    return { core, s, app };
}

/**
 * Abre o extrato de uma conta pela lista, como o usuário faz, e espera o resumo carregar.
 *
 * @param opened O app aberto em Contas.
 * @param name Nome da conta.
 * @param id Id da conta, para conferir o caminho.
 */
async function openStatement(opened: OpenedAccounts, name: string, id: string): Promise<void> {
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${name}, `) }));
    await waitFor(() => {
        expect(opened.app.getPathname()).toBe(`/accounts/${id}`);
    });
    await screen.findByText('Saldo inicial');
}

/**
 * @return A última folha aberta, onde estão os botões da ação da vez.
 * @throws {Error} Quando nenhuma folha está aberta.
 */
function lastSheet(): ReturnType<typeof screen.getByTestId> {
    const sheet = screen.getAllByTestId('bottom-sheet').at(-1);
    if (sheet === undefined) {
        throw new Error('nenhuma folha aberta');
    }
    return sheet;
}

/**
 * Lê o Tesouro como o núcleo o tem agora; não há rota que leia uma conta só.
 *
 * @param core Núcleo do teste.
 * @param s Ids do cenário.
 * @return A conta de investimento do cenário.
 * @throws {Error} Quando a conta não está mais na lista.
 */
async function savings(core: OpenedAccounts['core'], s: Scenario): Promise<Awaited<ReturnType<typeof ok<'accounts.list'>>>['accounts'][number]> {
    const list = await ok(core, 'accounts.list', { profileId: s.profileId, period: SCENARIO_PERIOD });
    const account = list.accounts.find((candidate) => candidate.id === s.savingsId);
    if (account === undefined) {
        throw new Error('sem a conta de investimento');
    }
    return account;
}

afterEach(restoreToday);

describe('Contas (mobile-mvp-plan, Fase 12)', () => {
    it('lista as contas com o saldo do fim do mês, o selo Padrão e os totais do núcleo', async () => {
        const { core, s } = await openAccounts();
        const list = await ok(core, 'accounts.list', { profileId: s.profileId, period: SCENARIO_PERIOD });
        const checking = list.accounts.find((account) => account.id === s.checkingId);
        if (checking === undefined) {
            throw new Error('sem a conta corrente');
        }

        expect(screen.getByRole('button', { name: `Nubank, padrão, Corrente, ${formatMoney(checking.balances.consolidated)}, previsto ${formatMoney(checking.balances.projected)}` })).toBeOnTheScreen();
        expect(screen.getByRole('button', { name: /^Tesouro, Investimentos, / })).toBeOnTheScreen();
        const totals = screen.getByLabelText('Totais do perfil');
        expect(within(totals).getByText(formatMoney(list.total.consolidated))).toBeOnTheScreen();
        expect(within(totals).getByText(formatMoney(list.total.projected))).toBeOnTheScreen();
    });

    it('cria uma conta pelo + e abre o extrato dela', async () => {
        const { core, s, app } = await openAccounts();

        await fireEvent.press(screen.getByRole('button', { name: 'Adicionar conta' }));
        await fireEvent.changeText(screen.getByLabelText('Nome da conta'), 'Inter');
        await fireEvent.changeText(screen.getByLabelText('Saldo inicial'), '250,00');
        await fireEvent.press(screen.getByRole('button', { name: 'Criar conta' }));

        await waitFor(() => {
            expect(app.getPathname()).toMatch(/^\/accounts\/[^/]+$/);
        });
        expect(await screen.findByText('Inter')).toBeOnTheScreen();
        const list = await ok(core, 'accounts.list', { profileId: s.profileId, period: SCENARIO_PERIOD });
        expect(list.accounts.find((account) => account.name === 'Inter')).toMatchObject({ type: 'checking', considerBalance: true, openingBalance: { amount: 250 } });
    });

    it('recusa a conta sem nome, com a mensagem no campo', async () => {
        await openAccounts();

        await fireEvent.press(screen.getByRole('button', { name: 'Adicionar conta' }));
        await fireEvent.press(screen.getByRole('button', { name: 'Criar conta' }));

        expect(await screen.findByLabelText(/^Nome da conta\. /)).toBeOnTheScreen();
    });

    it('o extrato mostra o resumo e os movimentos, e o lançamento abre o detalhe na aba Contas', async () => {
        const opened = await openAccounts();
        const { core, s, app } = opened;
        await openStatement(opened, 'Nubank', s.checkingId);
        const statement = await ok(core, 'statements.get', { accountId: s.checkingId, period: SCENARIO_PERIOD });

        const summary = screen.getByLabelText('Resumo do extrato');
        expect(within(summary).getByText(formatMoney(statement.closing.consolidated, 'negative'))).toBeOnTheScreen();
        expect(within(summary).getByText(formatMoney(statement.inflows.consolidated, 'always'))).toBeOnTheScreen();
        expect(screen.getByRole('button', { name: /^Salário, 01\/10, / })).toBeOnTheScreen();
        expect(screen.getByRole('button', { name: /^Fatura Roxinho · set, / })).toBeOnTheScreen();

        await fireEvent.press(screen.getByRole('button', { name: /^Aluguel, / }));
        await waitFor(() => {
            expect(app.getPathname()).toBe(`/accounts/transaction/${s.expenseId}`);
        });
        expect(await screen.findByText('Despesa')).toBeOnTheScreen();
    });

    it('desativa a conta, que passa para a seção à parte, e a reativa', async () => {
        const opened = await openAccounts();
        const { core, s } = opened;
        await openStatement(opened, 'Tesouro', s.savingsId);

        await fireEvent.press(screen.getByRole('button', { name: 'Ações da conta' }));
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Desativar conta' }));
        expect(await screen.findByText('Conta de investimentos · entra no saldo total · desativada')).toBeOnTheScreen();
        expect((await savings(core, s)).disabled).toBe(true);

        await fireEvent.press(screen.getByRole('button', { name: 'Voltar' }));
        expect(await screen.findByText('Desativadas')).toBeOnTheScreen();

        await openStatement(opened, 'Tesouro', s.savingsId);
        await fireEvent.press(screen.getByRole('button', { name: 'Ações da conta' }));
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Reativar conta' }));
        await waitFor(() => {
            expect(screen.queryByText(/desativada$/)).toBeNull();
        });
        expect((await savings(core, s)).disabled).toBe(false);
    });

    it('troca a conta padrão do perfil', async () => {
        const opened = await openAccounts();
        const { core, s } = opened;
        await openStatement(opened, 'Tesouro', s.savingsId);

        await fireEvent.press(screen.getByRole('button', { name: 'Ações da conta' }));
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Usar como conta padrão (débito)' }));
        await waitFor(() => {
            expect(screen.queryAllByTestId('bottom-sheet')).toHaveLength(0);
        });
        await fireEvent.press(screen.getByRole('button', { name: 'Voltar' }));

        expect(await screen.findByRole('button', { name: /^Tesouro, padrão, / })).toBeOnTheScreen();
        expect(screen.getByRole('button', { name: /^Nubank, Corrente, / })).toBeOnTheScreen();
        const profiles = await ok(core, 'profiles.list', {});
        expect(profiles.find((profile) => profile.id === s.profileId)?.defaultAccountId).toBe(s.savingsId);
    });

    it('edita o nome da conta', async () => {
        const opened = await openAccounts();
        const { core, s } = opened;
        await openStatement(opened, 'Tesouro', s.savingsId);

        await fireEvent.press(screen.getByRole('button', { name: 'Ações da conta' }));
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Editar conta' }));
        await fireEvent.changeText(screen.getByLabelText('Nome da conta'), 'Tesouro Selic');
        await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }));

        expect(await screen.findByText('Tesouro Selic')).toBeOnTheScreen();
        expect((await savings(core, s)).name).toBe('Tesouro Selic');
    });

    it('exclui em cadeia só depois de mostrar o impacto e de digitar o nome', async () => {
        const opened = await openAccounts();
        const { core, s, app } = opened;
        await openStatement(opened, 'Tesouro', s.savingsId);

        await fireEvent.press(screen.getByRole('button', { name: 'Ações da conta' }));
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Excluir conta…' }));
        expect(await screen.findByText('• 1 transferência ou investimento recebido de outra conta')).toBeOnTheScreen();
        expect(screen.getByText('O saldo desta outra conta vai mudar: Nubank.')).toBeOnTheScreen();
        expect(screen.getByRole('button', { name: 'Excluir conta' })).toBeDisabled();

        await fireEvent.changeText(screen.getByLabelText('Digite Tesouro para confirmar'), 'Tesouro');
        await fireEvent.press(screen.getByRole('button', { name: 'Excluir conta' }));

        await waitFor(() => {
            expect(app.getPathname()).toBe('/accounts');
        });
        await waitFor(() => {
            expect(screen.queryByRole('button', { name: /^Tesouro, / })).toBeNull();
        });
        const list = await ok(core, 'accounts.list', { profileId: s.profileId, period: SCENARIO_PERIOD });
        expect(list.accounts.map((account) => account.id)).not.toContain(s.savingsId);
    });
});
