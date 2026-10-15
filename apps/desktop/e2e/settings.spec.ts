import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BetterSqliteDatabase } from '@finance/sqlite-better';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { SaveDialogReturnValue } from 'electron';
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
        await expect(shortcuts.getByRole('region', { name: 'Tabela de Transações' })).toContainText('Marcar ou desmarcar como pago');
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
