import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { fixToday, restoreToday } from './support/fixedToday.ts';
import { renderApp } from './support/renderApp.tsx';
import { testCore } from './support/renderWithCore.tsx';
import { ok, SCENARIO_PERIOD, SCENARIO_TODAY, seedScenario, type Scenario } from './support/scenario.ts';

jest.mock('expo-file-system', () => ({ Paths: {} }));

/** O que os testes de Cadastros usam: o núcleo, os ids do cenário e o app aberto. */
interface OpenedRegistries {
    readonly core: ReturnType<typeof testCore>['core'];
    readonly s: Scenario;
    readonly app: Awaited<ReturnType<typeof renderApp>>;
}

/**
 * Abre o app em Mais e entra em Cadastros, como o usuário faz.
 *
 * @return O núcleo com o cenário e o índice de Cadastros aberto.
 */
async function openRegistries(): Promise<OpenedRegistries> {
    fixToday(2026, 10, 15);
    const { core } = testCore(SCENARIO_TODAY);
    const s = await seedScenario(core);
    // O perfil guardado no aparelho, como o primeiro uso deixa: sem ele, o perfil novo, primeiro
    // por nome, viraria o ativo ao ser criado.
    const app = await renderApp(core, { preferences: { lastPeriod: SCENARIO_PERIOD, lastProfileId: s.profileId }, initialUrl: '/more' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Cadastros' }));
    await screen.findByRole('button', { name: /^Categorias, / });
    return { core, s, app };
}

/**
 * Entra em Categorias e abre Alimentação, a categoria do cenário.
 *
 * @param opened O app aberto em Cadastros.
 */
async function openFood(opened: OpenedRegistries): Promise<void> {
    await fireEvent.press(screen.getByRole('button', { name: /^Categorias, / }));
    await fireEvent.press(await screen.findByRole('button', { name: /^Alimentação, / }));
    await waitFor(() => {
        expect(opened.app.getPathname()).toBe(`/more/category/${opened.s.categoryId}`);
    });
    await screen.findByText('Lançamentos (todo o período)');
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

describe('Cadastros (mobile-mvp-plan, Fase 15)', () => {
    it('o índice conta cada cadastro e leva Contas à aba dela', async () => {
        const { app } = await openRegistries();

        expect(await screen.findByRole('button', { name: 'Contas, 2' })).toBeOnTheScreen();
        expect(screen.getByRole('button', { name: 'Categorias, 1 categoria · 2 subcategorias' })).toBeOnTheScreen();
        expect(screen.getByRole('button', { name: 'Perfis, 1' })).toBeOnTheScreen();
        expect(screen.getByText('Sócios aparecem aqui só no perfil empresarial.')).toBeOnTheScreen();

        await fireEvent.press(screen.getByRole('button', { name: 'Contas, 2' }));
        await waitFor(() => {
            expect(app.getPathname()).toBe('/accounts');
        });
    });

    it('busca a categoria pela subcategoria e cria uma categoria nova, que abre com a primeira subcategoria', async () => {
        const { core, s, app } = await openRegistries();
        await fireEvent.press(screen.getByRole('button', { name: /^Categorias, / }));

        await fireEvent.changeText(await screen.findByLabelText('Buscar categoria ou subcategoria'), 'restau');
        expect(screen.getByRole('button', { name: /^Alimentação, / })).toBeOnTheScreen();
        await fireEvent.changeText(screen.getByLabelText('Buscar categoria ou subcategoria'), 'xyz');
        expect(await screen.findByText('Nenhuma categoria encontrada')).toBeOnTheScreen();

        await fireEvent.press(screen.getByRole('button', { name: 'Nova categoria' }));
        await fireEvent.changeText(screen.getByLabelText('Nome da categoria'), 'Moradia');
        await fireEvent.press(screen.getByRole('button', { name: 'Criar categoria' }));
        await waitFor(() => {
            expect(app.getPathname()).toMatch(/^\/more\/category\/[^/]+$/);
        });
        await fireEvent.changeText(await screen.findByLabelText('Nova subcategoria em Moradia'), 'Aluguel');
        await fireEvent.press(screen.getByRole('button', { name: 'Adicionar subcategoria' }));

        expect(await screen.findByRole('button', { name: 'Aluguel, 0 lançamentos' })).toBeOnTheScreen();
        const tree = await ok(core, 'categories.tree', { profileId: s.profileId });
        expect(tree.find((branch) => branch.name === 'Moradia')?.subCategories.map((sub) => sub.name)).toEqual(['Aluguel']);
    });

    it('recusa a subcategoria repetida, com a mensagem do núcleo no campo', async () => {
        const opened = await openRegistries();
        await openFood(opened);

        await fireEvent.changeText(screen.getByLabelText('Nova subcategoria em Alimentação'), 'mercado');
        await fireEvent.press(screen.getByRole('button', { name: 'Adicionar subcategoria' }));

        expect(await screen.findByLabelText(/^Nova subcategoria em Alimentação\. /)).toBeOnTheScreen();
    });

    it('Regra de negócio (Categorias): excluir a subcategoria em uso move os lançamentos para a escolhida', async () => {
        const opened = await openRegistries();
        const { core, s } = opened;
        await openFood(opened);

        await fireEvent.press(screen.getByRole('button', { name: /^Mercado, / }));
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Excluir subcategoria…' }));
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Mover e excluir' }));
        expect(await screen.findByText('Escolha para onde mover os lançamentos.')).toBeOnTheScreen();

        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Mover para: Escolher' }));
        await fireEvent.press(within(lastSheet()).getByRole('radio', { name: 'Alimentação › Restaurantes' }));
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Mover e excluir' }));

        await waitFor(() => {
            expect(screen.queryByRole('button', { name: /^Mercado, / })).toBeNull();
        });
        const october = await ok(core, 'transactions.listByPeriod', { profileId: s.profileId, period: SCENARIO_PERIOD });
        expect(october.length).toBeGreaterThan(0);
        expect(october.every((transaction) => transaction.subCategoryId === s.otherSubCategoryId)).toBe(true);
    });

    it('renomeia a categoria pelo ⋯', async () => {
        const opened = await openRegistries();
        const { core, s } = opened;
        await openFood(opened);

        await fireEvent.press(screen.getByRole('button', { name: 'Ações da categoria' }));
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Renomear' }));
        await fireEvent.changeText(screen.getByLabelText('Nome da categoria'), 'Comida');
        await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }));

        expect(await screen.findByText('Comida')).toBeOnTheScreen();
        const tree = await ok(core, 'categories.tree', { profileId: s.profileId });
        expect(tree.map((branch) => branch.name)).toEqual(['Comida']);
    });

    it('cria um perfil empresarial, que aparece com "Abrir", e o abre', async () => {
        const { core } = await openRegistries();
        await fireEvent.press(screen.getByRole('button', { name: 'Perfis, 1' }));

        await fireEvent.press(await screen.findByRole('button', { name: 'Novo perfil' }));
        await fireEvent.changeText(screen.getByLabelText('Nome do perfil'), 'Estúdio');
        await fireEvent.press(screen.getByRole('radio', { name: 'Empresarial' }));
        expect(screen.getByText(/^Perfil empresarial: tem sócios/)).toBeOnTheScreen();
        await fireEvent.press(screen.getByRole('button', { name: 'Criar perfil' }));

        await fireEvent.press(await screen.findByRole('button', { name: 'Abrir Estúdio' }));
        expect(await screen.findByRole('button', { name: /^Editar Estúdio, em uso, / })).toBeOnTheScreen();
        const profiles = await ok(core, 'profiles.list', {});
        expect(profiles.find((profile) => profile.name === 'Estúdio')).toMatchObject({ type: 'business', currency: 'BRL' });
    });

    it('Regra de negócio (Perfis): a moeda não muda com lançamentos, e a recusa aparece na moeda', async () => {
        const { core, s } = await openRegistries();
        await fireEvent.press(screen.getByRole('button', { name: 'Perfis, 1' }));

        await fireEvent.press(await screen.findByRole('button', { name: /^Editar Pessoal, / }));
        await fireEvent.press(screen.getByRole('button', { name: 'Moeda: BRL — Real' }));
        await fireEvent.press(within(lastSheet()).getByRole('radio', { name: /USD/ }));
        await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }));

        expect(await screen.findByText('A moeda do perfil não pode mudar depois que há lançamentos.')).toBeOnTheScreen();
        const profiles = await ok(core, 'profiles.list', {});
        expect(profiles.find((profile) => profile.id === s.profileId)?.currency).toBe('BRL');
    });
});
