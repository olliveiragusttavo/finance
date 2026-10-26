import { expect, test, type Page } from '@playwright/test';
import { currentPeriod } from '../src/renderer/src/shell/referenceMonth.ts';
import { completeFirstUse } from './firstUse.ts';
import { launchApp, removeUserData } from './launchApp.ts';

/*
 * Melhorias antes do empacotamento (desktop-mvp-plan Fase 13.2) no app empacotado: a listagem
 * única de lançamentos com a situação clicável e a edição no extrato de Contas, o "somente esta"
 * que grava sem a revisão, mover um lançamento para outro perfil pelo campo "Perfil" e os blocos
 * de metas e anotações da Visão geral. Os cliques usam `dispatchEvent`, pelo motivo explicado em
 * `firstUse.ts`.
 */

/**
 * @param page Janela do app, com o shell aberto.
 * @param name Item do menu principal.
 */
async function openMenu(page: Page, name: string): Promise<void> {
    await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name, exact: true }).dispatchEvent('click');
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

/**
 * Semeia pela ponte, no perfil aberto, o aluguel em aberto do dia 5 e a internet fixa mensal do
 * dia 8, as duas na Nubank; e um segundo perfil, "Empresa", com a Conta PJ e a subcategoria
 * Serviços › Software. Pela ponte, e não pela tela: lançar pela tela é coberto em
 * `transactions.spec.ts`.
 *
 * @param page Janela do app, com o shell aberto.
 * @param period Mês de referência `YYYY-MM`.
 * @return O id do perfil da empresa, para conferir o lançamento movido.
 */
async function seedMovements(page: Page, period: string): Promise<string> {
    return page.evaluate(async (period) => {
        const { core } = window.finance;
        const { lastProfileId: profileId } = await window.finance.preferences.get();
        if (profileId === null) {
            throw new Error('nenhum perfil aberto');
        }
        const accounts = await core.call('accounts.list', { profileId, period });
        const tree = await core.call('categories.tree', { profileId });
        const nubank = accounts.ok ? accounts.data.accounts[0] : undefined;
        const subCategory = tree.ok ? tree.data[0]?.subCategories[0] : undefined;
        if (nubank === undefined || subCategory === undefined) {
            throw new Error('cenário incompleto');
        }
        const base = { profileId, subCategoryId: subCategory.id, type: 'expense', source: { kind: 'account', accountId: nubank.id } } as const;
        const rent = await core.call('transactions.create', { ...base, name: 'Aluguel', value: 1200, dueDate: `${period}-05` });
        const internet = await core.call('transactions.create', { ...base, name: 'Internet', value: 100, dueDate: `${period}-08`, repeat: { kind: 'fixed', frequency: 'monthly', endAt: null } });
        const business = await core.call('profiles.create', { name: 'Empresa', type: 'business', currency: 'BRL' });
        if (!rent.ok || !internet.ok || !business.ok) {
            throw new Error('lançamentos ou perfil não criados');
        }
        const account = await core.call('accounts.create', { profileId: business.data.id, name: 'Conta PJ', type: 'checking' });
        const category = await core.call('categories.create', { profileId: business.data.id, name: 'Serviços' });
        if (!account.ok || !category.ok) {
            throw new Error('cadastros da empresa não criados');
        }
        const software = await core.call('subCategories.create', { categoryId: category.data.id, name: 'Software' });
        if (!software.ok) {
            throw new Error('subcategoria da empresa não criada');
        }
        return business.data.id;
    }, period);
}

