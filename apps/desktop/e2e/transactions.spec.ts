import { expect, test, type Locator, type Page } from '@playwright/test';
import { formatMonthAbbreviation, formatMonthShort } from '@finance/client';
import { currentPeriod, shiftPeriod } from '../src/renderer/src/shell/referenceMonth.ts';
import { completeFirstUse } from './firstUse.ts';
import { launchApp, removeUserData } from './launchApp.ts';

/*
 * Transações (desktop-mvp-plan Fase 9) no app empacotado: lançar, editar, marcar pago e excluir
 * pelo diálogo e pelo teclado, a fatura sugerida do cartão com o aviso de reabertura, os filtros
 * na URL, a ordenação por coluna, o menu de contexto e o "+ Lançamento" das outras telas. Os
 * cliques usam `dispatchEvent` e as listas do Radix são operadas pelo teclado, pelo motivo
 * explicado em `firstUse.ts`.
 */

/** Ids que os testes semeiam pela ponte. */
interface Seeded {
    readonly profileId: string;
    readonly nubankId: string;
    readonly roxinhoId: string;
    readonly tagId: string;
}

/**
 * Semeia pela ponte o Tesouro, o cartão Roxinho (fecha 3, vence 10) com a fatura do mês paga — a
 * Farmácia do dia 10 do mês anterior cai nela — e a tag "viagem". Com `withMonth`, também o mês:
 * Salário pago, Aluguel pendente, Aporte para o Tesouro e o Notebook no cartão com a tag.
 *
 * @param page Janela do app, com o shell aberto.
 * @param withMonth Se semeia os lançamentos do mês.
 * @return Os ids do cenário.
 */
async function seed(page: Page, withMonth: boolean): Promise<Seeded> {
    const period = currentPeriod(new Date());
    return page.evaluate(
        async ({ period, previous, withMonth }) => {
            const { core } = window.finance;
            const { lastProfileId: profileId } = await window.finance.preferences.get();
            if (profileId === null) {
                throw new Error('nenhum perfil aberto');
            }
            const accounts = await core.call('accounts.list', { profileId, period });
            const tree = await core.call('categories.tree', { profileId });
            const nubank = accounts.ok ? accounts.data.accounts[0] : undefined;
            const food = tree.ok ? tree.data.find((category) => category.name === 'Alimentação') : undefined;
            const market = food?.subCategories.find((sub) => sub.name === 'Mercado');
            const savings = await core.call('accounts.create', { profileId, name: 'Tesouro', type: 'investment' });
            const roxinho = await core.call('creditCards.create', { profileId, accountId: nubank?.id ?? '', name: 'Roxinho', limit: 5000, closingDay: 3, dueDay: 10 });
            const tag = await core.call('tags.create', { profileId, name: 'viagem' });
            if (nubank === undefined || market === undefined || !savings.ok || !roxinho.ok || !tag.ok) {
                throw new Error('cenário incompleto');
            }
            const base = { profileId, subCategoryId: market.id } as const;
            const pharmacy = await core.call('transactions.create', { ...base, type: 'expense', source: { kind: 'creditCard', creditCardId: roxinho.data.id }, name: 'Farmácia', value: 150, dueDate: `${previous}-10` });
            if (!pharmacy.ok || pharmacy.data.container.kind !== 'invoice') {
                throw new Error('compra não criada');
            }
            await core.call('invoices.pay', { invoiceId: pharmacy.data.container.invoiceId, paymentDate: `${period}-02` });
            if (withMonth) {
                const nubankSource = { kind: 'account', accountId: nubank.id } as const;
                await core.call('transactions.create', { ...base, type: 'income', source: nubankSource, name: 'Salário', value: 9500, dueDate: `${period}-01`, paymentDate: `${period}-01` });
                await core.call('transactions.create', { ...base, type: 'expense', source: nubankSource, name: 'Aluguel', value: 2300, dueDate: `${period}-05` });
                await core.call('transactions.create', { ...base, type: 'transference', source: nubankSource, destinationAccountId: savings.data.id, name: 'Aporte', value: 500, dueDate: `${period}-10` });
                await core.call('transactions.create', { ...base, type: 'expense', source: { kind: 'creditCard', creditCardId: roxinho.data.id }, name: 'Notebook', value: 400, dueDate: `${period}-08`, tagIds: [tag.data.id] });
            }
            return { profileId, nubankId: nubank.id, roxinhoId: roxinho.data.id, tagId: tag.data.id };
        },
        { period, previous: shiftPeriod(period, -1), withMonth },
    );
}

