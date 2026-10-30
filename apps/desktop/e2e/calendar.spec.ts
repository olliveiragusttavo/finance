import { expect, test, type Page } from '@playwright/test';
import { currentPeriod, shiftPeriod } from '../src/renderer/src/shell/referenceMonth.ts';
import { completeFirstUse } from './firstUse.ts';
import { launchApp, removeUserData } from './launchApp.ts';

/*
 * Calendário (mockup `DesktopCalendario`) no app empacotado: os lançamentos por dia do vencimento,
 * o atraso, o painel do dia com "Marcar pago" e o modo "Saldo do dia". O cenário fica no mês
 * anterior, que já passou inteiro: o vencimento do dia 5 é atrasado em qualquer dia em que o teste
 * rode. Os cliques usam `dispatchEvent`, pelo motivo explicado em `firstUse.ts`.
 */

/**
 * Semeia pela ponte o mês anterior: Salário recebido no dia 1 e Aluguel em aberto no dia 5. Depois
 * recarrega, porque a escrita pela ponte não passa pelo mapa de invalidação da tela.
 *
 * @param page Janela do app, com o shell aberto no perfil do primeiro uso.
 * @param period Mês do cenário, `YYYY-MM`.
 */
async function seedMonth(page: Page, period: string): Promise<void> {
    await page.evaluate(async (period) => {
        const { core } = window.finance;
        const { lastProfileId: profileId } = await window.finance.preferences.get();
        if (profileId === null) {
            throw new Error('nenhum perfil aberto');
        }
        const accounts = await core.call('accounts.list', { profileId, period });
        const tree = await core.call('categories.tree', { profileId });
        const nubank = accounts.ok ? accounts.data.accounts[0] : undefined;
        const market = tree.ok ? tree.data.find((category) => category.name === 'Alimentação')?.subCategories.find((sub) => sub.name === 'Mercado') : undefined;
        if (nubank === undefined || market === undefined) {
            throw new Error('cenário incompleto');
        }
        const base = { profileId, subCategoryId: market.id, source: { kind: 'account', accountId: nubank.id } } as const;
        await core.call('transactions.create', { ...base, type: 'income', name: 'Salário', value: 9500, dueDate: `${period}-01`, paymentDate: `${period}-01` });
        await core.call('transactions.create', { ...base, type: 'expense', name: 'Aluguel', value: 2300, dueDate: `${period}-05` });
    }, period);
    await page.reload();
}

/**
 * @param page Janela do app.
 * @param label Rótulo do indicador.
 * @return O cartão do indicador.
 */
function kpi(page: Page, label: string): ReturnType<Page['getByRole']> {
    return page.getByRole('region', { name: 'Resumo do mês' }).getByRole('group', { name: label });
}

test('calendário: lançamentos por dia, atraso, marcar pago e saldo do dia', async () => {
    const { app, window: page, userData } = await launchApp();
    const previous = shiftPeriod(currentPeriod(new Date()), -1);
    try {
        await completeFirstUse(page, { profileName: 'Pessoal', accountName: 'Nubank', openingBalance: '1.000,00' });
        await seedMonth(page, previous);
        await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Calendário', exact: true }).dispatchEvent('click');
        await expect(page.getByRole('heading', { name: 'Calendário', level: 1 })).toBeVisible();
        await page.getByRole('button', { name: 'Mês anterior' }).dispatchEvent('click');

        await expect(kpi(page, 'Receitas no mês')).toContainText('R$ 9.500,00');
        await expect(kpi(page, 'Despesas no mês')).toContainText('R$ 0,00 pago · R$ 2.300,00 a pagar');
        await expect(kpi(page, 'Atrasados')).toContainText('1 · −R$ 2.300,00');

        const grid = page.getByRole('region', { name: 'Calendário do mês' });
        const rentDay = grid.getByRole('button', { name: /^5 de .*, 1 lançamento, 1 atrasado$/ });
        await expect(rentDay).toContainText('⚠ −R$ 2.300,00');
        await expect(grid.getByRole('button', { name: /^1 de / })).toContainText('+R$ 9.500,00');

        if (process.env['FINANCE_E2E_SCREENSHOTS'] !== undefined) {
            await page.screenshot({ path: `${process.env['FINANCE_E2E_SCREENSHOTS']}/calendar-flows.png`, fullPage: true });
        }

        // Modo "Saldo do dia": o consolidado no fim do dia, só nos dias com movimento.
        await page.getByRole('button', { name: 'Saldo do dia' }).dispatchEvent('click');
        await expect(grid.getByRole('button', { name: /^1 de / })).toContainText('R$ 10.500,00');
        await expect(grid.getByRole('button', { name: /^1 de / })).toContainText('+R$ 9.500,00 no dia');
        await expect(rentDay).toContainText('sem mudança no consolidado');
        await expect(grid.getByRole('button', { name: /^2 de / })).not.toContainText('R$');
        if (process.env['FINANCE_E2E_SCREENSHOTS'] !== undefined) {
            await page.screenshot({ path: `${process.env['FINANCE_E2E_SCREENSHOTS']}/calendar-balance.png`, fullPage: true });
        }

        // O painel do dia paga o atrasado com as ações da listagem de movimentos.
        await rentDay.dispatchEvent('click');
        const panel = page.getByRole('complementary', { name: 'Lançamentos do dia' });
        await expect(panel).toContainText('Aluguel');
        await expect(panel).toContainText('Atrasado');
        await panel.getByRole('button', { name: 'Marcar pago' }).dispatchEvent('click');
        await expect(kpi(page, 'Atrasados')).toContainText('Nenhum');
        await expect(panel).toContainText('Pago');
        await expect(panel.getByRole('button', { name: 'Marcar pago' })).toHaveCount(0);
    } finally {
        await app.close();
        removeUserData(userData);
    }
});
