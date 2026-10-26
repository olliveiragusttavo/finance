import { expect, test, type Locator, type Page } from '@playwright/test';
import { formatMonthShort } from '@finance/client';
import { currentPeriod, shiftPeriod } from '../src/renderer/src/shell/referenceMonth.ts';
import { completeFirstUse } from './firstUse.ts';
import { launchApp, removeUserData } from './launchApp.ts';

/*
 * Relatórios personalizados (reports-design, Fase 15) no app empacotado: o editor com o resultado
 * ao vivo, salvar, abrir na lista, editar para um gráfico por mês e excluir. Os cliques usam
 * `dispatchEvent`, pelo motivo explicado em `firstUse.ts`.
 */

/**
 * Semeia pela ponte, nas categorias sugeridas do primeiro uso e todas pagas: Mercado de R$ 300,00
 * e Aluguel de R$ 2.000,00 no mês corrente,
 * Mercado de R$ 100,00 no mês anterior e o Salário de R$ 5.000,00 — a receita que o relatório de
 * despesas deixa de fora. Depois recarrega, porque a escrita pela ponte não passa pelo mapa de
 * invalidação da tela.
 *
 * @param page Janela do app, com o shell aberto no perfil do primeiro uso.
 * @param period Mês corrente.
 */
async function seed(page: Page, period: string): Promise<void> {
    await page.evaluate(
        async ({ period, previous }) => {
            const { core } = window.finance;
            const { lastProfileId: profileId } = await window.finance.preferences.get();
            if (profileId === null) {
                throw new Error('nenhum perfil aberto');
            }
            const accounts = await core.call('accounts.list', { profileId, period });
            const tree = await core.call('categories.tree', { profileId });
            const account = accounts.ok ? accounts.data.accounts[0] : undefined;
            const find = (category: string, sub: string): string | undefined => (tree.ok ? tree.data.find((branch) => branch.name === category)?.subCategories.find((child) => child.name === sub)?.id : undefined);
            const market = find('Alimentação', 'Mercado');
            const rent = find('Moradia', 'Aluguel');
            if (account === undefined || market === undefined || rent === undefined) {
                throw new Error('cenário incompleto');
            }
            const source = { kind: 'account', accountId: account.id } as const;
            const paid = (day: string): { readonly dueDate: string; readonly paymentDate: string } => ({ dueDate: day, paymentDate: day });
            await core.call('transactions.create', { profileId, subCategoryId: market, type: 'expense', source, name: 'Mercado', value: 300, ...paid(`${period}-05`) });
            await core.call('transactions.create', { profileId, subCategoryId: rent, type: 'expense', source, name: 'Aluguel', value: 2000, ...paid(`${period}-06`) });
            await core.call('transactions.create', { profileId, subCategoryId: market, type: 'expense', source, name: 'Feira', value: 100, ...paid(`${previous}-10`) });
            await core.call('transactions.create', { profileId, subCategoryId: market, type: 'income', source, name: 'Salário', value: 5000, ...paid(`${period}-01`) });
        },
        { period, previous: shiftPeriod(period, -1) },
    );
    await page.reload();
}

/**
 * Escolhe uma opção num `Select` do Radix pelo teclado: o foco vai direto à opção e o Enter
 * confirma, como em `cards.spec.ts`.
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

test('relatórios: montar com o resultado ao vivo, salvar, editar para gráfico por mês e excluir', async () => {
    const { app, window: page, userData } = await launchApp();
    const period = currentPeriod(new Date());
    try {
        await completeFirstUse(page, { profileName: 'Pessoal', accountName: 'Nubank', openingBalance: '1.000,00' });
        await seed(page, period);
        await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Relatórios' }).dispatchEvent('click');
        const detail = page.getByRole('region', { name: 'Relatório aberto' });
        await expect(detail).toContainText('Nenhum relatório');
        await detail.getByRole('link', { name: '+ Novo relatório' }).dispatchEvent('click');

        // O relatório novo abre nas despesas do mês por categoria, e o resultado aparece antes do nome.
        const form = page.getByRole('form', { name: 'Novo relatório' });
        const preview = page.getByRole('region', { name: 'Resultado ao vivo' });
        const draftTable = preview.getByRole('table', { name: 'Novo relatório' });
        await expect(draftTable.getByRole('row', { name: /Moradia/ })).toContainText('R$ 2.000,00');
        await expect(draftTable.getByRole('row', { name: /Alimentação/ })).toContainText('R$ 300,00');
        await expect(draftTable.getByRole('row', { name: /^Total/ })).toContainText('R$ 2.300,00');

        await form.getByRole('button', { name: 'Salvar relatório' }).dispatchEvent('click');
        await expect(form).toContainText('Dê um nome ao relatório.');
        await form.getByLabel('Nome').fill('Gastos do mês');
        await form.getByRole('button', { name: 'Salvar relatório' }).dispatchEvent('click');

        await expect(page).toHaveURL(/#\/reports\?.*report=/);
        const list = page.getByRole('list', { name: 'Relatórios' });
        await expect(list.getByRole('link', { name: 'Gastos do mês' })).toHaveAttribute('aria-current', 'page');
        await expect(detail.getByRole('heading', { name: 'Gastos do mês', level: 2 })).toBeVisible();
        await expect(detail).toContainText(`${formatMonthShort(period)} · pela data de pagamento`);
        await expect(detail.getByRole('list', { name: 'Filtros' })).toContainText('Tipo: Despesa');
        await expect(detail.getByRole('table', { name: 'Gastos do mês' }).getByRole('row', { name: /^Total/ })).toContainText('R$ 2.300,00');

        // Editar: gráfico de linha por mês, com o mês anterior.
        await detail.getByRole('link', { name: 'Editar' }).dispatchEvent('click');
        const editForm = page.getByRole('form', { name: 'Editar Gastos do mês' });
        await chooseOption(page, editForm.getByLabel('Mostrar como'), 'Gráfico de linha');
        await chooseOption(page, editForm.getByLabel('Eixo'), 'Mês');
        await editForm.getByLabel('Meses anteriores').fill('1');
        await expect(preview.getByRole('img', { name: /Gráfico de Gastos do mês/ })).toBeVisible();
        await preview.getByRole('button', { name: 'Tabela', exact: true }).dispatchEvent('click');
        const months = preview.getByRole('table', { name: 'Gastos do mês' });
        await expect(months.getByRole('row', { name: new RegExp(formatMonthShort(shiftPeriod(period, -1))) })).toContainText('R$ 100,00');
        await expect(months.getByRole('row', { name: new RegExp(formatMonthShort(period)) })).toContainText('R$ 2.300,00');
        await editForm.getByRole('button', { name: 'Salvar relatório' }).dispatchEvent('click');

        await expect(detail).toContainText(`${formatMonthShort(shiftPeriod(period, -1))} a ${formatMonthShort(period)} · pela data de pagamento`);
        await expect(detail.getByRole('img', { name: /Gráfico de Gastos do mês/ })).toBeVisible();

        // Excluir pede confirmação e só apaga a configuração.
        await detail.getByRole('button', { name: 'Excluir' }).dispatchEvent('click');
        const alert = page.getByRole('alertdialog');
        await expect(alert).toContainText('os lançamentos continuam como estão');
        await alert.getByRole('button', { name: 'Excluir relatório' }).dispatchEvent('click');
        await expect(detail).toContainText('Nenhum relatório');
        await expect(list).toHaveCount(0);
    } finally {
        await app.close();
        removeUserData(userData);
    }
});
