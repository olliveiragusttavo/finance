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
 * @param period Mês `YYYY-MM`.
 * @return O mesmo mês do ano anterior; `shiftPeriod` só anda um mês por vez.
 */
function yearBefore(period: string): string {
    return `${String(Number(period.slice(0, 4)) - 1)}${period.slice(4)}`;
}

/**
 * Abre o editor de um relatório novo pelo "+ Novo" da lista.
 *
 * @param page Janela do app, na página de Relatórios.
 */
async function newReport(page: Page): Promise<void> {
    await page.getByRole('region', { name: 'Lista de relatórios' }).getByRole('link', { name: '+ Novo', exact: true }).dispatchEvent('click');
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
        // Sem relatório salvo, abre o primeiro fixo, e a lista convida a montar um.
        await expect(detail.getByRole('heading', { name: 'Projeção de saldo', level: 2 })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Meus relatórios' })).toContainText('Nenhum relatório salvo');
        await newReport(page);

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
        const list = page.getByRole('list', { name: 'Relatórios', exact: true });
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
        await expect(detail.getByRole('heading', { name: 'Projeção de saldo', level: 2 })).toBeVisible();
        await expect(list).toHaveCount(0);
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

test('relatórios: a pizza por categoria esconde a segunda divisão e mostra a participação na legenda', async () => {
    const { app, window: page, userData } = await launchApp();
    const period = currentPeriod(new Date());
    try {
        await completeFirstUse(page, { profileName: 'Pessoal', accountName: 'Nubank', openingBalance: '1.000,00' });
        await seed(page, period);
        await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Relatórios' }).dispatchEvent('click');
        await newReport(page);

        const form = page.getByRole('form', { name: 'Novo relatório' });
        const preview = page.getByRole('region', { name: 'Resultado ao vivo' });
        await expect(form.getByLabel('Colunas')).toBeVisible();
        await chooseOption(page, form.getByLabel('Mostrar como'), 'Gráfico de pizza');
        await expect(form.getByLabel('Fatias')).toBeVisible();
        await expect(form.getByLabel('Séries')).toHaveCount(0);

        // R$ 2.000,00 de aluguel e R$ 300,00 de mercado: 87,0% e 13,0% do total.
        await expect(preview.getByRole('img', { name: /Gráfico de Novo relatório/ })).toBeVisible();
        const legend = preview.getByRole('list', { name: 'Legenda' });
        await expect(legend.getByRole('listitem').nth(0)).toContainText(/Moradia.*R\$ 2\.000,00.*87,0%/);
        await expect(legend.getByRole('listitem').nth(1)).toContainText(/Alimentação.*R\$ 300,00.*13,0%/);
        await preview.getByRole('button', { name: 'Tabela', exact: true }).dispatchEvent('click');
        await expect(preview.getByRole('table', { name: 'Novo relatório' }).getByRole('row', { name: /^Total/ })).toContainText('R$ 2.300,00');
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

test('relatórios: num gráfico de 13 meses, o mês final e o do ano anterior não se confundem', async () => {
    const { app, window: page, userData } = await launchApp();
    const period = currentPeriod(new Date());
    try {
        await completeFirstUse(page, { profileName: 'Pessoal', accountName: 'Nubank', openingBalance: '1.000,00' });
        await seed(page, period);
        // O mesmo mês do ano anterior ganha um valor próprio, diferente dos R$ 2.300,00 do mês corrente.
        await page.evaluate(async ({ lastYear }) => {
            const { core } = window.finance;
            const { lastProfileId: profileId } = await window.finance.preferences.get();
            const accounts = profileId === null ? null : await core.call('accounts.list', { profileId, period: lastYear });
            const tree = profileId === null ? null : await core.call('categories.tree', { profileId });
            const account = accounts?.ok ? accounts.data.accounts[0] : undefined;
            const market = tree?.ok ? tree.data.find((branch) => branch.name === 'Alimentação')?.subCategories.find((child) => child.name === 'Mercado')?.id : undefined;
            if (profileId === null || account === undefined || market === undefined) {
                throw new Error('cenário incompleto');
            }
            const day = `${lastYear}-15`;
            await core.call('transactions.create', { profileId, subCategoryId: market, type: 'expense', source: { kind: 'account', accountId: account.id }, name: 'Mercado', value: 700, dueDate: day, paymentDate: day });
        }, { lastYear: yearBefore(period) });
        await page.reload();
        await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Relatórios' }).dispatchEvent('click');
        await newReport(page);

        const form = page.getByRole('form', { name: 'Novo relatório' });
        const preview = page.getByRole('region', { name: 'Resultado ao vivo' });
        await chooseOption(page, form.getByLabel('Mostrar como'), 'Gráfico de barras');
        await chooseOption(page, form.getByLabel('Eixo'), 'Mês');
        await form.getByLabel('Meses anteriores').fill('12');
        const chart = preview.getByRole('img', { name: /Gráfico de Novo relatório/ });
        await expect(chart).toBeVisible();

        // Os dois meses de mesmo nome são barras próprias, além do mês anterior (as de valor zero
        // não se desenham), e as pontas do eixo trazem o ano: sem ele, os dois viravam uma
        // categoria só, com os números do ano anterior.
        await expect(chart.locator('.recharts-bar-rectangle')).toHaveCount(3);
        await expect(chart).toContainText(formatMonthShort(yearBefore(period)));
        await expect(chart).toContainText(formatMonthShort(period));
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

test('relatórios: a análise mostra o resultado da entrada e saída e a variação sobre o mês anterior', async () => {
    const { app, window: page, userData } = await launchApp();
    const period = currentPeriod(new Date());
    try {
        await completeFirstUse(page, { profileName: 'Pessoal', accountName: 'Nubank', openingBalance: '1.000,00' });
        await seed(page, period);
        await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Relatórios' }).dispatchEvent('click');
        await newReport(page);

        const form = page.getByRole('form', { name: 'Novo relatório' });
        const preview = page.getByRole('region', { name: 'Resultado ao vivo' });
        await expect(form.getByText('Este formato ainda não tem análise.')).toBeVisible();
        // A janela não rola: só o formulário e o resultado rolam, cada um por dentro, e o menu fica
        // parado. Os <select> nativos escondidos do Radix esticavam a página quando escapavam.
        expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0);
        await chooseOption(page, form.getByLabel('Linhas'), 'Mês');
        await chooseOption(page, form.getByLabel('Colunas'), 'Entrada ou saída');
        await form.getByLabel('Meses anteriores').fill('1');
        await expect(form.getByText('O resultado: o total das entradas menos o das saídas.')).toBeVisible();
        await form.getByLabel('Análise').dispatchEvent('click');

        // Só despesas: a saída do mês anterior foi R$ 100,00 e a deste, R$ 2.300,00 — o valor, negativo, caiu 2.200%.
        const table = preview.getByRole('table', { name: 'Novo relatório' });
        await expect(table.getByRole('columnheader', { name: 'Resultado' })).toBeVisible();
        const current = table.getByRole('row', { name: new RegExp(formatMonthShort(period)) });
        await expect(current).toContainText('−R$ 2.300,00');
        await expect(current).toContainText('−2200,0% em relação ao mês anterior');
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

test('relatórios: a projeção de saldo fica fixada no topo, com a janela da estimativa escolhida na hora', async () => {
    const { app, window: page, userData } = await launchApp();
    const period = currentPeriod(new Date());
    try {
        await completeFirstUse(page, { profileName: 'Pessoal', accountName: 'Nubank', openingBalance: '1.000,00' });
        await seed(page, period);
        await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Relatórios' }).dispatchEvent('click');

        // No perfil pessoal só a projeção é fixa: a distribuição por sócio é do empresarial.
        const fixed = page.getByRole('list', { name: 'Relatórios fixos' });
        await expect(fixed.getByRole('link')).toHaveText(['Projeção de saldo']);
        const detail = page.getByRole('region', { name: 'Relatório aberto' });
        await expect(detail.getByRole('heading', { name: 'Projeção de saldo', level: 2 })).toBeVisible();

        // Saldo de hoje: R$ 1.000,00 iniciais − R$ 100,00 da feira do mês passado + R$ 5.000,00 de
        // salário − R$ 2.300,00 de despesas deste mês.
        await expect(detail.getByRole('group', { name: 'Saldo hoje' })).toContainText('R$ 3.600,00');
        // Só o mês anterior está fechado (a feira de R$ 100,00, avulsa): a estimativa de 12 meses usa só
        // ele, e com um mês não há como medir a variação — os dois avisos aparecem.
        await expect(detail.getByRole('group', { name: 'Avulsos por mês' })).toContainText('−R$ 100,00');
        await expect(detail.getByRole('status').filter({ hasText: 'O histórico tem só 1 mês fechado' })).toBeVisible();
        await expect(detail.getByRole('status').filter({ hasText: 'sem faixa' })).toBeVisible();
        await expect(detail.getByRole('group', { name: 'Média dos últimos' }).getByRole('button', { name: '12 meses' })).toHaveAttribute('aria-pressed', 'true');
        await expect(detail.getByRole('img', { name: /Gráfico de Projeção de saldo/ })).toBeVisible();

        // Com a estimativa de 1 mês o histórico basta, e só o aviso da faixa fica; a tabela traz o fim
        // deste mês e os 12 seguintes, com o já lançado separado do estimado.
        await detail.getByRole('button', { name: '1 mês', exact: true }).dispatchEvent('click');
        await expect(detail.getByRole('status')).toHaveCount(1);
        await detail.getByRole('button', { name: 'Tabela', exact: true }).dispatchEvent('click');
        const table = detail.getByRole('table', { name: 'Saldo projetado' });
        await expect(table.getByRole('columnheader', { name: 'Já lançado' })).toBeVisible();
        await expect(table.getByRole('row')).toHaveCount(14);
        await expect(table.getByRole('row').nth(1)).toContainText(`${formatMonthShort(period)} (fim do mês)`);
        await expect(detail.getByRole('table', { name: 'Meses da estimativa' }).getByRole('row').nth(1)).toContainText('−R$ 100,00');
    } finally {
        await app.close();
        removeUserData(userData);
    }
});
