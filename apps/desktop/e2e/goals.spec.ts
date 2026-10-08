import { expect, test, type Locator, type Page } from '@playwright/test';
import { currentPeriod, shiftPeriod } from '../src/renderer/src/shell/referenceMonth.ts';
import { completeFirstUse } from './firstUse.ts';
import { launchApp, removeUserData } from './launchApp.ts';

/*
 * Metas (desktop-mvp-plan Fase 9.3) no app empacotado: criar a meta, vincular uma receita pelo
 * campo "Meta" do lançamento, ver o progresso e a tabela, editar e excluir. Os cliques usam
 * `dispatchEvent` e os menus e `Select` do Radix são operados pelo teclado, pelo motivo explicado
 * em `firstUse.ts`.
 */

/**
 * Abre Metas pelo menu, como o usuário.
 *
 * @param page Janela do app, com o shell aberto.
 */
async function openGoals(page: Page): Promise<void> {
    await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Metas', exact: true }).dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'Metas', level: 1 })).toBeVisible();
}

/**
 * Escolhe uma opção num `Select` do Radix pelo teclado, como em `transactions.spec.ts`.
 *
 * @param page Janela do app.
 * @param field Gatilho do campo.
 * @param option Nome da opção.
 */
async function chooseOption(page: Page, field: Locator, option: string): Promise<void> {
    await field.press('Enter');
    const item = page.getByRole('option', { name: option, exact: true });
    await item.focus();
    await item.press('Enter');
    await expect(page.getByRole('listbox')).toHaveCount(0);
}

test('meta: criar, vincular uma receita pelo lançamento, progresso, editar e excluir', async () => {
    const { app, window: page, userData } = await launchApp();
    const period = currentPeriod(new Date());
    try {
        await completeFirstUse(page, { profileName: 'Pessoal', accountName: 'Nubank', openingBalance: '1.000,00' });
        await openGoals(page);
        await expect(page.getByText('Nenhuma meta', { exact: true })).toBeVisible();

        await page.getByRole('button', { name: '+ Nova meta' }).dispatchEvent('click');
        const dialog = page.getByRole('dialog', { name: 'Nova meta' });
        await dialog.getByRole('button', { name: 'Criar meta' }).dispatchEvent('click');
        await expect(dialog.getByLabel('Nome')).toHaveAccessibleDescription('Informe o nome da meta.');
        await expect(dialog.getByLabel('Valor-alvo (BRL)')).toHaveAccessibleDescription('Informe o valor-alvo.');
        await dialog.getByLabel('Nome').fill('Viagem Floripa');
        await dialog.getByLabel('Valor-alvo (BRL)').fill('4.000,00');
        // Três meses à frente; o `shiftPeriod` anda um mês por vez.
        await dialog.getByLabel('Data-alvo (opcional)').fill(`${shiftPeriod(shiftPeriod(shiftPeriod(period, 1), 1), 1)}-15`);
        await dialog.getByRole('button', { name: 'Criar meta' }).dispatchEvent('click');

        await expect(page).toHaveURL(/goal=/);
        await expect(page.getByRole('heading', { name: 'Viagem Floripa', level: 2 })).toBeVisible();
        const progress = page.getByRole('region', { name: 'Progresso' });
        await expect(progress).toContainText('R$ 0,00 de R$ 4.000,00');
        await expect(page.getByRole('region', { name: 'Transações vinculadas' })).toContainText('Nenhuma transação paga vinculada ainda.');

        // Receita paga hoje, vinculada pelo campo "Meta", que só aparece em receita e transferência.
        await page.getByRole('button', { name: '+ Lançamento' }).dispatchEvent('click');
        const form = page.getByRole('dialog', { name: 'Novo lançamento' });
        await expect(form.getByLabel('Meta')).toHaveCount(0);
        await form.getByRole('radio', { name: 'Receita' }).dispatchEvent('click');
        await form.getByLabel('Valor (BRL)').fill('700,00');
        await form.getByLabel('Nome').fill('Freela');
        await form.getByLabel('Categoria', { exact: true }).dispatchEvent('click');
        const search = page.getByRole('combobox', { name: 'Buscar categoria' });
        await search.fill('alim merc');
        await search.press('Enter');
        await chooseOption(page, form.getByLabel('Conta ou cartão'), 'Nubank');
        await form.getByLabel('Pago').dispatchEvent('click');
        await chooseOption(page, form.getByLabel('Meta'), 'Viagem Floripa');
        await form.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');
        await expect(form).toHaveCount(0);

        // 700 de 4.000 = 17,5%, arredondado para 18%.
        await expect(progress).toContainText('R$ 700,00 de R$ 4.000,00');
        await expect(progress).toContainText('18%');
        await expect(page.getByRole('list', { name: 'Metas' }).getByRole('link', { name: /^Viagem Floripa/ })).toContainText('R$ 700,00 de R$ 4.000,00 · até 15/');
        await expect(page.getByRole('region', { name: 'Prazo e ritmo' })).toContainText('FaltaR$ 3.300,00para o valor-alvo');
        const rows = page.getByRole('region', { name: 'Transações vinculadas' }).getByRole('row');
        await expect(rows.nth(1)).toContainText('Freela');
        await expect(rows.nth(1)).toContainText('Alimentação › Mercado');
        await expect(rows.nth(1)).toContainText('R$ 700,00');
        await expect(rows.last()).toContainText('TotalR$ 700,00');

        await page.getByRole('button', { name: 'Editar meta' }).dispatchEvent('click');
        const editor = page.getByRole('dialog', { name: 'Editar Viagem Floripa' });
        await editor.getByLabel('Valor-alvo (BRL)').fill('1.400,00');
        await editor.getByLabel('Data-alvo (opcional)').fill('');
        await editor.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');
        await expect(editor).toHaveCount(0);
        await expect(progress).toContainText('50%');
        await expect(page.getByRole('region', { name: 'Prazo e ritmo' })).toContainText('Data-alvoSem data-alvometa sem prazo');

        await page.getByRole('button', { name: 'Mais ações' }).press('Enter');
        const remove = page.getByRole('menuitem', { name: 'Excluir meta…' });
        await remove.focus();
        await remove.press('Enter');
        const alert = page.getByRole('alertdialog');
        await expect(alert).toContainText('O lançamento vinculado perde o vínculo com Viagem Floripa e continua existindo');
        await alert.getByRole('button', { name: 'Excluir meta' }).dispatchEvent('click');
        await expect(page.getByText('Nenhuma meta', { exact: true })).toBeVisible();
    } finally {
        await app.close();
        removeUserData(userData);
    }
});
