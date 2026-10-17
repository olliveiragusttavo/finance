import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BetterSqliteDatabase } from '@finance/sqlite-better';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { OpenDialogReturnValue, SaveDialogReturnValue } from 'electron';
import { completeFirstUse } from './firstUse.ts';
import { launchApp, removeUserData } from './launchApp.ts';

/*
 * Ajustes (desktop-mvp-plan Fase 13) no app empacotado: tema, exportar a cópia do banco, local
 * do arquivo, atalhos e versões. O diálogo de salvar e o "mostrar na pasta" são nativos, fora do
 * alcance do Playwright: o teste os troca no processo principal por versões que respondem o
 * destino e registram o pedido. Os cliques usam `dispatchEvent`, pelo mesmo motivo do teste de
 * fumaça: no container a janela fica fora da tela.
 */

/**
 * @param page Janela do app com o shell aberto.
 */
async function openSettings(page: Page): Promise<void> {
    await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Ajustes', exact: true }).dispatchEvent('click');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ajustes');
}

/**
 * Troca o diálogo de salvar por um que responde o destino dado, ou o cancelamento.
 *
 * @param app App aberto pelo teste.
 * @param filePath Destino a responder; `null` simula o usuário fechando o diálogo.
 */
async function answerSaveDialog(app: ElectronApplication, filePath: string | null): Promise<void> {
    await app.evaluate(({ dialog }, path) => {
        dialog.showSaveDialog = (): Promise<SaveDialogReturnValue> =>
            Promise.resolve(path === null ? { canceled: true, filePath: '' } : { canceled: false, filePath: path });
    }, filePath);
}

/**
 * Troca o diálogo de abrir por um que responde o arquivo dado, ou o cancelamento.
 *
 * @param app App aberto pelo teste.
 * @param filePath Arquivo a responder; `null` simula o usuário fechando o diálogo.
 */
async function answerOpenDialog(app: ElectronApplication, filePath: string | null): Promise<void> {
    await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = (): Promise<OpenDialogReturnValue> =>
            Promise.resolve(path === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [path] });
    }, filePath);
}

/**
 * Pede a importação pela linha de Ajustes e confirma o alerta, como o usuário faz.
 *
 * @param page Janela do app em Ajustes.
 */
async function requestImport(page: Page): Promise<void> {
    await page.getByRole('region', { name: 'Dados' }).getByRole('button', { name: 'Importar…' }).dispatchEvent('click');
    const confirmation = page.getByRole('alertdialog', { name: 'Importar cópia do banco?' });
    await expect(confirmation).toContainText('serão substituídos pelos da cópia escolhida');
    await confirmation.getByRole('button', { name: 'Escolher a cópia…' }).dispatchEvent('click');
    await expect(confirmation).toHaveCount(0);
}

test('importar cópia do banco: recusa o que não serve e troca os dados, guardando o banco anterior', async () => {
    const { app, window: page, userData } = await launchApp();
    const folder = mkdtempSync(join(tmpdir(), 'finance-e2e-import-'));
    try {
        await completeFirstUse(page, { profileName: 'Ana', accountName: 'Nubank' });
        await openSettings(page);
        const copy = join(folder, 'financas.sqlite');
        await answerSaveDialog(app, copy);
        await page.getByRole('region', { name: 'Dados' }).getByRole('button', { name: 'Exportar…' }).dispatchEvent('click');
        await expect(page.getByText(`Cópia salva em ${copy}.`)).toBeVisible();

        // Depois da cópia, o aparelho ganha um perfil que ela não tem, e é ele que fica aberto.
        await page.evaluate(async () => {
            const created = await window.finance.core.call('profiles.create', { name: 'Estúdio GO', type: 'business', currency: 'BRL' });
            if (!created.ok) {
                throw new Error('não foi possível criar o perfil do teste');
            }
            await window.finance.preferences.update({ lastProfileId: created.data.id });
        });
        await page.reload();
        await expect(page.getByTestId('profile-switcher')).toContainText('Estúdio GO');
        await openSettings(page);
        const dataCopy = page.getByRole('region', { name: 'Dados' });

        // Desistir no alerta e cancelar o diálogo não mudam nada nem avisam.
        await dataCopy.getByRole('button', { name: 'Importar…' }).dispatchEvent('click');
        await page.getByRole('alertdialog').getByRole('button', { name: 'Cancelar' }).dispatchEvent('click');
        await expect(page.getByRole('alertdialog')).toHaveCount(0);
        await answerOpenDialog(app, null);
        await requestImport(page);
        await expect(dataCopy.getByRole('button', { name: 'Importar…' })).toBeEnabled();
        await expect(dataCopy.getByRole('alert')).toHaveCount(0);

        // O próprio banco e um arquivo que não é banco são recusados, com o motivo na linha.
        const databasePath = join(userData, 'finance.sqlite');
        await answerOpenDialog(app, databasePath);
        await requestImport(page);
        await expect(dataCopy.getByRole('alert')).toContainText('Escolha outro arquivo');
        const text = join(folder, 'extrato.sqlite');
        writeFileSync(text, 'data;valor\n'.repeat(500));
        await answerOpenDialog(app, text);
        await requestImport(page);
        await expect(dataCopy.getByRole('alert')).toContainText('não é um banco SQLite');
        await expect(page.getByTestId('profile-switcher')).toContainText('Estúdio GO');

        // A cópia entra: a janela recarrega em Ajustes, com os dados da cópia e o aviso de onde
        // ficou o banco anterior.
        await answerOpenDialog(app, copy);
        await requestImport(page);
        await expect(page.getByRole('region', { name: 'Dados' }).getByRole('status')).toContainText(`Cópia ${copy} importada. O banco anterior foi guardado em ${join(userData, 'backups', 'antes-da-importacao-')}`);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ajustes');
        await expect(page.getByTestId('profile-switcher')).toContainText('Ana');
        const profiles = await page.evaluate(async () => {
            const listed = await window.finance.core.call('profiles.list', {});
            return listed.ok ? listed.data.map((profile) => profile.name) : [];
        });
        expect(profiles).toEqual(['Ana']);

        const [previous] = readdirSync(join(userData, 'backups')).filter((name) => name.startsWith('antes-da-importacao-') && name.endsWith('.sqlite'));
        expect(previous).toBeDefined();
        const kept = BetterSqliteDatabase.open(join(userData, 'backups', previous ?? ''));
        expect(kept.all('SELECT name FROM profiles ORDER BY name')).toEqual([{ name: 'Ana' }, { name: 'Estúdio GO' }]);
        kept.close();
        // O arquivo escolhido continua como estava, e o aviso é dado uma vez só.
        expect(readdirSync(folder).sort()).toEqual(['extrato.sqlite', 'financas.sqlite']);
        await page.reload();
        await openSettings(page);
        await expect(page.getByRole('region', { name: 'Dados' }).getByRole('status')).toHaveCount(0);
    } finally {
        await app.close();
        removeUserData(userData);
        rmSync(folder, { recursive: true, force: true });
    }
});

