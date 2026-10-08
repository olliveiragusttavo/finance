import { expect, test, type Locator, type Page } from '@playwright/test';
import { formatMonthAbbreviation, formatMonthShort } from '@finance/client';
import { currentPeriod, shiftPeriod } from '../src/renderer/src/shell/referenceMonth.ts';
import { completeFirstUse } from './firstUse.ts';
import { launchApp, removeUserData } from './launchApp.ts';

/*
 * Recorrências (desktop-mvp-plan Fases 9.1 e 9.2) no app empacotado:
 * parcelar no cartão com a prévia e o diálogo de revisão, a coluna "Rec." e as parcelas nos meses
 * seguintes; série fixa editada em "esta e as futuras"; mudar a periodicidade, que vai direto
 * para a revisão de uma série nova; e excluir "todas" com o aviso das pagas na revisão. Os cliques
 * usam `dispatchEvent` e as listas do Radix são operadas pelo teclado, pelo motivo explicado em
 * `firstUse.ts`.
 */

/**
 * Cria o cartão Roxinho (fecha 3, vence 10) pela ponte; o cadastro de cartões tem o próprio teste.
 *
 * @param page Janela do app, com o shell aberto.
 */
async function seedCard(page: Page): Promise<void> {
    await page.evaluate(async (period) => {
        const { core } = window.finance;
        const { lastProfileId: profileId } = await window.finance.preferences.get();
        const accounts = await core.call('accounts.list', { profileId: profileId ?? '', period });
        const nubank = accounts.ok ? accounts.data.accounts[0] : undefined;
        if (profileId === null || nubank === undefined) {
            throw new Error('cenário incompleto');
        }
        await core.call('creditCards.create', { profileId, accountId: nubank.id, name: 'Roxinho', limit: 5000, closingDay: 3, dueDay: 10 });
    }, currentPeriod(new Date()));
}

/**
 * Abre Transações pelo menu e o diálogo de lançamento novo pelo `N`.
 *
 * @param page Janela do app.
 * @return O diálogo do formulário.
 */
async function openNew(page: Page): Promise<Locator> {
    await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Transações', exact: true }).dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'Transações', level: 1 })).toBeVisible();
    await page.keyboard.press('n');
    const column = page.getByRole('dialog', { name: 'Novo lançamento' });
    await expect(column).toBeVisible();
    return column;
}

/**
 * Preenche o básico de um lançamento: valor, nome, categoria pela busca, origem e data.
 *
 * @param page Janela do app.
 * @param column Diálogo do formulário.
 * @param fields O que digitar.
 */
async function fillBasics(page: Page, column: Locator, fields: { readonly amount: string; readonly name: string; readonly source: string; readonly date: string; readonly dateLabel: string }): Promise<void> {
    await column.getByLabel('Valor (BRL)').fill(fields.amount);
    await column.getByLabel('Nome').fill(fields.name);
    await column.getByLabel('Categoria', { exact: true }).dispatchEvent('click');
    await page.getByRole('combobox', { name: 'Buscar categoria' }).fill('mercado');
    await page.getByRole('combobox', { name: 'Buscar categoria' }).press('Enter');
    await column.getByLabel('Conta ou cartão').press('Enter');
    await page.getByRole('option', { name: fields.source, exact: true }).press('Enter');
    await column.getByLabel(fields.dateLabel, { exact: true }).fill(fields.date);
}

/**
 * Confirma o diálogo de revisão. O botão só habilita quando o plano chega do núcleo, e um clique
 * antes disso não faria nada — o teste seguiria esperando um lançamento que não foi gravado.
 *
 * @param review Diálogo de revisão.
 * @param label Rótulo do botão de confirmar ("Lançar", "Salvar", "Excluir").
 */
async function confirmReview(review: Locator, label: string): Promise<void> {
    const button = review.getByRole('button', { name: label, exact: true });
    await expect(button).toBeEnabled();
    await button.dispatchEvent('click');
}

/**
 * @param page Janela do app.
 * @param name Nome do lançamento.
 * @return A linha do lançamento na tabela.
 */
function rowOf(page: Page, name: string): Locator {
    return page.getByRole('region', { name: 'Lançamentos do mês' }).getByRole('row').filter({ hasText: name });
}

