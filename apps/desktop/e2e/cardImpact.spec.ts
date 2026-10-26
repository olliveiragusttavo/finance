import { expect, test, type Locator, type Page } from '@playwright/test';
import { formatDayMonth, formatMonthShort } from '@finance/client';
import { currentPeriod, shiftPeriod } from '../src/renderer/src/shell/referenceMonth.ts';
import { completeFirstUse } from './firstUse.ts';
import { launchApp, removeUserData } from './launchApp.ts';

/*
 * Impacto do cartão (desktop-mvp-plan Fase 12) no app empacotado: o estado sem cartão, os
 * indicadores, a grade mês × cartão com cada situação, o peso sem receita e o link de uma fatura
 * para Cartões. Os cliques usam `dispatchEvent`, pelo motivo explicado em `firstUse.ts`.
 */

/**
 * Semeia pela ponte, na Nubank: a receita de R$ 5.000,00 do mês corrente; no Roxinho (fecha 3,
 * vence 10), a compra do mês anterior na fatura deste mês, paga no dia 2, e uma compra posta à
 * mão na fatura do mês seguinte; no Click (fecha 20, vence 5), uma compra na fatura do mês
 * anterior, que vence no dia 5 deste mês e fica em aberto. Depois recarrega, porque a escrita
 * pela ponte não passa pelo mapa de invalidação da tela.
 *
 * @param page Janela do app, com o shell aberto no perfil do primeiro uso.
 */
async function seedInvoices(page: Page): Promise<void> {
    const period = currentPeriod(new Date());
    await page.evaluate(
        async ({ period, previous, next }) => {
            const { core } = window.finance;
            const { lastProfileId: profileId } = await window.finance.preferences.get();
            if (profileId === null) {
                throw new Error('nenhum perfil aberto');
            }
            const accounts = await core.call('accounts.list', { profileId, period });
            const tree = await core.call('categories.tree', { profileId });
            const nubank = accounts.ok ? accounts.data.accounts[0] : undefined;
            const subCategoryId = tree.ok ? (tree.data[0]?.subCategories[0]?.id ?? '') : '';
            if (nubank === undefined) {
                throw new Error('cenário incompleto');
            }
            const roxinho = await core.call('creditCards.create', { profileId, accountId: nubank.id, name: 'Roxinho', limit: 5000, closingDay: 3, dueDay: 10 });
            const click = await core.call('creditCards.create', { profileId, accountId: nubank.id, name: 'Click', limit: 2000, closingDay: 20, dueDay: 5 });
            if (!roxinho.ok || !click.ok) {
                throw new Error('cartões não criados');
            }
            const expense = { profileId, subCategoryId, type: 'expense' } as const;
            await core.call('transactions.create', { profileId, subCategoryId, type: 'income', source: { kind: 'account', accountId: nubank.id }, name: 'Salário', value: 5000, dueDate: `${period}-01`, paymentDate: `${period}-01` });
            const feira = await core.call('transactions.create', { ...expense, source: { kind: 'creditCard', creditCardId: roxinho.data.id }, name: 'Feira', value: 150, dueDate: `${previous}-10` });
            if (!feira.ok || feira.data.container.kind !== 'invoice') {
                throw new Error('compra não criada');
            }
            await core.call('invoices.pay', { invoiceId: feira.data.container.invoiceId, paymentDate: `${period}-02` });
            await core.call('transactions.create', { ...expense, source: { kind: 'creditCard', creditCardId: roxinho.data.id, invoicePeriod: next }, name: 'Passagem', value: 400, dueDate: `${period}-01` });
            await core.call('transactions.create', { ...expense, source: { kind: 'creditCard', creditCardId: click.data.id, invoicePeriod: previous }, name: 'Livro', value: 200, dueDate: `${previous}-01` });
        },
        { period, previous: shiftPeriod(period, -1), next: shiftPeriod(period, 1) },
    );
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Impacto do cartão', level: 1 })).toBeVisible();
}

/**
 * @param page Janela do app.
 * @param period Mês da linha `YYYY-MM`.
 * @return A linha do mês na grade.
 */
function monthRow(page: Page, period: string): Locator {
    return page.getByRole('table', { name: 'Faturas por mês' }).getByRole('row').filter({ has: page.getByRole('cell', { name: formatMonthShort(period), exact: true }) });
}

test('impacto do cartão: sem cartão, indicadores, situações da grade e link para a fatura', async () => {
    const { app, window: page, userData } = await launchApp();
    const period = currentPeriod(new Date());
    const previous = shiftPeriod(period, -1);
    const next = shiftPeriod(period, 1);
    try {
        await completeFirstUse(page, { profileName: 'Pessoal', accountName: 'Nubank', openingBalance: '1.000,00' });
        // Os relatórios ficam na lista da página de Relatórios.
        await page.getByRole('link', { name: 'Relatórios', exact: true }).dispatchEvent('click');
        await page.getByRole('link', { name: 'Impacto do cartão', exact: true }).dispatchEvent('click');
        await expect(page.getByRole('heading', { name: 'Impacto do cartão', level: 1 })).toBeVisible();
        await expect(page.getByText('Nenhum cartão')).toBeVisible();

        await seedInvoices(page);
        // Regra de negócio (Relatórios, C1): neste mês pesam a fatura paga nele e a em aberto que vence nele.
        await expect(page.getByRole('group', { name: `Faturas de ${formatMonthShort(period)}` })).toContainText('R$ 350,00');
        await expect(page.getByRole('group', { name: `Faturas de ${formatMonthShort(period)}` })).toContainText('2 cartões · 1 em aberto');
        await expect(page.getByRole('group', { name: 'Peso nas entradas do mês' })).toContainText('7,0%');
        await expect(page.getByRole('group', { name: 'Peso nas entradas do mês' })).toContainText('das entradas de R$ 5.000,00');
        await expect(page.getByRole('columnheader', { name: 'Roxinho · paga com Nubank' })).toBeVisible();

        const reference = monthRow(page, period);
        await expect(reference).toHaveAttribute('aria-current', 'date');
        await expect(reference).toContainText(`Paga em ${formatDayMonth(`${period}-02`)}`);
        await expect(reference).toContainText(`Em aberto · vence ${formatDayMonth(`${period}-05`)}`);
        await expect(reference).toContainText('R$ 350,00');
        // Regra de negócio (Relatórios, C4): a fatura do mês seguinte recebe compras a partir do fechamento (dia 3) deste mês.
        await expect(monthRow(page, next)).toContainText(new Date().getDate() >= 3 ? 'Aberta' : 'Futura');
        await expect(monthRow(page, next)).toContainText('R$ 400,00');
        // Regra de negócio (Relatórios, C3): sem receita, o peso é "—", nunca 0% nem ∞.
        await expect(monthRow(page, next)).toContainText('—');
        await expect(monthRow(page, previous)).toContainText('—');

        // A situação abre a fatura em Cartões, mesmo quando a competência é de outro mês.
        await reference.getByRole('link', { name: /Em aberto .* abrir fatura de .* do Click/ }).dispatchEvent('click');
        await expect(page).toHaveURL(new RegExp(`#/cards\\?.*invoice=${previous}`));
        await expect(page.getByRole('heading', { name: 'Cartões', level: 1 })).toBeVisible();
    } finally {
        await app.close();
        removeUserData(userData);
    }
});
