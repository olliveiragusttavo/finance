import { expect, test, type Page } from '@playwright/test';
import { currentPeriod, shiftPeriod } from '../src/renderer/src/shell/referenceMonth.ts';
import { completeFirstUse } from './firstUse.ts';
import { launchApp, removeUserData } from './launchApp.ts';

/*
 * Cadastros (desktop-mvp-plan Fase 6) no app empacotado: contas, cartões, categorias e perfis,
 * com os diálogos, o alerta de exclusão em cadeia e as recusas do núcleo nos campos. Os
 * cliques usam `dispatchEvent` e as listas de escolha do Radix são operadas pelo teclado,
 * pelo motivo explicado em `firstUse.ts`.
 */

/**
 * Abre Cadastros pelo menu e escolhe o tipo na lista lateral.
 *
 * @param page Janela do app, com o shell aberto.
 * @param kind Rótulo do tipo na lista lateral ("Contas").
 */
async function openRegistry(page: Page, kind: string): Promise<void> {
    await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Cadastros', exact: true }).dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'Cadastros', level: 1 })).toBeVisible();
    await page.getByRole('region', { name: 'Tipos de cadastro' }).getByRole('link', { name: new RegExp(`^${kind}`) }).dispatchEvent('click');
    await expect(page.getByRole('heading', { name: kind, level: 2 })).toBeVisible();
}

/**
 * Escolhe uma opção numa lista do Radix pelo teclado: abre com Enter, põe o foco na opção e
 * confirma com Enter. O foco vai direto à opção, e não pela busca por digitação do Radix, que
 * pode parar numa opção de nome parecido.
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
 * @param page Janela do app.
 * @return O id do perfil aberto, para semear dados pela ponte.
 */
async function activeProfileId(page: Page): Promise<string> {
    return page.evaluate(async () => {
        const { lastProfileId } = await window.finance.preferences.get();
        if (lastProfileId === null) {
            throw new Error('nenhum perfil aberto');
        }
        return lastProfileId;
    });
}

