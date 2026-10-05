import { expect, test, type Page } from '@playwright/test';
import { currentPeriod, shiftPeriod } from '../src/renderer/src/shell/referenceMonth.ts';
import { completeFirstUse } from './firstUse.ts';
import { launchApp, removeUserData } from './launchApp.ts';

/*
 * Contas (desktop-mvp-plan Fase 7) no app empacotado: a lista com o saldo do mês e os totais,
 * o extrato com os quatro números, as quatro fontes de movimento e as ações da conta. Os
 * cliques usam `dispatchEvent` e o menu do Radix é operado pelo teclado, pelo motivo
 * explicado em `firstUse.ts`.
 */

/** Ids que o cenário semeia, para conferir os links. */
interface Seeded {
    readonly creditCardId: string;
}

/**
 * Semeia pela ponte o mês de referência da Nubank: salário pago, aluguel pendente, aporte
 * pago para o Tesouro (fora do total), a fatura do mês anterior paga no dia 2 e a do mês em
 * aberto, vencendo no dia 10. Pela ponte, e não pela tela: o teste é do extrato, e lançar pela
 * tela é coberto em `transactions.spec.ts`.
 *
 * @param page Janela do app, com o shell aberto.
 * @param period Mês de referência `YYYY-MM`.
 * @return Os ids que o teste confere.
 */
async function seedMonth(page: Page, period: string): Promise<Seeded> {
    return page.evaluate(async ({ period, previous, beforePrevious }) => {
        const { core } = window.finance;
        const { lastProfileId: profileId } = await window.finance.preferences.get();
        if (profileId === null) {
            throw new Error('nenhum perfil aberto');
        }
        const accounts = await core.call('accounts.list', { profileId, period });
        const tree = await core.call('categories.tree', { profileId });
        const nubank = accounts.ok ? accounts.data.accounts[0] : undefined;
        const subCategory = tree.ok ? tree.data[0]?.subCategories[0] : undefined;
        const savings = await core.call('accounts.create', { profileId, name: 'Tesouro', type: 'investment', considerBalance: false });
        if (nubank === undefined || subCategory === undefined || !savings.ok) {
            throw new Error('cenário incompleto');
        }
        // Fecha dia 3 e vence dia 10: compra do dia 10 cai na fatura do mês seguinte.
        const card = await core.call('creditCards.create', { profileId, accountId: nubank.id, name: 'Roxinho', limit: 5000, closingDay: 3, dueDay: 10 });
        if (!card.ok) {
            throw new Error('cartão não criado');
        }
        const base = { profileId, subCategoryId: subCategory.id };
        const account = { kind: 'account', accountId: nubank.id } as const;
        const creditCard = { kind: 'creditCard', creditCardId: card.data.id } as const;
        const created = await Promise.all([
            core.call('transactions.create', { ...base, type: 'income', source: account, name: 'Salário', value: 5000, dueDate: `${period}-01`, paymentDate: `${period}-01` }),
            core.call('transactions.create', { ...base, type: 'expense', source: account, name: 'Aluguel', value: 300, dueDate: `${period}-05` }),
            core.call('transactions.create', { ...base, type: 'transference', source: account, destinationAccountId: savings.data.id, name: 'Aporte', value: 200, dueDate: `${period}-06`, paymentDate: `${period}-06` }),
            core.call('transactions.create', { ...base, type: 'expense', source: creditCard, name: 'Farmácia', value: 150, dueDate: `${previous}-10` }),
            core.call('transactions.create', { ...base, type: 'expense', source: creditCard, name: 'Feira', value: 80, dueDate: `${beforePrevious}-10` }),
        ]);
        const fair = created[4];
        if (!created.every((result) => result.ok) || !fair.ok || fair.data.container.kind !== 'invoice') {
            throw new Error('lançamentos não criados');
        }
        const paid = await core.call('invoices.pay', { invoiceId: fair.data.container.invoiceId, paymentDate: `${period}-02` });
        if (!paid.ok) {
            throw new Error('fatura não paga');
        }
        return { creditCardId: card.data.id };
    }, { period, previous: shiftPeriod(period, -1), beforePrevious: shiftPeriod(shiftPeriod(period, -1), -1) });
}

/**
 * Abre Contas pelo menu, como o usuário, para que o teste passe também pela navegação do shell.
 *
 * @param page Janela do app, com o shell aberto.
 */
async function openAccounts(page: Page): Promise<void> {
    await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Contas', exact: true }).dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'Contas', level: 1 })).toBeVisible();
}

/**
 * @param period Mês `YYYY-MM`.
 * @return O mês no formato das datas da tabela (`10/2026` → `/10`).
 */
function monthSuffix(period: string): string {
    return `/${period.slice(5, 7)}`;
}