test('parcelar no cartão: prévia com as faturas, "Rec." 1/3 e as parcelas nos meses seguintes', async () => {
    const { app, window: page, userData } = await launchApp();
    const period = currentPeriod(new Date());
    const next = shiftPeriod(period, 1);
    try {
        await completeFirstUse(page, { profileName: 'Pessoal', accountName: 'Nubank' });
        await seedCard(page);
        const column = await openNew(page);
        await fillBasics(page, column, { amount: '1.000,00', name: 'Geladeira', source: 'Roxinho', date: `${period}-06`, dateLabel: 'Data da compra' });

        await column.getByRole('radio', { name: 'Parcelado' }).dispatchEvent('click');
        await column.getByLabel('Parcelas').fill('3');
        const preview = column.getByRole('region', { name: 'Prévia' });
        await expect(preview).toContainText('R$ 1.000,00 em 3x de R$ 333,33');
        await expect(preview).toContainText(`1/3fatura ${formatMonthShort(next)}R$ 333,34`);
        await expect(preview).toContainText('A divisão não fecha: a diferença do arredondamento vai para a 1ª parcela.');
        await column.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');
        const review = page.getByRole('dialog', { name: 'Revisar o lançamento de “Geladeira”' });
        await expect(review.getByRole('list', { name: 'Resumo' })).toContainText('Será criada uma série parcelada mensal em 3x.');
        await expect(review.getByRole('region', { name: '3 transações serão criadas' })).toBeVisible();
        await confirmReview(review, 'Lançar');

        await expect(rowOf(page, 'Geladeira')).toContainText(`Roxinho · fat. ${formatMonthAbbreviation(next)}`);
        await expect(rowOf(page, 'Geladeira')).toContainText('−R$ 333,34');
        await expect(rowOf(page, 'Geladeira')).toContainText('1/3');
        await page.keyboard.press(']');
        await expect(rowOf(page, 'Geladeira')).toContainText('2/3');
        await expect(rowOf(page, 'Geladeira')).toContainText('−R$ 333,33');

        await rowOf(page, 'Geladeira').dispatchEvent('click');
        const editor = page.getByRole('dialog', { name: 'Editar Geladeira' });
        await expect(editor).toContainText('Despesa · parcela 2 de 3 (valor total R$ 1.000,00)');
        await expect(editor.getByRole('note').filter({ hasText: 'Ao salvar, perguntaremos' })).toBeVisible();
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

test('série fixa: "esta e as futuras" não mexe no passado; mudar a periodicidade revisa uma série nova; excluir todas avisa das pagas', async () => {
    const { app, window: page, userData } = await launchApp();
    const period = currentPeriod(new Date());
    const previous = shiftPeriod(period, -1);
    try {
        await completeFirstUse(page, { profileName: 'Pessoal', accountName: 'Nubank', openingBalance: '5.000,00' });
        const column = await openNew(page);
        await fillBasics(page, column, { amount: '2.300,00', name: 'Aluguel', source: 'Nubank', date: `${previous}-05`, dateLabel: 'Data' });
        await column.getByLabel('Pago').dispatchEvent('click');
        await column.getByLabel('Data do pagamento').fill(`${previous}-05`);
        await column.getByRole('radio', { name: 'Fixo' }).dispatchEvent('click');
        await expect(column.getByRole('region', { name: 'Prévia' })).toContainText('R$ 2.300,00 todo mês, sem fim');
        await column.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');
        await confirmReview(page.getByRole('dialog', { name: 'Revisar o lançamento de “Aluguel”' }), 'Lançar');
        await expect(rowOf(page, 'Aluguel')).toContainText('Fixa');

        // No mês atual: reajuste em "esta e as futuras".
        await rowOf(page, 'Aluguel').dispatchEvent('click');
        const editor = page.getByRole('dialog', { name: 'Editar Aluguel' });
        await expect(editor).toContainText('Despesa · fixa mensal');
        await editor.getByLabel('Valor (BRL)').fill('2.500,00');
        await editor.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');
        const scope = page.getByRole('dialog', { name: 'Salvar “Aluguel”' });
        await scope.getByRole('radio', { name: 'Esta e as futuras' }).dispatchEvent('click');
        await scope.getByRole('button', { name: 'Continuar' }).dispatchEvent('click');
        const review = page.getByRole('dialog', { name: 'Revisar as alterações em “Aluguel”' });
        await expect(review).toContainText('serão alteradas');
        await confirmReview(review, 'Salvar');
        await expect(review).toHaveCount(0);
        await expect(rowOf(page, 'Aluguel')).toContainText('−R$ 2.500,00');
        await page.keyboard.press('[');
        await expect(rowOf(page, 'Aluguel')).toContainText('−R$ 2.300,00');

        // Mudar a periodicidade não pergunta o escopo: vai direto para a revisão de uma série nova.
        await rowOf(page, 'Aluguel').dispatchEvent('click');
        await editor.getByLabel('Frequência').press('Enter');
        await page.getByRole('option', { name: 'Anual', exact: true }).press('Enter');
        await expect(editor.getByRole('note').filter({ hasText: 'Mudar a repetição vale para este lançamento e os seguintes' })).toBeVisible();
        await editor.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');
        await expect(scope).toHaveCount(0);
        const summary = review.getByRole('list', { name: 'Resumo' });
        await expect(summary).toContainText('Será criada uma nova série fixa anual, sem término, começando nesta transação.');
        await expect(summary).toContainText('A nova série não terá vínculo com as transações anteriores');
        await review.getByRole('button', { name: 'Voltar' }).dispatchEvent('click');
        await expect(review).toHaveCount(0);
        await editor.getByRole('button', { name: 'Cancelar' }).dispatchEvent('click');
        await expect(editor).toHaveCount(0);

        // Excluir todas: a revisão diz quantas pagas e de que mês e conta.
        await rowOf(page, 'Aluguel').focus();
        await page.keyboard.press('Delete');
        const confirm = page.getByRole('alertdialog', { name: 'Excluir “Aluguel”?' });
        await confirm.getByRole('radio', { name: 'Todas' }).dispatchEvent('click');
        await confirm.getByRole('button', { name: 'Continuar' }).dispatchEvent('click');
        const removal = page.getByRole('alertdialog', { name: 'Revisar a exclusão de “Aluguel”' });
        await expect(removal.getByRole('list', { name: 'Resumo' })).toContainText('A série será excluída, inclusive as transações passadas.');
        await expect(removal.getByRole('note')).toContainText(`1 ocorrência já paga será excluída. O saldo de ${formatMonthShort(previous)} da conta Nubank vai mudar.`);
        await confirmReview(removal, 'Excluir');
        await expect(page.getByRole('region', { name: 'Lançamentos do mês' })).toContainText('Nenhum lançamento');
        await page.keyboard.press(']');
        await expect(page.getByRole('region', { name: 'Lançamentos do mês' })).toContainText('Nenhum lançamento');
    } finally {
        await app.close();
        removeUserData(userData);
    }
});
