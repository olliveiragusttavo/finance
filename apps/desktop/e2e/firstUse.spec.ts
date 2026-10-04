import { formatMonthLong } from '@finance/client';
import { expect, test } from '@playwright/test';
import { currentPeriod } from '../src/renderer/src/shell/referenceMonth.ts';
import { completeFirstUse } from './firstUse.ts';
import { launchApp, removeUserData } from './launchApp.ts';

/*
 * Primeiro uso (desktop-mvp-plan Fase 5) no app empacotado: o banco sem perfil abre o
 * formulário fora do shell, e concluí-lo cria perfil, conta e categorias e entra na Visão
 * geral do mês atual. Os cliques usam `dispatchEvent` pelo motivo explicado em `firstUse.ts`.
 */

test('banco vazio abre o primeiro uso fora do shell, com "entrar num grupo" desabilitado e explicado', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        await expect(page.getByRole('heading', { name: 'Vamos começar' })).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toHaveCount(0);
        const join = page.getByRole('button', { name: 'Entrar num grupo existente' });
        await expect(join).toBeDisabled();
        await expect(join).toHaveAccessibleDescription(/A sincronização entre aparelhos chega numa próxima versão/);
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

test('nomes em branco apontam os campos, sem chamar o núcleo', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        await page.getByRole('button', { name: 'Criar e começar' }).dispatchEvent('click');
        await expect(page.getByLabel('Nome do perfil')).toHaveAccessibleDescription('Informe o nome do perfil.');
        await expect(page.getByLabel('Nome', { exact: true })).toHaveAccessibleDescription('Informe o nome da conta.');
        await page.getByLabel('Saldo inicial').fill('12.5');
        await expect(page.getByLabel('Saldo inicial')).toHaveAccessibleDescription('Digite um valor como 1.234,56.');
        const profiles = await page.evaluate(() => window.finance.core.call('profiles.list', {}));
        expect(profiles.ok && profiles.data).toEqual([]);
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

test('concluir cria perfil, conta e categorias e entra na Visão geral do mês atual, mesmo com rota e mês antigos no aparelho', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        // Um aparelho que já teve outro banco guarda a última rota e o último mês.
        await page.evaluate(async () => {
            await window.finance.preferences.update({ lastPeriod: '2020-01' });
            window.location.hash = '#/accounts?period=2020-01';
        });

        await completeFirstUse(page, { profileName: 'Estúdio GO', accountName: 'Itaú PJ', openingBalance: '1.500,00', business: true });

        await expect(page.getByRole('heading', { name: 'Visão geral' })).toBeVisible();
        await expect(page.getByTestId('reference-month')).toHaveText(formatMonthLong(currentPeriod(new Date())));
        await expect(page.getByTestId('profile-switcher')).toContainText('Empresarial · BRL');

        const created = await page.evaluate(async (period) => {
            const { core } = window.finance;
            const profiles = await core.call('profiles.list', {});
            const profileId = profiles.ok ? profiles.data[0]?.id : undefined;
            if (profileId === undefined) {
                throw new Error('o primeiro uso não criou o perfil');
            }
            const accounts = await core.call('accounts.list', { profileId, period });
            const tree = await core.call('categories.tree', { profileId });
            const preferences = await window.finance.preferences.get();
            return {
                accounts: accounts.ok ? accounts.data.accounts.map((account) => ({ name: account.name, type: account.type, opening: account.openingBalance.amount })) : null,
                categories: tree.ok ? tree.data.length : 0,
                lastProfileIsCreated: preferences.lastProfileId === profileId,
            };
        }, currentPeriod(new Date()));
        expect(created.accounts).toEqual([{ name: 'Itaú PJ', type: 'checking', opening: 1500 }]);
        expect(created.categories).toBeGreaterThan(0);
        expect(created.lastProfileIsCreated).toBe(true);

        await page.reload();
        await expect(page.getByTestId('profile-switcher')).toContainText('Estúdio GO');
        await expect(page.getByRole('heading', { name: 'Vamos começar' })).toHaveCount(0);
    } finally {
        await app.close();
        removeUserData(userData);
    }
});
