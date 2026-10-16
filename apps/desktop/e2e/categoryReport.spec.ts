import { expect, test, type Locator, type Page } from '@playwright/test';
import { formatMonthAbbreviation, formatMonthShort } from '@finance/client';
import { currentPeriod, shiftPeriod } from '../src/renderer/src/shell/referenceMonth.ts';
import { completeFirstUse } from './firstUse.ts';
import { launchApp, removeUserData } from './launchApp.ts';

/*
 * Relatório por categoria (desktop-mvp-plan Fase 11) no app empacotado: a tabela expansível com a
 * comparação, o drill-down pela tabela, pelo gráfico e pela trilha, a lista de lançamentos pelo mês
 * do pagamento e o "Abrir em Transações". Os cliques usam `dispatchEvent`, pelo motivo explicado em
 * `firstUse.ts`.
 */

/**
 * Semeia pela ponte, em Alimentação: no mês corrente, a Feira do mês anterior no cartão Roxinho
 * (fecha 3, vence 10) numa fatura paga no dia 2, o Supermercado pendente na Nubank e o Jantar pago
 * com a tag "aniversário"; no mês anterior, o Mercado e a Pizza do Delivery, a base da comparação.
 * Depois recarrega, porque a escrita pela ponte não passa pelo mapa de invalidação da tela.
 *
 * @param page Janela do app, com o shell aberto no perfil do primeiro uso.
 */
async function seedMonths(page: Page): Promise<void> {
    const period = currentPeriod(new Date());
    await page.evaluate(
        async ({ period, previous }) => {
            const { core } = window.finance;
            const { lastProfileId: profileId } = await window.finance.preferences.get();
            if (profileId === null) {
                throw new Error('nenhum perfil aberto');
            }
            const accounts = await core.call('accounts.list', { profileId, period });
            const tree = await core.call('categories.tree', { profileId });
            const nubank = accounts.ok ? accounts.data.accounts[0] : undefined;
            const food = tree.ok ? tree.data.find((category) => category.name === 'Alimentação') : undefined;
            const sub = (name: string): string => food?.subCategories.find((item) => item.name === name)?.id ?? '';
            const roxinho = await core.call('creditCards.create', { profileId, accountId: nubank?.id ?? '', name: 'Roxinho', limit: 5000, closingDay: 3, dueDay: 10 });
            const tag = await core.call('tags.create', { profileId, name: 'aniversário' });
            if (nubank === undefined || food === undefined || !roxinho.ok || !tag.ok) {
                throw new Error('cenário incompleto');
            }
            const account = { kind: 'account', accountId: nubank.id } as const;
            const expense = { profileId, type: 'expense' } as const;
            const feira = await core.call('transactions.create', { ...expense, subCategoryId: sub('Mercado'), source: { kind: 'creditCard', creditCardId: roxinho.data.id }, name: 'Feira', value: 150, dueDate: `${previous}-10` });
            if (!feira.ok || feira.data.container.kind !== 'invoice') {
                throw new Error('compra não criada');
            }
            await core.call('invoices.pay', { invoiceId: feira.data.container.invoiceId, paymentDate: `${period}-02` });
            await core.call('transactions.create', { ...expense, subCategoryId: sub('Mercado'), source: account, name: 'Supermercado', value: 300, dueDate: `${period}-05` });
            await core.call('transactions.create', { ...expense, subCategoryId: sub('Restaurantes'), source: account, name: 'Jantar', value: 80, dueDate: `${period}-12`, paymentDate: `${period}-12`, tagIds: [tag.data.id] });
            await core.call('transactions.create', { ...expense, subCategoryId: sub('Mercado'), source: account, name: 'Mercado do mês', value: 600, dueDate: `${previous}-05`, paymentDate: `${previous}-05` });
            await core.call('transactions.create', { ...expense, subCategoryId: sub('Delivery'), source: account, name: 'Pizza', value: 50, dueDate: `${previous}-15`, paymentDate: `${previous}-15` });
        },
        { period, previous: shiftPeriod(period, -1) },
    );
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Por categoria', level: 1 })).toBeVisible();
}

/**
 * @param page Janela do app.
 * @return A tabela principal do relatório.
 */
function reportTable(page: Page): Locator {
    return page.getByRole('table', { name: 'Despesas por categoria' });
}

/**
 * @param page Janela do app.
 * @param name Nome da categoria ou subcategoria da linha.
 * @return A linha da tabela principal.
 */
function reportRow(page: Page, name: string): Locator {
    return reportTable(page).getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) });
}