test('extrato: a situação marca pago, a linha edita, e "somente esta" grava sem a revisão', async () => {
    const { app, window: page, userData } = await launchApp();
    const period = currentPeriod(new Date());
    try {
        await completeFirstUse(page, { profileName: 'Pessoal', accountName: 'Nubank', openingBalance: '1.000,00' });
        await seedMovements(page, period);
        await openMenu(page, 'Contas');

        const movements = page.getByRole('region', { name: 'Movimentos' });
        await movements.getByRole('button', { name: 'Pendente: marcar “Aluguel” como pago' }).dispatchEvent('click');
        await expect(movements.getByRole('row', { name: /Aluguel/ })).toContainText('Pago');
        await expect(page.getByRole('region', { name: 'Resumo do extrato' })).toContainText('Saldo final−R$ 200,00');

        await movements.getByRole('row', { name: /Internet/ }).dispatchEvent('click');
        const form = page.getByRole('dialog', { name: 'Editar Internet' });
        await form.getByLabel('Nome').fill('Internet fibra');
        await form.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');
        const scope = page.getByRole('dialog', { name: 'Salvar “Internet”' });
        await expect(scope.getByRole('radio', { name: 'Somente esta' })).toHaveAttribute('aria-checked', 'true');
        await scope.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');

        await expect(scope).toHaveCount(0);
        await expect(form).toHaveCount(0);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(movements).toContainText('Internet fibra');
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

test('o campo "Perfil" move o lançamento para o outro perfil, com a conta e a categoria de lá', async () => {
    const { app, window: page, userData } = await launchApp();
    const period = currentPeriod(new Date());
    try {
        await completeFirstUse(page, { profileName: 'Pessoal', accountName: 'Nubank' });
        const businessId = await seedMovements(page, period);
        // O seletor de perfis do shell foi lido antes de a empresa existir.
        await page.reload();
        await openMenu(page, 'Transações');

        await page.getByRole('row', { name: /Aluguel/ }).dispatchEvent('click');
        const form = page.getByRole('dialog', { name: 'Editar Aluguel' });
        await form.getByLabel('Perfil').press('Enter');
        await page.getByRole('option', { name: 'Empresa', exact: true }).dispatchEvent('click');
        await expect(form.getByLabel('Perfil')).toHaveAccessibleDescription('Ao salvar, o lançamento sai de Pessoal e vai para Empresa, com a conta, a categoria e as tags escolhidas lá.');
        await expect(form.getByLabel('Conta ou cartão')).toHaveText('Escolha a conta ou o cartão');
        // Travado enquanto os cadastros da empresa carregam.
        await expect(form.getByLabel('Conta ou cartão')).toBeEnabled();
        await form.getByLabel('Conta ou cartão').press('Enter');
        await page.getByRole('option', { name: 'Conta PJ', exact: true }).dispatchEvent('click');
        await form.getByLabel('Categoria', { exact: true }).dispatchEvent('click');
        const search = page.getByRole('combobox', { name: 'Buscar categoria' });
        await search.fill('softw');
        await search.press('Enter');
        await expect(form.getByLabel('Categoria', { exact: true })).toHaveText('Serviços › Software');
        await form.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');

        await expect(form).toHaveCount(0);
        await expect(page.getByText('“Aluguel” movido para Empresa.')).toBeVisible();
        await expect(page.getByRole('region', { name: 'Lançamentos do mês' })).not.toContainText('Aluguel');
        const moved = await page.evaluate(
            async ({ profileId, period }) => {
                const result = await window.finance.core.call('transactions.listByPeriod', { profileId, period });
                return result.ok ? result.data.map((transaction) => transaction.name) : [];
            },
            { profileId: businessId, period },
        );
        expect(moved).toEqual(['Aluguel']);
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

test('visão geral: o resumo das metas e os títulos das anotações, que abrem a anotação na tela Anotações', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        await completeFirstUse(page, { profileName: 'Pessoal', accountName: 'Nubank' });
        await page.evaluate(async () => {
            const { core } = window.finance;
            const { lastProfileId: profileId } = await window.finance.preferences.get();
            if (profileId === null) {
                throw new Error('nenhum perfil aberto');
            }
            await core.call('goals.create', { profileId, name: 'Reserva', value: 10000, targetDate: null });
            await core.call('notes.create', { profileId, text: 'Senha do wi-fi\nna caixa do roteador' });
            await core.call('notes.create', { profileId, text: 'IPTU 2027\nparcelar em 10x' });
        });
        await page.reload();
        await expect(page.getByRole('heading', { name: 'Visão geral', level: 1 })).toBeVisible();

        const goals = page.getByRole('list', { name: 'Metas' });
        await expect(goals.getByRole('link', { name: /^Reserva/ })).toContainText('0%');
        await expect(goals).toContainText('R$ 0,00 de R$ 10.000,00 · sem data-alvo');
        const notes = page.getByRole('list', { name: 'Anotações' });
        // Criadas no mesmo segundo pela ponte: a ordem entre as duas é o desempate do núcleo.
        await expect(notes.getByRole('link')).toHaveCount(2);
        await expect(notes.getByRole('link', { name: 'IPTU 2027', exact: true })).toBeVisible();

        await notes.getByRole('link', { name: 'Senha do wi-fi' }).dispatchEvent('click');
        await expect(page).toHaveURL(/#\/notes\?.*note=/);
        await expect(page.getByLabel('Anotação', { exact: true })).toHaveValue('Senha do wi-fi\nna caixa do roteador');
    } finally {
        await app.close();
        removeUserData(userData);
    }
});