test('contas e cartões: criar com erro no campo, desativar e conta desativada fora das pagadoras, aviso do fechamento no dia 31', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        await completeFirstUse(page, { profileName: 'Gustavo', accountName: 'Nubank' });
        await page.getByRole('button', { name: 'Próximo mês' }).dispatchEvent('click');
        const nextMonth = shiftPeriod(currentPeriod(new Date()), 1);
        await expect(page).toHaveURL(new RegExp(`period=${nextMonth}`));
        await openRegistry(page, 'Contas');
        // Regra de interface (mockups, decisão 2): o mês de referência não aparece em configuração.
        await expect(page.getByTestId('reference-month')).toHaveCount(0);
        const kinds = page.getByRole('region', { name: 'Tipos de cadastro' });
        await expect(kinds.getByRole('link', { name: /^Contas/ })).toHaveAttribute('aria-current', 'page');

        await page.getByRole('button', { name: '+ Nova conta' }).dispatchEvent('click');
        await page.getByRole('button', { name: 'Criar conta' }).dispatchEvent('click');
        await expect(page.getByLabel('Nome', { exact: true })).toHaveAccessibleDescription('Informe o nome da conta.');
        await page.getByLabel('Nome', { exact: true }).fill('Tesouro');
        await page.getByLabel('Saldo inicial (BRL)').fill('2.000,00');
        await page.getByRole('button', { name: 'Criar conta' }).dispatchEvent('click');

        const accounts = page.getByRole('list', { name: 'Contas' });
        await expect(accounts.getByRole('listitem').filter({ hasText: 'Tesouro' })).toContainText('Saldo inicial R$ 2.000,00');
        await expect(kinds.getByRole('link', { name: /^Contas/ })).toContainText('2');

        await page.getByRole('button', { name: 'Desativar Tesouro' }).dispatchEvent('click');
        await expect(accounts.getByRole('listitem').filter({ hasText: 'Tesouro' })).toContainText('Desativada');

        await kinds.getByRole('link', { name: /^Cartões/ }).dispatchEvent('click');
        // O mês escondido nesta tela continua na URL, para as outras telas o reencontrarem.
        await expect(page).toHaveURL(new RegExp(`kind=cards.*period=${nextMonth}|period=${nextMonth}.*kind=cards`));
        await page.getByRole('button', { name: '+ Novo cartão' }).dispatchEvent('click');
        await page.getByLabel('Conta pagadora').press('Enter');
        await expect(page.getByRole('option', { name: 'Nubank' })).toBeVisible();
        await expect(page.getByRole('option', { name: /Tesouro/ })).toHaveCount(0);
        await page.keyboard.press('Escape');

        await page.getByLabel('Nome', { exact: true }).fill('Roxinho');
        await page.getByLabel('Limite (BRL)').fill('5.000,00');
        await page.getByLabel('Dia do fechamento').fill('31');
        await expect(page.getByLabel('Dia do fechamento')).toHaveAccessibleDescription('Nos meses sem o dia 31, a fatura fecha no último dia do mês.');
        await page.getByLabel('Dia do vencimento').fill('8');
        await page.getByRole('button', { name: 'Criar cartão' }).dispatchEvent('click');
        await expect(page.getByRole('list', { name: 'Cartões' })).toContainText('Paga por Nubank · Limite R$ 5.000,00 · Fecha dia 31 · Vence dia 8');
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

test('excluir conta: o alerta conta a cadeia e nomeia a outra conta, e só exclui com o nome digitado', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        await completeFirstUse(page, { profileName: 'Gustavo', accountName: 'Nubank' });
        const profileId = await activeProfileId(page);
        await page.evaluate(async ({ profileId, period }) => {
            const { core } = window.finance;
            const accounts = await core.call('accounts.list', { profileId, period });
            const tree = await core.call('categories.tree', { profileId });
            const nubank = accounts.ok ? accounts.data.accounts[0] : undefined;
            const subCategory = tree.ok ? tree.data[0]?.subCategories[0] : undefined;
            const savings = await core.call('accounts.create', { profileId, name: 'Tesouro', type: 'investment' });
            if (nubank === undefined || subCategory === undefined || !savings.ok) {
                throw new Error('cenário incompleto');
            }
            const card = await core.call('creditCards.create', { profileId, accountId: nubank.id, name: 'Roxinho', limit: 5000, closingDay: 3, dueDay: 10 });
            if (!card.ok) {
                throw new Error('cartão não criado');
            }
            const base = { profileId, subCategoryId: subCategory.id, dueDate: `${period}-05` };
            await core.call('transactions.create', { ...base, type: 'transference', source: { kind: 'account', accountId: nubank.id }, destinationAccountId: savings.data.id, name: 'Aporte', value: 300 });
            await core.call('transactions.create', { ...base, type: 'expense', source: { kind: 'creditCard', creditCardId: card.data.id }, name: 'Mercado', value: 120 });
        }, { profileId, period: currentPeriod(new Date()) });

        await openRegistry(page, 'Contas');
        await page.getByRole('button', { name: 'Excluir Nubank' }).dispatchEvent('click');
        const alert = page.getByRole('alertdialog', { name: 'Excluir a conta Nubank?' });
        await expect(alert.getByRole('list', { name: 'Também serão apagados' })).toContainText('1 cartão pago por ela');
        await expect(alert.getByRole('list', { name: 'Também serão apagados' })).toContainText('1 lançamento nas faturas');
        await expect(alert).toContainText('O saldo desta outra conta vai mudar: Tesouro.');

        const confirm = alert.getByRole('button', { name: 'Excluir conta' });
        await expect(confirm).toBeDisabled();
        await alert.getByLabel('Digite Nubank para confirmar').fill('nubank');
        await expect(confirm).toBeDisabled();
        await alert.getByLabel('Digite Nubank para confirmar').fill('Nubank');
        await confirm.dispatchEvent('click');

        await expect(alert).toHaveCount(0);
        await expect(page.getByRole('list', { name: 'Contas' }).getByRole('listitem')).toHaveCount(1);
        await expect(page.getByRole('list', { name: 'Contas' })).toContainText('Tesouro');
        const cards = await page.evaluate(
            async ({ profileId, period }) => {
                const result = await window.finance.core.call('creditCards.list', { profileId, period });
                return result.ok ? result.data.creditCards.length : -1;
            },
            { profileId, period: currentPeriod(new Date()) },
        );
        expect(cards).toBe(0);
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

test('categorias: nome repetido apontado no campo, nova subcategoria e excluir subcategoria em uso movendo os lançamentos', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        await completeFirstUse(page, { profileName: 'Gustavo', accountName: 'Nubank' });
        const profileId = await activeProfileId(page);
        const transactionId = await page.evaluate(
            async ({ profileId, period }) => {
                const { core } = window.finance;
                const accounts = await core.call('accounts.list', { profileId, period });
                const tree = await core.call('categories.tree', { profileId });
                const account = accounts.ok ? accounts.data.accounts[0] : undefined;
                const rent = tree.ok ? tree.data.flatMap((branch) => branch.subCategories).find((sub) => sub.name === 'Aluguel') : undefined;
                if (account === undefined || rent === undefined) {
                    throw new Error('cenário incompleto');
                }
                const created = await core.call('transactions.create', {
                    profileId,
                    subCategoryId: rent.id,
                    type: 'expense',
                    source: { kind: 'account', accountId: account.id },
                    name: 'Aluguel',
                    value: 2300,
                    dueDate: `${period}-05`,
                });
                if (!created.ok) {
                    throw new Error('lançamento não criado');
                }
                return created.data.id;
            },
            { profileId, period: currentPeriod(new Date()) },
        );

        await openRegistry(page, 'Categorias');
        await expect(page.getByRole('region', { name: 'Tipos de cadastro' }).getByRole('link', { name: /^Categorias/ })).toContainText(/\d+ · \d+ sub/);

        await page.getByRole('button', { name: '+ Nova categoria' }).dispatchEvent('click');
        await page.getByLabel('Nome da categoria').fill('moradia');
        await page.getByRole('button', { name: 'Criar categoria' }).dispatchEvent('click');
        await expect(page.getByLabel('Nome da categoria')).toHaveAccessibleDescription('Já existe uma categoria com o nome "moradia". Escolha outro nome.');
        await page.getByRole('button', { name: 'Cancelar' }).dispatchEvent('click');

        await page.getByRole('button', { name: 'Nova subcategoria em Moradia' }).dispatchEvent('click');
        await page.getByLabel('Nome da subcategoria').fill('Internet');
        await page.getByRole('button', { name: 'Criar subcategoria' }).dispatchEvent('click');
        const housing = page.getByRole('list', { name: 'Subcategorias de Moradia' });
        await expect(housing).toContainText('Internet');
        await expect(housing.getByRole('listitem').filter({ hasText: 'Aluguel' })).toContainText('1 lanç.');

        await page.getByRole('button', { name: 'Excluir Aluguel' }).dispatchEvent('click');
        await page.getByRole('button', { name: 'Mover e excluir' }).dispatchEvent('click');
        await expect(page.getByLabel('Mover 1 lançamento para')).toHaveAccessibleDescription('Escolha para onde mover os lançamentos.');
        await chooseOption(page, 'Mover 1 lançamento para', 'Internet');
        await page.getByRole('button', { name: 'Mover e excluir' }).dispatchEvent('click');

        await expect(housing).not.toContainText('Aluguel');
        await expect(housing.getByRole('listitem').filter({ hasText: 'Internet' })).toContainText('1 lanç.');
        const moved = await page.evaluate(
            async ({ id, profileId }) => {
                const { core } = window.finance;
                const transaction = await core.call('transactions.get', { id });
                const tree = await core.call('categories.tree', { profileId });
                const subCategoryId = transaction.ok ? transaction.data.subCategoryId : null;
                return tree.ok ? tree.data.flatMap((branch) => branch.subCategories).find((sub) => sub.id === subCategoryId)?.name : null;
            },
            { id: transactionId, profileId },
        );
        expect(moved).toBe('Internet');
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

test('perfis: "Gerenciar perfis" abre o cadastro de perfis, criar empresarial com o aviso de sócios, e renomear o perfil aberto atualiza o seletor', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        await completeFirstUse(page, { profileName: 'Gustavo', accountName: 'Nubank' });
        // "Gerenciar perfis" no seletor abre Cadastros já em Perfis, e não no tipo padrão.
        await page.getByTestId('profile-switcher').press('Enter');
        await page.getByRole('menuitem', { name: 'Gerenciar perfis' }).dispatchEvent('click');
        await expect(page.getByRole('heading', { name: 'Perfis', level: 2 })).toBeVisible();

        await page.getByRole('button', { name: '+ Novo perfil' }).dispatchEvent('click');
        await page.getByLabel('Nome do perfil').fill('Estúdio GO');
        await page.getByRole('radio', { name: 'Empresarial' }).dispatchEvent('click');
        await expect(page.getByRole('dialog')).toContainText('o cadastro de sócios e o relatório por sócio chegam numa próxima versão');
        await page.getByRole('button', { name: 'Criar perfil' }).dispatchEvent('click');
        await expect(page.getByRole('list', { name: 'Perfis' })).toContainText('Estúdio GO');
        await expect(page.getByRole('list', { name: 'Perfis' })).toContainText('Empresarial · BRL');

        await page.getByRole('button', { name: 'Editar Gustavo' }).dispatchEvent('click');
        await page.getByLabel('Nome do perfil').fill('Gustavo P');
        await page.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');
        await expect(page.getByTestId('profile-switcher')).toContainText('Gustavo P');
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

test('tags: criar com nome repetido apontado no campo, uso do lançamento na lista, renomear e excluir tirando a tag do lançamento', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        await completeFirstUse(page, { profileName: 'Gustavo', accountName: 'Nubank' });
        const profileId = await activeProfileId(page);
        await openRegistry(page, 'Tags');

        await page.getByLabel('Nova tag').fill('viagem');
        await page.getByRole('button', { name: 'Adicionar' }).dispatchEvent('click');
        const list = page.getByRole('region', { name: 'Lista de tags' });
        await expect(list).toContainText('viagem');
        await expect(page.getByLabel('Nova tag')).toHaveValue('');
        await page.getByLabel('Nova tag').fill('VIAGEM');
        await page.getByRole('button', { name: 'Adicionar' }).dispatchEvent('click');
        await expect(page.getByLabel('Nova tag')).toHaveAccessibleDescription('Já existe uma tag com o nome "VIAGEM". Escolha outro nome.');

        // A tag entra no lançamento pela ponte: o teste é do cadastro de tags, e marcar pela
        // tela é coberto em `transactions.spec.ts`.
        const transactionId = await page.evaluate(
            async ({ profileId, period }) => {
                const { core } = window.finance;
                const [accounts, tree, tags] = await Promise.all([
                    core.call('accounts.list', { profileId, period }),
                    core.call('categories.tree', { profileId }),
                    core.call('tags.list', { profileId }),
                ]);
                const account = accounts.ok ? accounts.data.accounts[0] : undefined;
                const subCategory = tree.ok ? tree.data[0]?.subCategories[0] : undefined;
                const tag = tags.ok ? tags.data[0] : undefined;
                if (account === undefined || subCategory === undefined || tag === undefined) {
                    throw new Error('cenário incompleto');
                }
                const created = await core.call('transactions.create', {
                    profileId,
                    subCategoryId: subCategory.id,
                    type: 'expense',
                    source: { kind: 'account', accountId: account.id },
                    name: 'Hotel',
                    value: 1400,
                    dueDate: `${period}-05`,
                    tagIds: [tag.id],
                });
                if (!created.ok) {
                    throw new Error('lançamento não criado');
                }
                return created.data.id;
            },
            { profileId, period: currentPeriod(new Date()) },
        );
        // A escrita pela ponte não passa pelo mapa de invalidação das telas; recarregar relê.
        await page.reload();
        await expect(page.getByRole('heading', { name: 'Tags', level: 2 })).toBeVisible();
        const row = list.getByRole('row').filter({ hasText: 'viagem' });
        await expect(row).toContainText('1');
        await expect(row).toContainText('R$ 1.400,00');

        await page.getByRole('button', { name: 'Editar a tag viagem' }).dispatchEvent('click');
        const panel = page.getByRole('complementary', { name: 'Editar tag' });
        await expect(panel).toContainText('Excluir remove a tag do lançamento. Os lançamentos continuam existindo.');
        await expect(panel.getByRole('link', { name: 'Abrir relatório por tag →' })).toBeVisible();
        await panel.getByLabel('Nome').fill('viagem-floripa');
        await panel.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');
        await expect(list).toContainText('viagem-floripa');

        await panel.getByRole('button', { name: 'Excluir tag' }).dispatchEvent('click');
        await expect(page.getByText('Nenhuma tag', { exact: true })).toBeVisible();
        const tagIds = await page.evaluate(async (id) => {
            const result = await window.finance.core.call('transactions.get', { id });
            return result.ok ? result.data.tagIds : null;
        }, transactionId);
        expect(tagIds).toEqual([]);
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

test('anotações: criar, buscar, salvar sincroniza o editor, sair com alteração não salva pede salvar ou descartar, excluir com confirmação e recusa', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        await completeFirstUse(page, { profileName: 'Gustavo', accountName: 'Nubank' });
        await openRegistry(page, 'Anotações');
        const list = page.getByRole('region', { name: 'Lista de anotações' });

        await page.getByRole('button', { name: '+ Nova anotação' }).dispatchEvent('click');
        const editor = page.getByLabel('Anotação', { exact: true });
        await page.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');
        await expect(editor).toHaveAccessibleDescription('Escreva a anotação antes de salvar.');
        await editor.fill('IPTU 2027\nCota única com desconto vence em fevereiro.');
        await page.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');
        await expect(list.getByRole('button', { name: /^IPTU 2027/ })).toHaveAttribute('aria-current', 'true');
        await expect(list).toContainText('Cota única com desconto vence em fevereiro.');

        await page.getByRole('button', { name: '+ Nova anotação' }).dispatchEvent('click');
        await editor.fill('Reembolsos pendentes\nConferir a tag reembolsável.');
        await page.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');
        await expect(list.getByRole('button', { name: /^Reembolsos pendentes/ })).toHaveAttribute('aria-current', 'true');
        await expect(page.getByRole('region', { name: 'Tipos de cadastro' }).getByRole('link', { name: /^Anotações/ })).toContainText('2');

        await list.getByLabel('Buscar').fill('FEVEREIRO');
        await expect(list.getByRole('listitem')).toHaveCount(1);
        await list.getByLabel('Buscar').fill('');

        // O núcleo grava o texto aparado; o editor passa a mostrar o gravado e deixa de parecer alterado.
        await editor.fill('Reembolsos pendentes\nConferir a tag reembolsável.\n');
        await page.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');
        await expect(editor).toHaveValue('Reembolsos pendentes\nConferir a tag reembolsável.');
        await expect(page.getByRole('button', { name: 'Salvar' })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'Descartar alterações' })).toBeDisabled();

        // Sair com alteração não salva pergunta antes: continuar editando mantém o texto.
        const unsaved = page.getByRole('alertdialog', { name: 'Salvar as alterações da anotação?' });
        await editor.fill('Reembolsos pendentes\nCobrar a empresa.');
        await list.getByRole('button', { name: /^IPTU 2027/ }).dispatchEvent('click');
        await unsaved.getByRole('button', { name: 'Continuar editando' }).dispatchEvent('click');
        await expect(unsaved).toHaveCount(0);
        await expect(editor).toHaveValue('Reembolsos pendentes\nCobrar a empresa.');

        // Trocar de cadastro também pergunta; descartar deixa sair e volta ao texto gravado.
        await page.getByRole('region', { name: 'Tipos de cadastro' }).getByRole('link', { name: /^Tags/ }).dispatchEvent('click');
        await expect(unsaved).toBeVisible();
        await expect(page).toHaveURL(/kind=notes/);
        await unsaved.getByRole('button', { name: 'Descartar' }).dispatchEvent('click');
        await expect(page.getByRole('heading', { name: 'Tags', level: 2 })).toBeVisible();
        await openRegistry(page, 'Anotações');
        await list.getByRole('button', { name: /^Reembolsos pendentes/ }).dispatchEvent('click');
        await expect(editor).toHaveValue('Reembolsos pendentes\nConferir a tag reembolsável.');

        // Salvar pelo diálogo grava e abre a anotação escolhida.
        await editor.fill('Reembolsos pendentes\nCobrar a empresa.');
        await list.getByRole('button', { name: /^IPTU 2027/ }).dispatchEvent('click');
        await unsaved.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');
        await expect(unsaved).toHaveCount(0);
        await expect(editor).toHaveValue(/^IPTU 2027/);
        await expect(list).toContainText('Cobrar a empresa.');

        await page.getByRole('region', { name: 'Editar anotação' }).getByRole('button', { name: 'Excluir anotação' }).dispatchEvent('click');
        const confirm = page.getByRole('alertdialog', { name: 'Excluir a anotação IPTU 2027?' });
        await confirm.getByRole('button', { name: 'Excluir anotação' }).dispatchEvent('click');
        await expect(confirm).toHaveCount(0);
        await expect(list.getByRole('listitem')).toHaveCount(1);
        await expect(list).not.toContainText('IPTU 2027');

        // Anotação excluída em outro aparelho: a recusa do núcleo aparece no diálogo de exclusão.
        await list.getByRole('button', { name: /^Reembolsos pendentes/ }).dispatchEvent('click');
        await page.getByRole('region', { name: 'Editar anotação' }).getByRole('button', { name: 'Excluir anotação' }).dispatchEvent('click');
        const profileId = await activeProfileId(page);
        await page.evaluate(async (id) => {
            const listed = await window.finance.core.call('notes.list', { profileId: id });
            if (!listed.ok) {
                throw new Error('notes.list recusado');
            }
            for (const note of listed.data) {
                await window.finance.core.call('notes.delete', { id: note.id });
            }
        }, profileId);
        const refused = page.getByRole('alertdialog', { name: 'Excluir a anotação Reembolsos pendentes?' });
        await refused.getByRole('button', { name: 'Excluir anotação' }).dispatchEvent('click');
        await expect(refused.getByRole('alert')).toBeVisible();
    } finally {
        await app.close();
        removeUserData(userData);
    }
});
