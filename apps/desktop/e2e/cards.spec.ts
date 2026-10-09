import { expect, test, type Page } from '@playwright/test';
import { currentPeriod, shiftPeriod } from '../src/renderer/src/shell/referenceMonth.ts';
import { completeFirstUse } from './firstUse.ts';
import { launchApp, removeUserData } from './launchApp.ts';

/*
 * Cartões (desktop-mvp-plan Fase 8) no app empacotado: a lista com a fatura do mês e os totais,
 * o detalhe com os quatro números, os lançamentos e as próximas faturas, e as ações pagar,
 * pagamento parcial e reabrir. Os cliques usam `dispatchEvent` e os menus e listas do Radix são
 * operados pelo teclado, pelo motivo explicado em `firstUse.ts`.
 */

/**
 * Semeia pela ponte os dois cartões da Nubank. Roxinho (fecha 3, vence 10, limite 5.000): a
 * Farmácia do dia 10 do mês anterior cai na fatura do mês, em aberto, e o Notebook do dia 5 do
 * mês cai na seguinte. Click (fecha 25, vence 5): o Livro do dia 26 do mês anterior cai na
 * fatura do mês, paga no dia 2. Pela ponte, e não pela tela: o teste é da fatura, e lançar pela
 * tela é coberto em `transactions.spec.ts`.
 *
 * @param page Janela do app, com o shell aberto.
 * @param period Mês de referência `YYYY-MM`.
 */
async function seedCards(page: Page, period: string): Promise<void> {
    await page.evaluate(async ({ period, previous }) => {
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
        const roxinho = await core.call('creditCards.create', { profileId, accountId: nubank.id, name: 'Roxinho', limit: 5000, closingDay: 3, dueDay: 10 });
        const click = await core.call('creditCards.create', { profileId, accountId: nubank.id, name: 'Click', limit: 2000, closingDay: 25, dueDay: 5 });
        if (!roxinho.ok || !click.ok) {
            throw new Error('cartões não criados');
        }
        const base = { profileId, subCategoryId: subCategory.id, type: 'expense' } as const;
        const created = await Promise.all([
            core.call('transactions.create', { ...base, source: { kind: 'creditCard', creditCardId: roxinho.data.id }, name: 'Farmácia', value: 150, dueDate: `${previous}-10` }),
            core.call('transactions.create', { ...base, source: { kind: 'creditCard', creditCardId: roxinho.data.id }, name: 'Notebook', value: 400, dueDate: `${period}-05` }),
            core.call('transactions.create', { ...base, source: { kind: 'creditCard', creditCardId: click.data.id }, name: 'Livro', value: 80, dueDate: `${previous}-26` }),
        ]);
        const book = created[2];
        if (!created.every((result) => result.ok) || !book.ok || book.data.container.kind !== 'invoice') {
            throw new Error('lançamentos não criados');
        }
        const paid = await core.call('invoices.pay', { invoiceId: book.data.container.invoiceId, paymentDate: `${period}-02` });
        if (!paid.ok) {
            throw new Error('fatura não paga');
        }
    }, { period, previous: shiftPeriod(period, -1) });
}

/**
 * Abre Cartões pelo menu, como o usuário, para que o teste passe também pela navegação do shell.
 *
 * @param page Janela do app, com o shell aberto.
 */
async function openCards(page: Page): Promise<void> {
    await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Cartões', exact: true }).dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'Cartões', level: 1 })).toBeVisible();
}

/**
 * Escolhe uma opção numa lista do Radix pelo teclado, como em `registry.spec.ts`.
 *
 * @param page Janela do app.
 * @param label Rótulo do campo.
 * @param option Nome da opção.
 */
async function chooseOption(page: Page, label: string, option: string): Promise<void> {
    await page.getByLabel(label).press('Enter');
    const item = page.getByRole('option', { name: option, exact: true });
    await item.focus();
    await item.press('Enter');
    await expect(page.getByRole('option')).toHaveCount(0);
    await expect(page.getByLabel(label)).toHaveText(option);
}

