import { expect, test, type Page } from '@playwright/test';
import { currentPeriod, shiftPeriod } from '../src/renderer/src/shell/referenceMonth.ts';
import { completeFirstUse } from './firstUse.ts';
import { launchApp, removeUserData } from './launchApp.ts';

/*
 * Visão geral (mockup `DesktopVisaoGeral2`) no app empacotado: os indicadores, o selo de atrasados
 * com o "Marcar como pago" e o "Desfazer", e os resumos de contas e cartões, com a navegação para
 * os detalhes. Os cliques usam `dispatchEvent`, pelo motivo explicado em
 * `firstUse.ts`.
 */

/**
 * Semeia pela ponte o mês corrente: Salário pago, Aluguel do mês anterior vencido sem pagamento, o cartão Roxinho (fecha 3,
 * vence 10) com a Farmácia do mês anterior numa fatura paga no dia 2 e o Notebook do dia 8, que
 * cai na fatura do mês seguinte. Depois recarrega, porque a escrita pela ponte não passa pelo
 * mapa de invalidação da tela.
 *
 * @param page Janela do app, com o shell aberto no perfil do primeiro uso.
 */
async function seedMonth(page: Page): Promise<void> {
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
            const market = tree.ok ? tree.data.find((category) => category.name === 'Alimentação')?.subCategories.find((sub) => sub.name === 'Mercado') : undefined;
            const roxinho = await core.call('creditCards.create', { profileId, accountId: nubank?.id ?? '', name: 'Roxinho', limit: 5000, closingDay: 3, dueDay: 10 });
            if (nubank === undefined || market === undefined || !roxinho.ok) {
                throw new Error('cenário incompleto');
            }
            const base = { profileId, subCategoryId: market.id } as const;
            const card = { kind: 'creditCard', creditCardId: roxinho.data.id } as const;
            const pharmacy = await core.call('transactions.create', { ...base, type: 'expense', source: card, name: 'Farmácia', value: 150, dueDate: `${previous}-10` });
            if (!pharmacy.ok || pharmacy.data.container.kind !== 'invoice') {
                throw new Error('compra não criada');
            }
            await core.call('invoices.pay', { invoiceId: pharmacy.data.container.invoiceId, paymentDate: `${period}-02` });
            const nubankSource = { kind: 'account', accountId: nubank.id } as const;
            await core.call('transactions.create', { ...base, type: 'income', source: nubankSource, name: 'Salário', value: 9500, dueDate: `${period}-01`, paymentDate: `${period}-01` });
            await core.call('transactions.create', { ...base, type: 'expense', source: nubankSource, name: 'Aluguel', value: 2300, dueDate: `${previous}-05` });
            await core.call('transactions.create', { ...base, type: 'expense', source: card, name: 'Notebook', value: 400, dueDate: `${period}-08` });
        },
        { period, previous: shiftPeriod(period, -1) },
    );
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Visão geral', level: 1 })).toBeVisible();
}

/**
 * @param page Janela do app.
 * @param label Rótulo do indicador, ou o padrão dele quando o rótulo traz o mês.
 * @return O cartão do indicador.
 */
function kpi(page: Page, label: string | RegExp): ReturnType<Page['getByRole']> {
    return page.getByRole('region', { name: 'Indicadores' }).getByRole('group', { name: label });
}

test('visão geral: indicadores, selo de atrasados e resumos com navegação', async () => {
    const { app, window: page, userData } = await launchApp();
    const period = currentPeriod(new Date());
    const month = period.slice(5);
    try {
        await completeFirstUse(page, { profileName: 'Pessoal', accountName: 'Nubank', openingBalance: '1.000,00' });
        await expect(page.getByRole('heading', { name: 'Visão geral', level: 1 })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Cartões' })).toContainText('Nenhum cartão');
        await expect(page.getByRole('button', { name: /Nada atrasado/ })).toBeVisible();

        await seedMonth(page);
        // A Farmácia do mês anterior sai da conta neste mês, com a fatura paga; o Notebook cai na
        // fatura que vence no mês seguinte e o Aluguel vencido do mês anterior pesa só no previsto.
        await expect(kpi(page, 'Saldo consolidado')).toContainText('R$ 10.350,00');
        await expect(kpi(page, 'Saldo consolidado')).toContainText('1 conta no total · previsto R$ 8.050,00');
        await expect(kpi(page, 'Patrimônio')).toContainText('R$ 10.350,00');
        await expect(kpi(page, /^↑ Entradas em /)).toContainText('R$ 9.500,00');
        await expect(kpi(page, 'Próximas faturas')).toContainText('R$ 400,00');
        await expect(page.getByRole('region', { name: 'Gastos por mês' }).getByRole('img')).toHaveAttribute('aria-label', /^Gastos de /);

        const accounts = page.getByRole('region', { name: 'Contas' });
        await expect(accounts).toContainText('Total no saldo');
        await expect(accounts).toContainText('R$ 8.050,00');
        const cards = page.getByRole('region', { name: 'Cartões' });
        await expect(cards).toContainText('paga com Nubank');
        await expect(cards).toContainText(`vence 10/${month}`);
        await expect(cards).toContainText('Paga');
        await expect(cards).toContainText('R$ 150,00');

        // O Aluguel do mês anterior venceu sem pagamento: marca pelo painel do selo e desfaz.
        const badge = page.getByRole('button', { name: /1 atrasado/ });
        await expect(badge).toContainText('R$ 2.300,00 a pagar');
        await badge.dispatchEvent('click');
        const panel = page.getByRole('dialog', { name: 'Lançamentos atrasados e em aberto' });
        await expect(panel).toContainText('Aluguel');
        await panel.getByRole('button', { name: 'Marcar como pago: Aluguel' }).dispatchEvent('click');
        await expect(page.getByRole('status').filter({ hasText: 'Aluguel marcado como pago' })).toBeVisible();
        await expect(page.getByRole('button', { name: /Nada atrasado/ })).toBeVisible();
        await page.getByRole('button', { name: 'Desfazer' }).dispatchEvent('click');
        await expect(page.getByRole('button', { name: /1 atrasado/ })).toBeVisible();

        await accounts.getByRole('link', { name: /Nubank/ }).dispatchEvent('click');
        await expect(page).toHaveURL(/#\/accounts\?.*account=/);
        await page.goBack();
        await cards.getByRole('link', { name: /Roxinho/ }).dispatchEvent('click');
        await expect(page).toHaveURL(/#\/cards\?.*card=/);
        await page.goBack();

        // O mês anterior não tem lançamento pago: os indicadores seguem o mês de referência.
        await page.getByRole('button', { name: 'Mês anterior' }).dispatchEvent('click');
        await expect(kpi(page, 'Saldo consolidado')).toContainText('R$ 1.000,00');
    } finally {
        await app.close();
        removeUserData(userData);
    }
});