test('tema, cópia do banco, local do arquivo, atalhos e versões', async () => {
    const { app, window: page, userData } = await launchApp();
    const destinationFolder = mkdtempSync(join(tmpdir(), 'finance-e2e-export-'));
    try {
        await completeFirstUse(page, { profileName: 'Gustavo', accountName: 'Nubank' });
        await openSettings(page);
        // Tela de configuração: sem a barra do mês (Fase 4) e sem a seção de perfil do mockup.
        await expect(page.getByTestId('reference-month')).toHaveCount(0);
        await expect(page.getByRole('region', { name: 'Perfil atual' })).toHaveCount(0);

        // Tema: o mesmo da barra superior, nos dois sentidos.
        const theme = page.getByRole('radiogroup', { name: 'Tema' });
        await expect(theme.getByRole('radio', { name: 'Seguir o sistema' })).toBeChecked();
        await theme.getByRole('radio', { name: 'Escuro' }).dispatchEvent('click');
        await expect(page.locator('html')).toHaveClass(/\bdark\b/);
        await expect(page.getByRole('button', { name: 'Tema escuro' })).toBeVisible();
        await theme.getByRole('radio', { name: 'Claro' }).dispatchEvent('click');
        await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);

        // Versões e local do arquivo.
        const about = page.getByRole('region', { name: 'Sobre' });
        await expect(about).toContainText(/Versão do app\s*\d+\.\d+\.\d+/);
        await expect(about).toContainText(/Versão do banco de dados.*v\d+/);
        const databasePath = join(userData, 'finance.sqlite');
        const dataCopy = page.getByRole('region', { name: 'Dados' });
        await expect(dataCopy).toContainText(databasePath);
        await app.evaluate(({ shell }) => {
            const opened: string[] = [];
            Object.assign(globalThis, { shownInFolder: opened });
            shell.showItemInFolder = (path: string): void => {
                opened.push(path);
            };
        });
        await dataCopy.getByRole('button', { name: 'Mostrar na pasta' }).dispatchEvent('click');
        await expect.poll(() => app.evaluate((): unknown => Reflect.get(globalThis, 'shownInFolder'))).toEqual([databasePath]);

        // Exportar: cancelar não avisa nada; o próprio banco é recusado; a cópia abre com os dados.
        await expect(dataCopy).toContainText('Nenhuma cópia exportada ainda');
        const exportButton = dataCopy.getByRole('button', { name: 'Exportar…' });
        await answerSaveDialog(app, null);
        await exportButton.dispatchEvent('click');
        await expect(exportButton).toBeEnabled();
        await expect(dataCopy.getByRole('alert')).toHaveCount(0);

        await answerSaveDialog(app, databasePath);
        await exportButton.dispatchEvent('click');
        await expect(dataCopy.getByRole('alert')).toContainText('Escolha outro arquivo');
        await expect(dataCopy).toContainText('Nenhuma cópia exportada ainda');

        const destination = join(destinationFolder, 'financas.sqlite');
        await answerSaveDialog(app, destination);
        await exportButton.dispatchEvent('click');
        await expect(page.getByText(`Cópia salva em ${destination}.`)).toBeVisible();
        await expect(dataCopy.getByRole('alert')).toHaveCount(0);
        await expect(dataCopy).toContainText(/Última cópia: \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}/);
        expect(existsSync(destination)).toBe(true);
        const copy = BetterSqliteDatabase.open(destination);
        expect(copy.get('SELECT name FROM profiles')).toEqual({ name: 'Gustavo' });
        copy.close();

        // Atalhos: os que existem, agrupados por onde valem; sem o Ctrl K ainda pendente.
        const shortcuts = page.getByRole('region', { name: 'Atalhos de teclado' });
        await expect(shortcuts.getByRole('region', { name: 'Em qualquer tela' })).toContainText('Novo lançamento');
        await expect(shortcuts.getByRole('region', { name: 'Listas de lançamentos (Transações, extrato e fatura)' })).toContainText('Marcar ou desmarcar como pago');
        await expect(shortcuts).not.toContainText('Ctrl');

        // A data da última cópia é do aparelho e sobrevive a recarregar a janela.
        await page.reload();
        await openSettings(page);
        await expect(page.getByRole('region', { name: 'Dados' })).toContainText(/Última cópia: \d{2}\/\d{2}\/\d{4}/);
    } finally {
        await app.close();
        removeUserData(userData);
        rmSync(destinationFolder, { recursive: true, force: true });
    }
});
