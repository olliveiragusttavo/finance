import { expect, test, type Locator, type Page } from '@playwright/test';
import { formatMonthShort } from '@finance/client';
import { currentPeriod, shiftPeriod } from '../src/renderer/src/shell/referenceMonth.ts';
import { completeFirstUse } from './firstUse.ts';
import { launchApp, removeUserData } from './launchApp.ts';

/*
 * Fluxo por conta (desktop-mvp-plan Fase 12.1) no app empacotado: a primeira conta aberta, as
 * linhas do mês com o que está em aberto, o mês futuro só previsto, a conta fora do total e a
 * soma das contas do total. Os cliques usam `dispatchEvent`, pelo motivo explicado em `firstUse.ts`.
 */

/**
 * Semeia pela ponte, no mês corrente: na Nubank, a receita de R$ 5.000,00 paga no dia 1, a
 * transferência de R$ 300,00 paga para a Poupança e a despesa de R$ 200,00 em aberto no dia 28;
 * cria ainda a Wise, fora do total. Depois recarrega, porque a escrita pela ponte não passa pelo
 * mapa de invalidação da tela.
 *
 * @param page Janela do app, com o shell aberto no perfil do primeiro uso.
 */
async function seedFlow(page: Page): Promise<void> {
    const period = currentPeriod(new Date());
    await page.evaluate(
        async ({ period }) => {
            const { core } = window.finance;
            const { lastProfileId: profileId } = await window.finance.preferences.get();
            if (profileId === null) {
                throw new Error('nenhum perfil aberto');
            }
            const accounts = await core.call('accounts.list', { profileId, period });
            const tree = await core.call('categories.tree', { profileId });
            const nubank = accounts.ok ? accounts.data.accounts[0] : undefined;
            const subCategoryId = tree.ok ? (tree.data[0]?.subCategories[0]?.id ?? '') : '';
            const savings = await core.call('accounts.create', { profileId, name: 'Poupança', type: 'investment' });
            await core.call('accounts.create', { profileId, name: 'Wise', type: 'checking', considerBalance: false });
            if (nubank === undefined || !savings.ok) {
                throw new Error('cenário incompleto');
            }
            const base = { profileId, subCategoryId, source: { kind: 'account', accountId: nubank.id } } as const;
            await core.call('transactions.create', { ...base, type: 'income', name: 'Salário', value: 5000, dueDate: `${period}-01`, paymentDate: `${period}-01` });
            await core.call('transactions.create', { ...base, type: 'transference', destinationAccountId: savings.data.id, name: 'Aporte', value: 300, dueDate: `${period}-01`, paymentDate: `${period}-01` });
            await core.call('transactions.create', { ...base, type: 'expense', name: 'Aluguel', value: 200, dueDate: `${period}-28` });
        },
        { period },
    );
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Fluxo por conta', level: 1 })).toBeVisible();
}

/**
 * @param table Tabela do fluxo.
 * @param label Rótulo da linha.
 * @return A linha.
 */
function flowRow(table: Locator, label: string): Locator {
    return table.getByRole('row').filter({ has: table.page().getByRole('cell', { name: label, exact: true }) });
}

test('fluxo por conta: linhas do mês, previsto, conta fora do total e soma das contas', async () => {
    const { app, window: page, userData } = await launchApp();
    const period = currentPeriod(new Date());
    const next = shiftPeriod(period, 1);
    try {
        await completeFirstUse(page, { profileName: 'Pessoal', accountName: 'Nubank', openingBalance: '1.000,00' });
        // Os subitens de Relatórios só aparecem com a seção aberta.
        await page.getByRole('link', { name: 'Relatórios', exact: true }).dispatchEvent('click');
        await page.getByRole('link', { name: 'Fluxo por conta', exact: true }).dispatchEvent('click');
        await seedFlow(page);

        const list = page.getByRole('list', { name: 'Contas' });
        await expect(list.getByRole('link', { name: /Nubank/ })).toHaveAttribute('aria-current', 'page');
        await expect(list.getByRole('link', { name: /Wise/ })).toContainText('fora do total');

        const table = page.getByRole('table', { name: 'Nubank — extratos encadeados' });
        await expect(table.getByRole('columnheader', { name: `${formatMonthShort(period)} · atual` })).toHaveAttribute('aria-current', 'date');
        await expect(table.getByRole('columnheader', { name: `${formatMonthShort(next)} · previsto` })).toBeVisible();
        await expect(flowRow(table, 'Saldo inicial')).toContainText('R$ 1.000,00');
        await expect(flowRow(table, '↑ Entradas')).toContainText('+R$ 5.000,00');
        // Regra de negócio (Relatórios, F5): a despesa em aberto pesa só no previsto, e a linha diz quanto.
        await expect(flowRow(table, '↓ Saídas')).toContainText('−R$ 500,00');
        await expect(flowRow(table, '↓ Saídas')).toContainText('−R$ 200,00 em aberto');
        await expect(flowRow(table, 'Saldo final consolidado')).toContainText('R$ 5.700,00');
        await expect(flowRow(table, 'Saldo final consolidado')).toContainText('—');
        await expect(flowRow(table, 'Saldo final previsto')).toContainText('R$ 5.500,00');

        // Regra de negócio (Relatórios, F4): a soma das contas do total mostra a transferência interna nos dois lados.
        await list.getByRole('link', { name: /Todas as contas do total/ }).dispatchEvent('click');
        await expect(page).toHaveURL(/account=total/);
        const total = page.getByRole('table', { name: 'Todas as contas do total — extratos encadeados' });
        await expect(flowRow(total, '↑ Entradas')).toContainText('+R$ 5.300,00');
        // Nubank (R$ 5.700,00) e Poupança (os R$ 300,00 que chegaram); a Wise fica fora.
        await expect(flowRow(total, 'Saldo final consolidado')).toContainText('R$ 6.000,00');
        await expect(page.getByText('soma de 2 contas')).toBeVisible();
    } finally {
        await app.close();
        removeUserData(userData);
    }
});