/**
 * @param period Mês `YYYY-MM`.
 * @return O mês no formato das datas da tela (`2026-10` → `/10`).
 */
function monthSuffix(period: string): string {
    return `/${period.slice(5, 7)}`;
}

test('fatura: lista com totais, detalhe, pagamento parcial, pagar e o extrato da conta', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        await completeFirstUse(page, { profileName: 'Gustavo', accountName: 'Nubank', openingBalance: '1.000,00' });
        const period = currentPeriod(new Date());
        const month = monthSuffix(period);
        await seedCards(page, period);
        await openCards(page);

        // A lista vem por nome, e sem `card` na URL abre o primeiro.
        const list = page.getByRole('list', { name: 'Cartões' });
        await expect(list.getByRole('link', { name: /^Click/ })).toHaveAttribute('aria-current', 'page');
        await expect(list.getByRole('link', { name: /^Click/ })).toContainText(`Paga em 02${month}R$ 80,00`);
        await expect(list.getByRole('link', { name: /^Roxinho/ })).toContainText(`Em aberto · vence 10${month}R$ 150,00`);
        const listRegion = page.getByRole('region', { name: 'Lista de cartões' });
        await expect(listRegion).toContainText('Em aberto no mêsR$ 150,00');
        await expect(listRegion).toContainText('Total das faturasR$ 230,00');

        await list.getByRole('link', { name: /^Roxinho/ }).dispatchEvent('click');
        await expect(list.getByRole('link', { name: /^Roxinho/ })).toHaveAttribute('aria-current', 'page');

        await expect(page.getByText('Cartão de crédito · paga com Nubank')).toBeVisible();
        await expect(page.getByRole('heading', { name: /^Roxinho — fatura de/, level: 2 })).toBeVisible();
        const figures = page.getByRole('region', { name: 'Resumo da fatura' });
        await expect(figures).toContainText('Total a pagarR$ 150,00Em aberto');
        await expect(figures).toContainText(`Fechamento03${month}Todo dia 3`);
        await expect(figures).toContainText(`Vencimento10${month}Entra no previsto de Nubank`);
        // Limite usado: todas as faturas em aberto, a do mês (150) e a seguinte (400), sobre 5.000.
        await expect(figures).toContainText('Limite usado11%de R$ 5.000,00');
        const lines = page.getByRole('region', { name: 'Lançamentos' });
        await expect(lines.getByRole('row').nth(1)).toContainText(`10${monthSuffix(shiftPeriod(period, -1))}Farmácia`);
        await expect(lines).toContainText('TotalR$ 150,00');
        const upcoming = page.getByRole('region', { name: 'Próximas faturas deste cartão' });
        await expect(upcoming.getByRole('link')).toHaveCount(1);
        await expect(upcoming.getByRole('link')).toContainText('R$ 400,00');

        // Pagamento parcial: transferência negativa na fatura, que continua em aberto.
        await page.getByRole('button', { name: 'Pagamento parcial' }).dispatchEvent('click');
        const partial = page.getByRole('dialog', { name: /^Pagamento parcial da fatura/ });
        await partial.getByLabel(/^Valor pago/).fill('1.000,00');
        await chooseOption(page, 'Subcategoria', 'Aluguel');
        await partial.getByRole('button', { name: 'Lançar pagamento' }).dispatchEvent('click');
        await expect(partial).toContainText('A fatura tem R$ 150,00 a pagar; para quitar tudo, use "Pagar fatura".');
        await partial.getByLabel(/^Valor pago/).fill('50');
        await partial.getByLabel('Data do pagamento').fill(`${period}-04`);
        await partial.getByRole('button', { name: 'Lançar pagamento' }).dispatchEvent('click');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(lines.getByRole('row').nth(2)).toContainText(`04${month}Pagamento parcialpagamento parcialde Nubank`);
        await expect(lines.getByRole('row').nth(2)).toContainText('⇄ −R$ 50,00');
        await expect(lines).toContainText('TotalR$ 100,00');
        await expect(figures).toContainText('Total a pagarR$ 100,00Em aberto');

        // Pagar: a conta é a pagadora do cartão, e a prévia diz o saldo depois do pagamento.
        await page.getByRole('button', { name: 'Pagar fatura' }).dispatchEvent('click');
        const pay = page.getByRole('dialog', { name: /^Pagar fatura de/ });
        await expect(pay).toContainText('Valor a pagarR$ 100,00');
        await expect(pay).toContainText('Pagar comNubank');
        await pay.getByLabel('Data do pagamento').fill(`${period}-07`);
        // Consolidado do mês: 1.000 de saldo inicial − 50 do parcial − 80 do Click pago no dia 2.
        await expect(pay).toContainText('A fatura vira paga no extrato de');
        await expect(pay).toContainText('R$ 870,00 → R$ 770,00');
        await pay.getByRole('button', { name: 'Confirmar pagamento' }).dispatchEvent('click');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(figures).toContainText(`Total a pagarR$ 100,00Paga em 07${month}`);
        await expect(list.getByRole('link', { name: /^Roxinho/ })).toContainText(`Paga em 07${month}`);
        await expect(listRegion).toContainText('Em aberto no mêsR$ 0,00');
        await expect(page.getByRole('button', { name: 'Reabrir fatura' })).toBeVisible();

        // O extrato do mês do pagamento já mostra a fatura paga no dia.
        await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Contas', exact: true }).dispatchEvent('click');
        const movements = page.getByRole('region', { name: 'Movimentos' });
        const invoiceRow = movements.getByRole('row', { name: new RegExp(`^07${month} Fatura Roxinho`) });
        await expect(invoiceRow).toContainText('Paga−R$ 100,00');
        await expect(movements.getByRole('row', { name: new RegExp(`^04${month} Pagamento parcial`) })).toContainText('⇄ −R$ 50,00');
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

test('fatura: reabrir, "ver fatura" de outro mês, próximas faturas, troca do mês e cartão novo', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        await completeFirstUse(page, { profileName: 'Gustavo', accountName: 'Nubank', openingBalance: '1.000,00' });
        const period = currentPeriod(new Date());
        const next = shiftPeriod(period, 1);
        await seedCards(page, period);
        await openCards(page);

        const list = page.getByRole('list', { name: 'Cartões' });
        await expect(list.getByRole('link', { name: /^Click/ })).toHaveAttribute('aria-current', 'page');
        await page.getByRole('button', { name: 'Reabrir fatura' }).dispatchEvent('click');
        const reopen = page.getByRole('dialog', { name: /^Reabrir a fatura de/ });
        await expect(reopen).toContainText('O pagamento de R$ 80,00 sai do extrato de');
        await expect(reopen).toContainText('e o saldo dela volta como se ele não tivesse acontecido');
        await reopen.getByRole('button', { name: 'Reabrir fatura' }).dispatchEvent('click');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page.getByRole('region', { name: 'Resumo da fatura' })).toContainText('Total a pagarR$ 80,00Em aberto');
        await expect(list.getByRole('link', { name: /^Click/ })).toContainText('Em aberto · vence');

        // Próxima fatura do Roxinho: abre pela URL (`invoice`), fora do mês de referência.
        await list.getByRole('link', { name: /^Roxinho/ }).dispatchEvent('click');
        await page.getByRole('region', { name: 'Próximas faturas deste cartão' }).getByRole('link').dispatchEvent('click');
        await expect(page).toHaveURL(new RegExp(`invoice=${next}`));
        await expect(page.getByRole('note')).toContainText('Esta fatura não é a do mês de referência.');
        await expect(page.getByRole('region', { name: 'Lançamentos' })).toContainText('Notebook');
        await page.getByRole('note').getByRole('link').dispatchEvent('click');
        await expect(page).not.toHaveURL(/invoice=/);
        await expect(page.getByRole('region', { name: 'Lançamentos' })).toContainText('Farmácia');

        // Trocar o mês na barra leva o detalhe junto: a fatura do link sai da URL.
        await page.getByRole('region', { name: 'Próximas faturas deste cartão' }).getByRole('link').dispatchEvent('click');
        await expect(page).toHaveURL(new RegExp(`invoice=${next}`));
        await page.getByRole('button', { name: 'Mês anterior' }).dispatchEvent('click');
        await expect(page).toHaveURL(new RegExp(`period=${shiftPeriod(period, -1)}`));
        await expect(page).not.toHaveURL(/invoice=/);
        await expect(page.getByRole('note')).toHaveCount(0);
        await expect(page.getByRole('region', { name: 'Lançamentos' })).toContainText('Nenhum lançamento na fatura de');
        await expect(page.getByRole('button', { name: 'Pagar fatura' })).toBeDisabled();

        // Cartão novo abre a fatura dele; desativar pelo "⋯" marca na lista.
        await page.getByRole('button', { name: '+ Novo cartão' }).dispatchEvent('click');
        const dialog = page.getByRole('dialog', { name: 'Novo cartão' });
        await dialog.getByLabel('Nome', { exact: true }).fill('Inter');
        await dialog.getByLabel(/^Limite/).fill('1.500,00');
        await dialog.getByLabel('Dia do fechamento').fill('20');
        await dialog.getByLabel('Dia do vencimento').fill('28');
        await dialog.getByRole('button', { name: 'Criar cartão' }).dispatchEvent('click');
        await expect(page.getByRole('heading', { name: /^Inter — fatura de/, level: 2 })).toBeVisible();
        await expect(list.getByRole('link', { name: /^Inter/ })).toHaveAttribute('aria-current', 'page');
        await expect(list.getByRole('link', { name: /^Inter/ })).toContainText('Sem lançamentos');

        await page.getByRole('button', { name: 'Mais ações' }).press('Enter');
        const disable = page.getByRole('menuitem', { name: 'Desativar cartão' });
        await disable.focus();
        await disable.press('Enter');
        await expect(list.getByRole('link', { name: /^Inter/ })).toContainText('Desativado');
        await expect(page.getByText('Cartão de crédito · paga com Nubank · desativado')).toBeVisible();
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

test('fatura: editar e excluir as compras pela fatura, que Transações agrupa', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        await completeFirstUse(page, { profileName: 'Gustavo', accountName: 'Nubank', openingBalance: '1.000,00' });
        const period = currentPeriod(new Date());
        await seedCards(page, period);
        await openCards(page);
        await page.getByRole('list', { name: 'Cartões' }).getByRole('link', { name: /^Roxinho/ }).dispatchEvent('click');
        const lines = page.getByRole('region', { name: 'Lançamentos' });
        const pharmacy = lines.getByRole('row').filter({ hasText: 'Farmácia' });
        await expect(pharmacy).toContainText('R$ 150,00');

        // O clique na linha abre o mesmo diálogo de edição de Transações.
        await pharmacy.dispatchEvent('click');
        const editor = page.getByRole('dialog', { name: 'Editar Farmácia' });
        await expect(editor).toContainText(`Roxinho · fat.`);
        await editor.getByLabel('Valor (BRL)').fill('180,00');
        await editor.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');
        await expect(editor).toHaveCount(0);
        await expect(pharmacy).toContainText('R$ 180,00');

        // O "⋯" exclui, com o alerta de Transações.
        await lines.getByRole('button', { name: 'Ações de Farmácia' }).press('Enter');
        const remove = page.getByRole('menuitem', { name: 'Excluir…' });
        await remove.focus();
        await remove.press('Enter');
        await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir lançamento' }).dispatchEvent('click');
        await expect(pharmacy).toHaveCount(0);
    } finally {
        await app.close();
        removeUserData(userData);
    }
});