test('relatório por categoria: comparação, drill-down, lançamentos pelo pagamento e Transações filtrada', async () => {
    const { app, window: page, userData } = await launchApp();
    const period = currentPeriod(new Date());
    const previous = shiftPeriod(period, -1);
    try {
        await completeFirstUse(page, { profileName: 'Pessoal', accountName: 'Nubank', openingBalance: '1.000,00' });
        await page.getByRole('link', { name: 'Relatórios', exact: true }).dispatchEvent('click');
        await expect(page.getByRole('heading', { name: 'Por categoria', level: 1 })).toBeVisible();
        await expect(page.getByText(`Nenhuma despesa em ${formatMonthShort(period)}`)).toBeVisible();

        await seedMonths(page);
        // Regra de negócio (Relatórios): a Feira do mês anterior conta neste mês, o do pagamento
        // da fatura; a Pizza deixa o Delivery na tabela com zero, pela comparação.
        await expect(reportTable(page).getByRole('columnheader', { name: formatMonthShort(previous) })).toBeVisible();
        await expect(reportRow(page, 'Alimentação')).toContainText('R$ 530,00');
        await expect(reportRow(page, 'Alimentação')).toContainText('R$ 650,00');
        await expect(reportRow(page, 'Alimentação')).toContainText('▼ −R$ 120,00');
        await expect(reportRow(page, 'Alimentação')).toContainText('−18,5%');
        await expect(reportTable(page).getByRole('row').last()).toContainText('Total de despesas');
        await expect(reportRow(page, 'Mercado')).toHaveCount(0);

        // A categoria: expande na tabela, a trilha, o gráfico das subcategorias e a lista.
        await reportRow(page, 'Alimentação').getByRole('link', { name: 'Alimentação' }).dispatchEvent('click');
        await expect(page).toHaveURL(/#\/reports\/category\?.*category=/);
        await expect(page.getByRole('navigation', { name: 'Nível do detalhamento' })).toContainText('Todas as categorias›Alimentação');
        await expect(reportRow(page, 'Restaurantes')).toContainText('▲ +R$ 80,00');
        await expect(reportRow(page, 'Restaurantes')).toContainText('novo');
        await expect(reportRow(page, 'Delivery')).toContainText('R$ 0,00');
        await expect(page.getByRole('heading', { name: 'Alimentação por subcategoria' })).toBeVisible();
        await expect(page.getByRole('img', { name: /Gráfico de alimentação por subcategoria/ })).toBeVisible();
        const categoryList = page.getByRole('table', { name: 'Lançamentos em Alimentação' });
        await expect(categoryList.getByRole('row').filter({ hasText: 'Feira' })).toContainText(`Roxinho · fat. ${formatMonthAbbreviation(period)}`);
        await expect(categoryList.getByRole('row').last()).toContainText('−R$ 530,00');

        // O ▸/▾ só abre e fecha as subcategorias, sem trocar o nível.
        await page.getByRole('button', { name: 'Esconder subcategorias de Alimentação' }).dispatchEvent('click');
        await expect(reportRow(page, 'Mercado')).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Alimentação por subcategoria' })).toBeVisible();
        await page.getByRole('button', { name: 'Mostrar subcategorias de Alimentação' }).dispatchEvent('click');

        // A subcategoria pela tabela equivalente ao gráfico: a lista com a tag e o total da linha.
        await page.getByRole('button', { name: 'Tabela', exact: true }).dispatchEvent('click');
        await page.getByRole('table', { name: 'Alimentação por subcategoria' }).getByRole('link', { name: 'Restaurantes' }).dispatchEvent('click');
        await expect(page).toHaveURL(/subCategory=/);
        await expect(page.getByRole('navigation', { name: 'Nível do detalhamento' })).toContainText('Alimentação›Restaurantes');
        const restaurants = page.getByRole('table', { name: 'Lançamentos em Restaurantes' });
        await expect(restaurants.getByRole('row').filter({ hasText: 'Jantar' })).toContainText('aniversário');
        await expect(restaurants.getByRole('row').last()).toContainText('−R$ 80,00');

        await page.getByRole('link', { name: 'Abrir em Transações →' }).dispatchEvent('click');
        await expect(page).toHaveURL(/#\/transactions\?.*subCategory=/);
        await expect(page.getByRole('heading', { name: 'Transações', level: 1 })).toBeVisible();
        await page.goBack();

        // "Voltar" sobe um nível; a categoria sem gasto no mês explica a lista vazia.
        await page.goBack();
        await expect(page.getByRole('navigation', { name: 'Nível do detalhamento' })).not.toContainText('Restaurantes');
        await reportRow(page, 'Delivery').getByRole('link', { name: 'Delivery' }).dispatchEvent('click');
        await expect(page.getByText(`Nenhum lançamento em Delivery em ${formatMonthShort(period)}.`)).toBeVisible();

        // A comparação troca a base sem fechar o nível aberto.
        const comparison = page.getByRole('combobox', { name: 'Comparar com' });
        await comparison.press('Enter');
        const option = page.getByRole('option', { name: 'Média dos últimos 3 meses', exact: true });
        await option.focus();
        await option.press('Enter');
        await expect(page).toHaveURL(/comparison=lastThreeMonthsAverage/);
        await expect(reportRow(page, 'Alimentação')).toContainText('R$ 216,67');
        await expect(page.getByRole('navigation', { name: 'Nível do detalhamento' })).toContainText('Delivery');

        // A trilha volta à raiz; o mês anterior não tem nada antes dele e mostra só a comparação vazia.
        await page.getByRole('navigation', { name: 'Nível do detalhamento' }).getByRole('link', { name: 'Todas as categorias' }).dispatchEvent('click');
        await expect(page.getByRole('heading', { name: 'Despesas por categoria' })).toBeVisible();
        await page.getByRole('button', { name: 'Próximo mês' }).dispatchEvent('click');
        await expect(page.getByRole('status').filter({ hasText: `Nenhuma despesa em ${formatMonthShort(shiftPeriod(period, 1))}` })).toBeVisible();
    } finally {
        await app.close();
        removeUserData(userData);
    }
});
