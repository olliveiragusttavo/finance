import { BetterSqliteDatabase } from '@finance/sqlite-better';
import { expect, test } from '@playwright/test';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { currentPeriod } from '../src/renderer/src/shell/referenceMonth.ts';
import { completeFirstUse } from './firstUse.ts';
import { freshUserData, launchApp, removeUserData } from './launchApp.ts';

/*
 * Teste de fumaça do esqueleto (desktop-mvp-plan Fase 3.3): o caminho inteiro — janela,
 * preload, `MessagePort`, `utilityProcess`, `better-sqlite3` no ABI do Electron e o arquivo
 * em disco — funcionando no binário real. Tudo pela tela, como o usuário: o perfil nasce no
 * primeiro uso (Fase 5), a despesa é lançada em Transações (Fase 9) e o extrato é conferido em
 * Contas (Fase 7).
 */

test('abre, cria perfil, lança uma despesa e vê no extrato; os dados sobrevivem a reabrir o app', async () => {
    const userData = freshUserData();
    try {
        const first = await launchApp(userData);
        await completeFirstUse(first.window, { profileName: 'Pessoal', accountName: 'Nubank', openingBalance: '1.000,00' });

        const period = currentPeriod(new Date());
        const page = first.window;
        await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Transações', exact: true }).dispatchEvent('click');
        await page.getByRole('button', { name: '+ Lançamento' }).dispatchEvent('click');
        const column = page.getByRole('complementary', { name: 'Novo lançamento' });
        await column.getByLabel('Valor (BRL)').fill('123,45');
        await column.getByLabel('Nome').fill('Mercado');
        await column.getByLabel('Categoria', { exact: true }).dispatchEvent('click');
        await page.getByRole('combobox', { name: 'Buscar categoria' }).fill('mercado');
        await page.getByRole('combobox', { name: 'Buscar categoria' }).press('Enter');
        await column.getByLabel('Conta ou cartão').press('Enter');
        await page.getByRole('option', { name: 'Nubank', exact: true }).press('Enter');
        await column.getByLabel('Data', { exact: true }).fill(`${period}-05`);
        await column.getByLabel('Pago').dispatchEvent('click');
        await column.getByLabel('Data do pagamento').fill(`${period}-05`);
        await column.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');
        await expect(page.getByRole('region', { name: 'Lançamentos do mês' })).toContainText('Mercado');

        await first.window.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Contas', exact: true }).dispatchEvent('click');
        await expect(first.window.getByRole('region', { name: 'Movimentos' }).getByRole('row').nth(1)).toContainText('Mercado');
        await expect(first.window.getByRole('region', { name: 'Resumo do extrato' })).toContainText('Saldo finalR$ 876,55');
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
