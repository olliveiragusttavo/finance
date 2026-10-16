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
 * Escolhe a opção já visível da lista aberta. No seletor com busca dos cadastros (`Combobox`,
 * desktop-mvp-plan Fase 13.2) o foco fica no campo de busca e a opção não recebe foco, então o
 * clique (por `dispatchEvent`, como os outros cliques destes testes) é o caminho; no `Select` do Radix, que ficou nas listas curtas, o foco vai direto à
 * opção e o Enter confirma, sem a busca por digitação do Radix, que pode parar numa opção de nome
 * parecido.
 *
 * @param page Janela do app.
 * @param item Opção a escolher.
 */
async function pickOption(page: Page, item: Locator): Promise<void> {
    if ((await page.getByRole('combobox', { name: /^Buscar/ }).count()) > 0) {
        await item.dispatchEvent('click');
        return;
    }
    await item.focus();
    await item.press('Enter');
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
    await pickOption(page, item);
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
        // A vinculada se edita ali mesmo, na listagem comum de movimentos (desktop-mvp-plan Fase 13.3).
        await rows.nth(1).dispatchEvent('click');
        const edit = page.getByRole('dialog', { name: 'Editar Freela' });
        await edit.getByLabel('Nome').fill('Freela do site');
        await edit.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');
        await expect(edit).toHaveCount(0);
        await expect(rows.nth(1)).toContainText('Freela do site');

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

test('meta vinculada a conta mede o saldo; a transferência de retirada desconta da meta por lançamentos', async () => {
    const { app, window: page, userData } = await launchApp();
    const period = currentPeriod(new Date());
    try {
        await completeFirstUse(page, { profileName: 'Pessoal', accountName: 'Nubank', openingBalance: '5.000,00' });
        // O Tesouro, de investimento, começa com R$ 2.000,00 e recebe R$ 1.000,00 no dia 1º,
        // guardados na meta "Reserva", por lançamentos.
        await page.evaluate(async (period) => {
            const { core } = window.finance;
            const { lastProfileId: profileId } = await window.finance.preferences.get();
            if (profileId === null) {
                throw new Error('nenhum perfil aberto');
            }
            const accounts = await core.call('accounts.list', { profileId, period });
            const tree = await core.call('categories.tree', { profileId });
            const nubank = accounts.ok ? accounts.data.accounts[0] : undefined;
            const subCategory = tree.ok ? tree.data[0]?.subCategories[0] : undefined;
            const savings = await core.call('accounts.create', { profileId, name: 'Tesouro', type: 'investment', openingBalance: 2000 });
            const reserve = await core.call('goals.create', { profileId, name: 'Reserva', value: 10000 });
            if (nubank === undefined || subCategory === undefined || !savings.ok || !reserve.ok) {
                throw new Error('cenário incompleto');
            }
            await core.call('transactions.create', {
                profileId,
                subCategoryId: subCategory.id,
                type: 'transference',
                source: { kind: 'account', accountId: nubank.id },
                destinationAccountId: savings.data.id,
                name: 'Guardar',
                value: 1000,
                dueDate: `${period}-01`,
                paymentDate: `${period}-01`,
                goalId: reserve.data.id,
            });
        }, period);
        await page.reload();
        await openGoals(page);

        await page.getByRole('button', { name: '+ Nova meta' }).dispatchEvent('click');
        const dialog = page.getByRole('dialog', { name: 'Nova meta' });
        await dialog.getByLabel('Nome').fill('Casa');
        await dialog.getByRole('radio', { name: 'Saldo de uma conta' }).dispatchEvent('click');
        await dialog.getByRole('button', { name: 'Criar meta' }).dispatchEvent('click');
        await expect(dialog.getByLabel('Conta de investimento')).toHaveAccessibleDescription('Escolha a conta de investimento.');
        await chooseOption(page, dialog.getByLabel('Conta de investimento'), 'Tesouro');
        await dialog.getByLabel('Valor-alvo (BRL)').fill('10.000,00');
        await dialog.getByRole('button', { name: 'Criar meta' }).dispatchEvent('click');

        await expect(page.getByRole('heading', { name: 'Casa', level: 2 })).toBeVisible();
        await expect(page.getByText('Meta de economia · Saldo de Tesouro')).toBeVisible();
        await expect(page.getByRole('region', { name: 'Progresso' })).toContainText('R$ 3.000,00 de R$ 10.000,00');
        await expect(page.getByRole('link', { name: 'Ver extrato da conta →' })).toBeVisible();

        // Retirada da reserva para um imprevisto: sai do Tesouro e desconta da meta "Reserva".
        await page.getByRole('button', { name: '+ Lançamento' }).dispatchEvent('click');
        const form = page.getByRole('dialog', { name: 'Novo lançamento' });
        await form.getByRole('radio', { name: 'Transferência' }).dispatchEvent('click');
        await form.getByLabel('Valor (BRL)').fill('300,00');
        await form.getByLabel('Nome').fill('Conserto do carro');
        await form.getByLabel('Categoria', { exact: true }).dispatchEvent('click');
        const search = page.getByRole('combobox', { name: 'Buscar categoria' });
        await search.fill('alim merc');
        await search.press('Enter');
        await chooseOption(page, form.getByLabel('Conta ou cartão'), 'Tesouro');
        await chooseOption(page, form.getByLabel('Conta de destino'), 'Nubank');
        await form.getByLabel('Pago').dispatchEvent('click');
        await chooseOption(page, form.getByLabel('Meta'), 'Reserva');
        await form.getByRole('radio', { name: 'Retirar da meta' }).dispatchEvent('click');
        await form.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');
        await expect(form).toHaveCount(0);

        await page.getByRole('list', { name: 'Metas' }).getByRole('link', { name: /^Reserva/ }).dispatchEvent('click');
        await expect(page.getByRole('region', { name: 'Progresso' })).toContainText('R$ 700,00 de R$ 10.000,00');
        const linked = page.getByRole('region', { name: 'Transações vinculadas' });
        await expect(linked.getByRole('row', { name: /Conserto do carro/ })).toContainText('retirada');
        await expect(linked.getByRole('row', { name: /Conserto do carro/ })).toContainText('−R$ 300,00');
        // O Tesouro perdeu os R$ 300,00: a meta vinculada a ele também.
        await page.getByRole('list', { name: 'Metas' }).getByRole('link', { name: /^Casa/ }).dispatchEvent('click');
        await expect(page.getByRole('region', { name: 'Progresso' })).toContainText('R$ 2.700,00 de R$ 10.000,00');
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

/**
 * Cria uma meta por lançamentos sem prazo pelo diálogo.
 *
 * @param page Janela do app, na tela Metas.
 * @param name Nome da meta.
 * @param value Valor-alvo em pt-BR.
 */
async function createGoal(page: Page, name: string, value: string): Promise<void> {
    await page.getByRole('button', { name: '+ Nova meta' }).dispatchEvent('click');
    const dialog = page.getByRole('dialog', { name: 'Nova meta' });
    await dialog.getByLabel('Nome').fill(name);
    await dialog.getByLabel('Valor-alvo (BRL)').fill(value);
    await dialog.getByRole('button', { name: 'Criar meta' }).dispatchEvent('click');
    await expect(dialog).toHaveCount(0);
}

test('visualizações de Metas: atingida e arquivada saem das ativas, e o campo "Meta" agrupa as atingidas', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        await completeFirstUse(page, { profileName: 'Pessoal', accountName: 'Nubank', openingBalance: '1.000,00' });
        await openGoals(page);
        await createGoal(page, 'Viagem', '100,00');
        await createGoal(page, 'Curso', '5.000,00');
        await createGoal(page, 'Carro', '50.000,00');

        // Receita que atinge a Viagem.
        await page.getByRole('button', { name: '+ Lançamento' }).dispatchEvent('click');
        const form = page.getByRole('dialog', { name: 'Novo lançamento' });
        await form.getByRole('radio', { name: 'Receita' }).dispatchEvent('click');
        await form.getByLabel('Valor (BRL)').fill('100,00');
        await form.getByLabel('Nome').fill('Bônus');
        await form.getByLabel('Categoria', { exact: true }).dispatchEvent('click');
        const search = page.getByRole('combobox', { name: 'Buscar categoria' });
        await search.fill('alim merc');
        await search.press('Enter');
        await chooseOption(page, form.getByLabel('Conta ou cartão'), 'Nubank');
        await form.getByLabel('Pago').dispatchEvent('click');
        await chooseOption(page, form.getByLabel('Meta'), 'Viagem');
        await form.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');
        await expect(form).toHaveCount(0);

        // Por padrão, só as ativas; a atingida está em "Atingidas".
        const list = page.getByRole('list', { name: 'Metas' });
        const views = page.getByRole('group', { name: 'Visualização' });
        await expect(list.getByRole('link')).toHaveText([/^Carro/, /^Curso/]);
        await views.getByRole('button', { name: 'Atingidas' }).dispatchEvent('click');
        await expect(list.getByRole('link')).toHaveText([/^Viagem/]);

        // Arquivar o Carro tira-o das ativas; ele aparece em "Arquivadas", com a etiqueta.
        await views.getByRole('button', { name: 'Ativas' }).dispatchEvent('click');
        await list.getByRole('link', { name: /^Carro/ }).dispatchEvent('click');
        await page.getByRole('button', { name: 'Mais ações' }).press('Enter');
        const archive = page.getByRole('menuitem', { name: 'Arquivar meta' });
        await archive.focus();
        await archive.press('Enter');
        await expect(page.getByRole('heading', { name: /^Carro/, level: 2 })).toContainText('Arquivada');
        await expect(views.getByRole('button', { name: 'Arquivadas' })).toHaveAttribute('aria-pressed', 'true');
        await views.getByRole('button', { name: 'Ativas' }).dispatchEvent('click');
        await expect(list.getByRole('link')).toHaveText([/^Curso/]);

        // No lançamento novo: as atingidas num grupo à parte, e a arquivada fora.
        await page.getByRole('button', { name: '+ Lançamento' }).dispatchEvent('click');
        const next = page.getByRole('dialog', { name: 'Novo lançamento' });
        await next.getByRole('radio', { name: 'Receita' }).dispatchEvent('click');
        await next.getByLabel('Meta').press('Enter');
        const options = page.getByRole('listbox', { name: 'Buscar meta' });
        await expect(options).toHaveText(/Sem meta\s*Ativas\s*Curso\s*Atingidas\s*Viagem/);
        await expect(options.getByRole('option', { name: 'Carro' })).toHaveCount(0);
        await page.keyboard.press('Escape');
        await next.getByRole('button', { name: 'Cancelar' }).dispatchEvent('click');
        await expect(next).toHaveCount(0);

        // A Visão geral resume só as ativas: nem a atingida nem a arquivada.
        await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Visão geral', exact: true }).dispatchEvent('click');
        await expect(page.getByRole('heading', { name: 'Visão geral', level: 1 })).toBeVisible();
        await expect(page.getByRole('list', { name: 'Metas' }).getByRole('link')).toHaveText([/^Curso/]);
    } finally {
        await app.close();
        removeUserData(userData);
    }
});
