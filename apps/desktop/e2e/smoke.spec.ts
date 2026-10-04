import { BetterSqliteDatabase } from '@finance/sqlite-better';
import { expect, test } from '@playwright/test';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { completeFirstUse } from './firstUse.ts';
import { freshUserData, launchApp, removeUserData } from './launchApp.ts';

/*
 * Teste de fumaça do esqueleto (desktop-mvp-plan Fase 3.3): o caminho inteiro — janela,
 * preload, `MessagePort`, `utilityProcess`, `better-sqlite3` no ABI do Electron e o arquivo
 * em disco — funcionando no binário real. O perfil nasce pela tela de primeiro uso (Fase 5);
 * as telas de lançamento e extrato ainda não existem (Fases 7 e 9), e até lá o teste lança
 * pela mesma ponte que elas vão usar.
 */

test('abre, cria perfil, lança uma despesa e vê no extrato; os dados sobrevivem a reabrir o app', async () => {
    const userData = freshUserData();
    try {
        const first = await launchApp(userData);
        await completeFirstUse(first.window, { profileName: 'Pessoal', accountName: 'Nubank', openingBalance: '1.000,00' });

        const statement = await first.window.evaluate(async () => {
            const { core } = window.finance;
            const profiles = await core.call('profiles.list', {});
            const profileId = profiles.ok ? profiles.data[0]?.id : undefined;
            if (profileId === undefined) {
                throw new Error('o primeiro uso não criou o perfil');
            }
            const accounts = await core.call('accounts.list', { profileId, period: '2026-10' });
            const accountId = accounts.ok ? accounts.data.accounts[0]?.id : undefined;
            const tree = await core.call('categories.tree', { profileId });
            const subCategoryId = tree.ok ? tree.data[0]?.subCategories[0]?.id : undefined;
            if (accountId === undefined || subCategoryId === undefined) {
                throw new Error('o primeiro uso não criou a conta e as categorias sugeridas');
            }
            const expense = await core.call('transactions.create', {
                profileId,
                subCategoryId,
                type: 'expense',
                source: { kind: 'account', accountId },
                name: 'Mercado',
                value: 123.45,
                dueDate: '2026-10-05',
                paymentDate: '2026-10-05',
            });
            if (!expense.ok) {
                throw new Error(JSON.stringify(expense.error));
            }
            return core.call('statements.get', { accountId, period: '2026-10' });
        });

        expect(statement.ok).toBe(true);
        if (statement.ok) {
            expect(statement.data.transactions.map((transaction) => transaction.name)).toEqual(['Mercado']);
            expect(statement.data.closing.consolidated.amount).toBeCloseTo(1000 - 123.45);
        }
        await first.window.reload();
        await expect(first.window.getByTestId('profile-switcher')).toContainText('Pessoal · BRL');
        await first.app.close();

        const second = await launchApp(userData);
        await expect(second.window.getByTestId('profile-switcher')).toContainText('Pessoal · BRL');
        await second.app.close();
    } finally {
        removeUserData(userData);
    }
});

test('o renderer não tem Node e enxerga só a ponte, sob CSP restrita (desktop-shell-design §3.6)', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        await expect(page.getByRole('heading', { name: 'Vamos começar' })).toBeVisible();
        const surface = await page.evaluate(() => ({
            require: 'require' in window,
            process: 'process' in globalThis,
            bridge: Object.keys(window.finance).sort(),
            csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '',
            popup: window.open('https://example.com') === null,
        }));
        expect(surface).toMatchObject({ require: false, process: false, bridge: ['core', 'failures', 'preferences', 'report', 'startup'], popup: true });
        expect(surface.csp).toContain("default-src 'self'");
        expect(surface.csp).toContain("script-src 'self';");

        const before = page.url();
        await page.evaluate(() => {
            window.location.href = 'https://example.com';
        });
        await page.waitForTimeout(500);
        expect(page.url()).toBe(before);
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

test('banco de uma versão mais nova do app abre a tela de bloqueio, sem rotas', async () => {
    const userData = freshUserData();
    const database = BetterSqliteDatabase.open(join(userData, 'finance.sqlite'));
    database.exec('PRAGMA user_version = 999');
    database.close();
    const { app, window: page } = await launchApp(userData);
    try {
        await expect(page.getByRole('alert')).toContainText('Este banco é de uma versão mais nova do app');
        const call = await page.evaluate(() => window.finance.core.call('profiles.list', {}));
        expect(call.ok ? null : call.error.code).toBe('SCHEMA_NEWER_THAN_APP');
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

test('restauração interrompida bloqueia sem criar banco vazio, e o bloqueio pode ser relatado', async () => {
    const userData = freshUserData();
    writeFileSync(join(userData, 'restore-pending.json'), JSON.stringify({ failedCopy: join(userData, 'backups', 'falha-1.sqlite') }));
    const { app, window: page } = await launchApp(userData);
    try {
        await expect(page.getByRole('alert')).toContainText('Uma restauração de cópia não terminou');
        expect(existsSync(join(userData, 'finance.sqlite'))).toBe(false);
        // `dispatchEvent`, e não `click`: no container a janela fica fora da tela, o Chromium não
        // desenha quadros, e a espera do Playwright por elemento "estável" nunca termina.
        await page.getByRole('button', { name: 'Reportar problema' }).dispatchEvent('click');
        await expect(page.getByRole('heading', { name: 'Reportar o problema' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Abrir issue no GitHub' })).toBeVisible();
        await expect(page.getByText('database.restore-incomplete')).toBeAttached();
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

test('núcleo que cai com o app aberto troca o app pela tela de erro', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        await expect(page.getByRole('heading', { name: 'Vamos começar' })).toBeVisible();
        const killed = await app.evaluate(({ app: electronApp }) => {
            const core = electronApp.getAppMetrics().find((metric) => metric.type === 'Utility' && metric.name === 'Finanças — núcleo');
            if (core === undefined) {
                return false;
            }
            process.kill(core.pid);
            return true;
        });
        expect(killed).toBe(true);
        await expect(page.getByRole('alert')).toContainText('O núcleo do app parou');
        await expect(page.getByRole('button', { name: 'Reportar problema' })).toBeVisible();
    } finally {
        await app.close();
        removeUserData(userData);
    }
});
