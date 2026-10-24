import { expect, test, type Page } from '@playwright/test';
import { currentPeriod, shiftPeriod } from '../src/renderer/src/shell/referenceMonth.ts';
import { completeFirstUse } from './firstUse.ts';
import { launchApp, removeUserData } from './launchApp.ts';

/*
 * Relatório por tag (desktop-mvp-plan Fase 12.2) no app empacotado: o estado sem tag, a lista
 * pelo total líquido, o reembolso abatendo o gasto, as parcelas futuras só em "Todo o período",
 * a divisão por categoria em tabela e gráfico e o "Abrir em Transações". Os cliques usam
 * `dispatchEvent`, pelo motivo explicado em `firstUse.ts`.
 */

/**
 * Semeia pela ponte, na Nubank: com a tag "viagem", a despesa de R$ 620,00 paga neste mês numa
 * categoria e a de R$ 400,00 em aberto no mês seguinte noutra; com "reembolsável", a despesa de
 * R$ 500,00 e a receita de R$ 200,00 que a reembolsa, as duas pagas neste mês. Depois recarrega,
 * porque a escrita pela ponte não passa pelo mapa de invalidação da tela.
 *
 * @param page Janela do app, com o shell aberto no perfil do primeiro uso.
 */
async function seedTags(page: Page): Promise<void> {
    const period = currentPeriod(new Date());
    await page.evaluate(
        async ({ period, next }) => {
            const { core } = window.finance;
            const { lastProfileId: profileId } = await window.finance.preferences.get();
            if (profileId === null) {
                throw new Error('nenhum perfil aberto');
            }
            const accounts = await core.call('accounts.list', { profileId, period });
            const tree = await core.call('categories.tree', { profileId });
            const nubank = accounts.ok ? accounts.data.accounts[0] : undefined;
            const first = tree.ok ? tree.data[0]?.subCategories[0]?.id : undefined;
            const second = tree.ok ? tree.data[1]?.subCategories[0]?.id : undefined;
            const trip = await core.call('tags.create', { profileId, name: 'viagem' });
            const refundable = await core.call('tags.create', { profileId, name: 'reembolsável' });
            if (nubank === undefined || first === undefined || second === undefined || !trip.ok || !refundable.ok) {
                throw new Error('cenário incompleto');
            }
            const base = { profileId, source: { kind: 'account', accountId: nubank.id } } as const;
            await core.call('transactions.create', { ...base, subCategoryId: first, type: 'expense', name: 'Uber', value: 620, dueDate: `${period}-02`, paymentDate: `${period}-02`, tagIds: [trip.data.id] });
            await core.call('transactions.create', { ...base, subCategoryId: second, type: 'expense', name: 'Pousada', value: 400, dueDate: `${next}-05`, tagIds: [trip.data.id] });
            await core.call('transactions.create', { ...base, subCategoryId: first, type: 'expense', name: 'Táxi do cliente', value: 500, dueDate: `${period}-03`, paymentDate: `${period}-03`, tagIds: [refundable.data.id] });
            await core.call('transactions.create', { ...base, subCategoryId: second, type: 'income', name: 'Reembolso', value: 200, dueDate: `${period}-04`, paymentDate: `${period}-04`, tagIds: [refundable.data.id] });
        },
        { period, next: shiftPeriod(period, 1) },
    );
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Por tag', level: 1 })).toBeVisible();
}

test('por tag: sem tag, total líquido, período, categorias e link para Transações', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        await completeFirstUse(page, { profileName: 'Pessoal', accountName: 'Nubank', openingBalance: '1.000,00' });
        // Os relatórios ficam na lista da página de Relatórios.
        await page.getByRole('link', { name: 'Relatórios', exact: true }).dispatchEvent('click');
        await page.getByRole('link', { name: 'Por tag', exact: true }).dispatchEvent('click');
        await expect(page.getByRole('heading', { name: 'Por tag', level: 1 })).toBeVisible();
        await expect(page.getByText('Nenhuma tag', { exact: true })).toBeVisible();

        await seedTags(page);
        const tags = page.getByRole('list', { name: 'Tags' });
        // Regra de negócio (Relatórios, T1 e T3): em todo o período a viagem soma a parcela futura e vem primeiro.
        await expect(tags.getByRole('link')).toHaveCount(2);
        await expect(tags.getByRole('link').first()).toContainText('viagem');
        await expect(tags.getByRole('link').first()).toContainText('R$ 1.020,00');
        await expect(tags.getByRole('link').first()).toHaveAttribute('aria-current', 'page');
        await expect(page.getByRole('group', { name: 'Total gasto' })).toContainText('R$ 1.020,00');
        await expect(page.getByRole('group', { name: 'Lançamentos' })).toContainText('em 1 conta');
        await expect(page.getByRole('table', { name: 'Lançamentos com esta tag' }).getByRole('row')).toHaveCount(4);

        // Regra de negócio (Relatórios, T2): o reembolso abate o gasto.
        await tags.getByRole('link', { name: /reembolsável/ }).dispatchEvent('click');
        await expect(page).toHaveURL(/tag=/);
        await expect(page.getByRole('group', { name: 'Total líquido' })).toContainText('R$ 300,00');
        await expect(page.getByRole('group', { name: 'Total líquido' })).toContainText('R$ 500,00 em despesas − R$ 200,00 em receitas');
        await expect(page.getByRole('table', { name: 'Categorias de reembolsável' })).toContainText('+R$ 200,00');

        await page.getByRole('button', { name: 'Gráfico' }).dispatchEvent('click');
        await expect(page.getByRole('img', { name: /Gráfico das categorias de reembolsável/ })).toBeVisible();

        // Só o mês de referência: a parcela da viagem no mês seguinte sai.
        await page.getByRole('combobox', { name: 'Período' }).press('Enter');
        const option = page.getByRole('option', { name: 'Só o mês de referência', exact: true });
        await option.focus();
        await option.press('Enter');
        await expect(page).toHaveURL(/range=month/);
        await expect(tags.getByRole('link', { name: /viagem/ })).toContainText('R$ 620,00');

        await page.getByRole('link', { name: 'Abrir em Transações →' }).dispatchEvent('click');
        await expect(page.getByRole('heading', { name: 'Transações', level: 1 })).toBeVisible();
        await expect(page).toHaveURL(/#\/transactions\?.*tag=/);
    } finally {
        await app.close();
        removeUserData(userData);
    }
});