/**
 * Abre Transações pelo menu, como o usuário.
 *
 * @param page Janela do app, com o shell aberto.
 */
async function openTransactions(page: Page): Promise<void> {
    await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Transações', exact: true }).dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'Transações', level: 1 })).toBeVisible();
}

/**
 * Escolhe uma opção num `Select` do Radix pelo teclado, como em `cards.spec.ts`.
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

/**
 * Escolhe a subcategoria pela busca do campo "Categoria", como o usuário faz pelo teclado.
 *
 * @param page Janela do app.
 * @param panel Diálogo do formulário.
 * @param search Texto digitado na busca.
 */
async function chooseCategory(page: Page, panel: Locator, search: string): Promise<void> {
    await panel.getByLabel('Categoria', { exact: true }).dispatchEvent('click');
    const input = page.getByRole('combobox', { name: 'Buscar categoria' });
    await input.fill(search);
    await input.press('Enter');
    await expect(input).toHaveCount(0);
}

/**
 * @param page Janela do app.
 * @return A tabela de lançamentos.
 */
function grid(page: Page): Locator {
    return page.getByRole('region', { name: 'Lançamentos do mês' });
}

/**
 * @param page Janela do app.
 * @param name Nome do lançamento.
 * @return A linha do lançamento na tabela.
 */
function rowOf(page: Page, name: string): Locator {
    return grid(page).getByRole('row').filter({ hasText: name });
}

