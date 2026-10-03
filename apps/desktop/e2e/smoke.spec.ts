import { BetterSqliteDatabase } from '@finance/sqlite-better';
import { expect, test } from '@playwright/test';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshUserData, launchApp, removeUserData } from './launchApp.ts';

/*
 * Teste de fumaça do esqueleto (desktop-mvp-plan Fase 3.3): o caminho inteiro — janela,
 * preload, `MessagePort`, `utilityProcess`, `better-sqlite3` no ABI do Electron e o arquivo
 * em disco — funcionando no binário real. As telas de perfil, lançamento e extrato ainda não
 * existem (Fases 5, 7 e 9); até lá, o teste lança pela mesma ponte que elas vão usar, e a
 * tela inicial provisória mostra o resultado.
 */

test('abre, cria perfil, lança uma despesa e vê no extrato; os dados sobrevivem a reabrir o app', async () => {
    const userData = freshUserData();
    try {
        const first = await launchApp(userData);
        await expect(first.window.getByTestId('profiles')).toHaveText('Nenhum perfil cadastrado.');

        const statement = await first.window.evaluate(async () => {
            const { core } = window.finance;
            const started = await core.call('onboarding.start', {
                profile: { name: 'Pessoal', type: 'personal', currency: 'BRL' },
                account: { name: 'Nubank', type: 'checking', openingBalance: 1000 },
            });
            if (!started.ok) {
                throw new Error(JSON.stringify(started.error));
            }
            const tree = await core.call('categories.tree', { profileId: started.data.profile.id });
            const subCategoryId = tree.ok ? tree.data[0]?.subCategories[0]?.id : undefined;
            if (subCategoryId === undefined) {
                throw new Error('o primeiro uso não criou as categorias sugeridas');
            }
            const expense = await core.call('transactions.create', {
                profileId: started.data.profile.id,
                subCategoryId,
                type: 'expense',
                source: { kind: 'account', accountId: started.data.account.id },
                name: 'Mercado',
                value: 123.45,
                dueDate: '2026-10-05',
                paymentDate: '2026-10-05',
            });
            if (!expense.ok) {
                throw new Error(JSON.stringify(expense.error));
            }
            return core.call('statements.get', { accountId: started.data.account.id, period: '2026-10' });
        });

        expect(statement.ok).toBe(true);
        if (statement.ok) {
            expect(statement.data.transactions.map((transaction) => transaction.name)).toEqual(['Mercado']);
            expect(statement.data.closing.consolidated.amount).toBeCloseTo(1000 - 123.45);
        }
        await first.window.reload();
        await expect(first.window.getByTestId('profiles')).toHaveText('Pessoal · BRL');
        await first.app.close();

        const second = await launchApp(userData);
        await expect(second.window.getByTestId('profiles')).toHaveText('Pessoal · BRL');
        await second.app.close();
    } finally {
        removeUserData(userData);
    }
});

test('o renderer não tem Node e enxerga só a ponte, sob CSP restrita (desktop-shell-design §3.6)', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        await expect(page.getByTestId('profiles')).toBeVisible();
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
        await expect(page.getByTestId('profiles')).toBeVisible();
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