test('extrato: lista com totais, quatro números, as quatro fontes de movimento e "ver fatura"', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        await completeFirstUse(page, { profileName: 'Gustavo', accountName: 'Nubank', openingBalance: '1.000,00' });
        const period = currentPeriod(new Date());
        const { creditCardId } = await seedMonth(page, period);
        await openAccounts(page);

        const list = page.getByRole('list', { name: 'Contas' });
        await expect(list.getByRole('link', { name: /^Nubank/ })).toHaveAttribute('aria-current', 'page');
        await expect(list.getByRole('link', { name: /^Nubank/ })).toContainText('R$ 5.720,00previsto R$ 5.270,00');
        // Fora do total: só o consolidado, e não entra no rodapé.
        await expect(list.getByRole('link', { name: /^Tesouro/ })).toContainText('Investimentos · fora do total');
        await expect(list.getByRole('link', { name: /^Tesouro/ })).not.toContainText('previsto');
        const listRegion = page.getByRole('region', { name: 'Lista de contas' });
        await expect(listRegion).toContainText('Total consolidadoR$ 5.720,00');
        await expect(listRegion).toContainText('Total previstoR$ 5.270,00');

        await expect(page.getByText('Conta corrente · entra no saldo total')).toBeVisible();
        const figures = page.getByRole('region', { name: 'Resumo do extrato' });
        await expect(figures).toContainText('Saldo inicialR$ 1.000,00previsto R$ 1.000,00');
        await expect(figures).toContainText('↑ Entradas+R$ 5.000,00previsto +R$ 5.000,00');
        // Saídas pagas: aporte 200 + fatura paga 80; o previsto soma aluguel 300 e a fatura em aberto 150.
        await expect(figures).toContainText('↓ Saídas−R$ 280,00previsto −R$ 730,00');
        await expect(figures).toContainText('Saldo finalR$ 5.720,00previsto R$ 5.270,00');

        const movements = page.getByRole('region', { name: 'Movimentos' });
        const rows = movements.getByRole('row');
        await expect(rows).toHaveCount(6);
        await expect(rows.nth(1)).toContainText(`01${monthSuffix(period)}Salário`);
        await expect(rows.nth(2)).toContainText(`02${monthSuffix(period)}Fatura Roxinho`);
        await expect(rows.nth(2)).toContainText('Paga−R$ 80,00');
        await expect(rows.nth(4)).toContainText('Aporte→ Tesouro');
        await expect(rows.nth(4)).toContainText('⇄ −R$ 200,00');
        await expect(rows.nth(5)).toContainText(`10${monthSuffix(period)}Fatura Roxinho`);
        await expect(rows.nth(5)).toContainText('Em aberto−R$ 150,00');
        await expect(movements).toContainText('Fatura em aberto conta só no saldo previsto, no mês do vencimento.');

        await rows.nth(5).getByRole('link', { name: 'ver fatura' }).dispatchEvent('click');
        await expect(page).toHaveURL(new RegExp(`/cards\\?.*card=${creditCardId}`));
        await expect(page).toHaveURL(new RegExp(`invoice=${period}`));
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

test('conta: transferência recebida, editar, desativar pelo menu, mês sem movimento e nova conta aberta', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        await completeFirstUse(page, { profileName: 'Gustavo', accountName: 'Nubank', openingBalance: '1.000,00' });
        const period = currentPeriod(new Date());
        await seedMonth(page, period);
        await openAccounts(page);

        const list = page.getByRole('list', { name: 'Contas' });
        await list.getByRole('link', { name: /^Tesouro/ }).dispatchEvent('click');
        await expect(page).toHaveURL(/account=/);
        await expect(page.getByRole('heading', { name: /^Tesouro — extrato de/, level: 2 })).toBeVisible();
        await expect(page.getByText('Conta de investimentos · fora do saldo total')).toBeVisible();
        const movements = page.getByRole('region', { name: 'Movimentos' });
        await expect(movements.getByRole('row').nth(1)).toContainText('Aportede Nubank');
        await expect(movements.getByRole('row').nth(1)).toContainText('⇄ +R$ 200,00');

        await page.getByRole('button', { name: 'Editar conta' }).dispatchEvent('click');
        await expect(page.getByRole('dialog', { name: 'Editar Tesouro' })).toBeVisible();
        await page.getByRole('button', { name: 'Cancelar' }).dispatchEvent('click');
        await expect(page.getByRole('dialog')).toHaveCount(0);

        await page.getByRole('button', { name: 'Mais ações' }).press('Enter');
        const disable = page.getByRole('menuitem', { name: 'Desativar conta' });
        await disable.focus();
        await disable.press('Enter');
        await expect(list.getByRole('link', { name: /^Tesouro/ })).toContainText('Desativada');
        await expect(page.getByText('Conta de investimentos · fora do saldo total · desativada')).toBeVisible();

        // O mês seguinte não tem movimento: inicial = final, e a tabela diz isso.
        await page.getByRole('button', { name: 'Próximo mês' }).dispatchEvent('click');
        await expect(page).toHaveURL(new RegExp(`period=${shiftPeriod(period, 1)}`));
        await expect(page.getByRole('heading', { name: /^Tesouro — extrato de/, level: 2 })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Movimentos' })).toContainText('Nenhum movimento em');
        await expect(page.getByRole('region', { name: 'Resumo do extrato' })).toContainText('Saldo finalR$ 200,00');

        await page.getByRole('button', { name: '+ Nova conta' }).dispatchEvent('click');
        await page.getByLabel('Nome', { exact: true }).fill('Itaú');
        await page.getByRole('button', { name: 'Criar conta' }).dispatchEvent('click');
        await expect(page.getByRole('heading', { name: /^Itaú — extrato de/, level: 2 })).toBeVisible();
        await expect(list.getByRole('link', { name: /^Itaú/ })).toHaveAttribute('aria-current', 'page');
    } finally {
        await app.close();
        removeUserData(userData);
    }
});