test('lança pelo diálogo, edita, marca pago e exclui pelo teclado', async () => {
    const { app, window: page, userData } = await launchApp();
    const period = currentPeriod(new Date());
    try {
        await completeFirstUse(page, { profileName: 'Pessoal', accountName: 'Nubank', openingBalance: '1.000,00' });
        await openTransactions(page);
        await expect(grid(page)).toContainText(`Nenhum lançamento em ${formatMonthShort(period)}.`);

        // `N` abre o diálogo desta tela, e não também o do shell.
        await page.keyboard.press('n');
        const column = page.getByRole('dialog', { name: 'Novo lançamento' });
        await expect(column).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveCount(1);

        await column.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');
        await expect(column.getByLabel('Valor (BRL)')).toHaveAccessibleDescription('Informe o valor.');
        await expect(column.getByLabel('Conta ou cartão')).toHaveAccessibleDescription('Escolha a conta ou o cartão.');

        await column.getByLabel('Valor (BRL)').fill('123,45');
        await expect(column.getByText('−R$ 123,45')).toBeVisible();
        await column.getByLabel('Nome').fill('Mercado');
        await chooseCategory(page, column, 'alim merc');
        await expect(column.getByLabel('Categoria', { exact: true })).toContainText('Alimentação › Mercado');
        await chooseOption(page, column.getByLabel('Conta ou cartão'), 'Nubank');
        await column.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');

        await expect(column).toHaveCount(0);
        await expect(rowOf(page, 'Mercado')).toContainText('Alimentação › Mercado');
        await expect(rowOf(page, 'Mercado')).toContainText('−R$ 123,45');
        await expect(rowOf(page, 'Mercado')).toContainText('Pendente');
        await expect(page.getByRole('search', { name: 'Filtros' })).toContainText('1 lançamento · resultado −R$ 123,45');

        // Clique abre a edição no diálogo.
        await rowOf(page, 'Mercado').dispatchEvent('click');
        const editor = page.getByRole('dialog', { name: 'Editar Mercado' });
        await expect(editor.getByRole('heading', { name: 'Editar Mercado' })).toBeVisible();
        await expect(editor).toContainText('Despesa · Nubank');
        await editor.getByLabel('Valor (BRL)').fill('150,00');
        await editor.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');
        await expect(editor).toHaveCount(0);
        await expect(rowOf(page, 'Mercado')).toContainText('−R$ 150,00');

        // "Excluir" no diálogo de edição abre a confirmação por cima; desistir volta à edição.
        await rowOf(page, 'Mercado').dispatchEvent('click');
        await editor.getByRole('button', { name: 'Excluir' }).dispatchEvent('click');
        await page.getByRole('alertdialog').getByRole('button', { name: 'Cancelar' }).dispatchEvent('click');
        await expect(page.getByRole('alertdialog')).toHaveCount(0);
        await expect(editor).toBeVisible();
        await editor.getByRole('button', { name: 'Cancelar' }).dispatchEvent('click');
        await expect(editor).toHaveCount(0);

        // Teclado: `P` marca pago com a data de hoje, `Del` pede confirmação e exclui.
        await rowOf(page, 'Mercado').focus();
        await page.keyboard.press('p');
        await expect(rowOf(page, 'Mercado')).toContainText('Pago');
        await page.keyboard.press('Delete');
        const confirm = page.getByRole('alertdialog');
        await expect(confirm.getByRole('heading', { name: 'Excluir “Mercado”?' })).toBeVisible();
        await expect(confirm).toContainText(`O lançamento de R$ 150,00 sai do extrato de ${formatMonthShort(period)}, e os saldos da conta Nubank são recalculados desse mês em diante.`);
        await confirm.getByRole('button', { name: 'Excluir lançamento' }).dispatchEvent('click');
        await expect(grid(page)).toContainText(`Nenhum lançamento em ${formatMonthShort(period)}.`);
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

test('compra no cartão: fatura sugerida, aviso ao escolher a fatura paga, e estorno pelo ±', async () => {
    const { app, window: page, userData } = await launchApp();
    const period = currentPeriod(new Date());
    const next = shiftPeriod(period, 1);
    try {
        await completeFirstUse(page, { profileName: 'Pessoal', accountName: 'Nubank' });
        await seed(page, false);
        await openTransactions(page);
        await page.keyboard.press('n');
        const column = page.getByRole('dialog', { name: 'Novo lançamento' });

        await column.getByLabel('Valor (BRL)').fill('23,90');
        await column.getByRole('button', { name: 'Inverter sinal (estorno)' }).dispatchEvent('click');
        await expect(column.getByText('+R$ 23,90')).toBeVisible();
        await expect(column.getByText('estorno', { exact: true })).toBeVisible();
        await column.getByLabel('Nome').fill('Estorno Uber');
        await chooseCategory(page, column, 'restaurantes');
        await chooseOption(page, column.getByLabel('Conta ou cartão'), 'Roxinho');
        // Compra no dia 5, depois do fechamento do dia 3: a sugestão é a fatura seguinte.
        await column.getByLabel('Data da compra').fill(`${period}-05`);
        const invoice = column.getByLabel('Fatura', { exact: true });
        await expect(invoice).toContainText(`${formatMonthShort(next)} · sugerida`);
        await expect(invoice).toHaveAccessibleDescription(new RegExp(`^Sugerida pela data da compra: ${formatMonthShort(next)}, vence 10/`));

        await chooseOption(page, invoice, `${formatMonthShort(period)} · paga`);
        await expect(column.getByRole('note').first()).toContainText(`A fatura de ${formatMonthShort(period)} já está paga. Ao salvar, ela será reaberta`);
        await chooseOption(page, invoice, `${formatMonthShort(next)} · sugerida`);
        await expect(column.getByText(/já está paga/)).toHaveCount(0);

        await column.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');
        // Regra de negócio (Transações): sem filtro, a compra no cartão fica na linha da fatura; a
        // tela diz em qual ela caiu. Filtrando pelo cartão, as compras voltam uma a uma.
        await expect(page.getByText(`Está na fatura Roxinho · ${formatMonthAbbreviation(next)}`)).toBeVisible();
        await expect(rowOf(page, 'Estorno Uber')).toHaveCount(0);
        await chooseOption(page, page.getByRole('search', { name: 'Filtros' }).getByLabel('Conta ou cartão'), 'Roxinho');
        await expect(rowOf(page, 'Estorno Uber')).toContainText(`Roxinho · fat. ${formatMonthAbbreviation(next)}`);
        await expect(rowOf(page, 'Estorno Uber')).toContainText('+R$ 23,90');
        await expect(rowOf(page, 'Estorno Uber')).toContainText('estorno');
        await expect(rowOf(page, 'Estorno Uber')).toContainText('Na fatura');

        // `P` numa compra no cartão não muda nada: a situação é a da fatura.
        await rowOf(page, 'Estorno Uber').focus();
        await page.keyboard.press('p');
        await expect(page.getByText('A situação de uma compra no cartão é a da fatura: pague ou reabra a fatura em Cartões.')).toBeVisible();
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

test('filtros ficam na URL, ordenação por coluna, menu de contexto e a tag aberta pelo painel de Tags', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        await completeFirstUse(page, { profileName: 'Pessoal', accountName: 'Nubank', openingBalance: '1.000,00' });
        await seed(page, true);
        await openTransactions(page);
        const filters = page.getByRole('search', { name: 'Filtros' });
        // Regra de negócio (Transações): sem filtro, o Notebook no cartão fica na fatura do mês
        // seguinte, e a Farmácia do mês anterior aparece como a fatura paga no dia 2.
        await expect(filters).toContainText('3 lançamentos · 1 fatura · resultado +R$ 7.050,00');
        await expect(rowOf(page, 'Notebook')).toHaveCount(0);
        const paidInvoice = rowOf(page, 'Fatura Roxinho');
        await expect(paidInvoice).toContainText(`02/${currentPeriod(new Date()).slice(5)}`);
        await expect(paidInvoice).toContainText('Fatura do cartão');
        await expect(paidInvoice).toContainText('−R$ 150,00');
        await expect(paidInvoice).toContainText('Paga');
        await expect(page.getByText(/As compras no cartão estão na linha de cada fatura/)).toBeVisible();
        await paidInvoice.dispatchEvent('click');
        // A Farmácia de dia 10 do mês anterior caiu na fatura deste mês (fecha dia 3).
        await expect(page).toHaveURL(new RegExp(`#/cards\\?.*invoice=${currentPeriod(new Date())}`));
        await page.goBack();
        await expect(page.getByRole('heading', { name: 'Transações', level: 1 })).toBeVisible();
        await expect(rowOf(page, 'Aporte')).toContainText('Nubank → Tesouro');
        await expect(rowOf(page, 'Aporte')).toContainText('⇄ R$ 500,00');

        await chooseOption(page, filters.getByLabel('Situação'), 'Pendente');
        await expect(page).toHaveURL(/situation=pending/);
        await expect(filters).toContainText('2 lançamentos · resultado −R$ 2.300,00');
        await page.reload();
        await expect(page.getByRole('search', { name: 'Filtros' })).toContainText('2 lançamentos');

        await page.getByRole('searchbox').fill('zzz');
        await expect(grid(page)).toContainText('Nenhum lançamento com esses filtros.');
        await grid(page).getByRole('button', { name: 'Limpar filtros' }).dispatchEvent('click');
        await expect(page.getByRole('search', { name: 'Filtros' })).toContainText('3 lançamentos · 1 fatura');
        await expect(page).not.toHaveURL(/situation=/);

        // Ordenar pelo valor: crescente põe as maiores saídas primeiro.
        const amountHeader = grid(page).getByRole('columnheader', { name: /Valor/ });
        await amountHeader.getByRole('button').dispatchEvent('click');
        await expect(amountHeader).toHaveAttribute('aria-sort', 'ascending');
        await expect(grid(page).getByRole('row').nth(1)).toContainText('Aluguel');
        await amountHeader.getByRole('button').dispatchEvent('click');
        await expect(amountHeader).toHaveAttribute('aria-sort', 'descending');
        await expect(grid(page).getByRole('row').nth(1)).toContainText('Salário');

        // Botão direito: as mesmas ações do teclado.
        await rowOf(page, 'Aluguel').dispatchEvent('contextmenu', { button: 2 });
        const menu = page.getByRole('menu');
        await expect(menu.getByRole('menuitem', { name: /Editar/ })).toBeVisible();
        await menu.getByRole('menuitem', { name: /Marcar como pago/ }).press('Enter');
        await expect(rowOf(page, 'Aluguel')).toContainText('Pago');

        await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Cadastros', exact: true }).dispatchEvent('click');
        await page.getByRole('region', { name: 'Tipos de cadastro' }).getByRole('link', { name: /^Tags/ }).dispatchEvent('click');
        await page.getByRole('button', { name: 'Editar a tag viagem' }).dispatchEvent('click');
        await page.getByRole('link', { name: 'Ver lançamentos em Transações →' }).dispatchEvent('click');
        await expect(page.getByRole('heading', { name: 'Transações', level: 1 })).toBeVisible();
        await expect(page.getByRole('search', { name: 'Filtros' })).toContainText('1 lançamento · resultado −R$ 400,00');
        await expect(grid(page)).toContainText('Notebook');
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

test('"+ Lançamento" em outra tela abre o diálogo; editar mês passado avisa o recálculo', async () => {
    const { app, window: page, userData } = await launchApp();
    const period = currentPeriod(new Date());
    const previous = shiftPeriod(period, -1);
    try {
        await completeFirstUse(page, { profileName: 'Pessoal', accountName: 'Nubank', openingBalance: '1.000,00' });
        await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Contas', exact: true }).dispatchEvent('click');
        await page.getByRole('button', { name: '+ Lançamento' }).dispatchEvent('click');
        const sheet = page.getByRole('dialog', { name: 'Novo lançamento' });
        await expect(sheet).toBeVisible();
        await sheet.getByLabel('Valor (BRL)').fill('80,00');
        await sheet.getByLabel('Nome').fill('Padaria');
        await chooseCategory(page, sheet, 'mercado');
        await chooseOption(page, sheet.getByLabel('Conta ou cartão'), 'Nubank');
        await sheet.getByLabel('Data', { exact: true }).fill(`${previous}-20`);
        await expect(sheet.getByRole('note')).toContainText(`Este lançamento mexe em ${formatMonthShort(previous)}, um mês passado: ao salvar, os saldos dos meses seguintes são recalculados.`);
        await sheet.getByLabel('Pago').dispatchEvent('click');
        await sheet.getByLabel('Data do pagamento').fill(`${previous}-20`);
        await sheet.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');
        await expect(sheet).toHaveCount(0);

        // O extrato do mês já reflete o lançamento do mês anterior, sem recarregar.
        await expect(page.getByRole('region', { name: 'Resumo do extrato' })).toContainText('Saldo inicialR$ 920,00previsto R$ 920,00');

        await openTransactions(page);
        await page.keyboard.press('[');
        await rowOf(page, 'Padaria').dispatchEvent('click');
        const editor = page.getByRole('dialog', { name: 'Editar Padaria' });
        await expect(editor.getByRole('note')).toContainText(`Este lançamento mexe em ${formatMonthShort(previous)}, um mês passado`);
    } finally {
        await app.close();
        removeUserData(userData);
    }
});
