import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BetterSqliteDatabase } from '@finance/sqlite-better';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { OpenDialogReturnValue, SaveDialogReturnValue } from 'electron';
import { completeFirstUse } from './firstUse.ts';
import { launchApp, removeUserData } from './launchApp.ts';

/*
 * Importação de transações (desktop-mvp-plan Fase 13.1) no app empacotado: o assistente inteiro,
 * de Transações à confirmação, com o diálogo de abrir e o de salvar trocados no processo principal
 * — são nativos, fora do alcance do Playwright. Os cliques usam `dispatchEvent`, pelo mesmo motivo
 * do teste de fumaça: no container a janela fica fora da tela.
 */

/**
 * Export no formato do app de origem (import-design §1): compra no cartão paga pela fatura, série
 * fixa encerrada e uma despesa em aberto. Datas de 2025, para não depender do dia em que o teste
 * roda.
 */
const EXPENSES_CSV = [
    '"Descrição","Valor","Encargos","Lançamento","Vencimento","Efetivação","Recorrência","Parcela","Parcelas","Categoria","Subcategoria","Cartão","Conta","Observações"',
    '"Mercado","46.88","0.00","02/03/2025 10:04","15/03/2025","12/03/2025","Nenhuma","0","0","Moradia","Mercado","Inter","Banco Inter",""',
    '"Aluguel","1000.00","0.00","11/01/2025 07:00","11/01/2025","11/01/2025","Fixa mensal","0","0","Moradia","Aluguel","-","Banco Inter","#casa"',
    '"Aluguel","1000.00","0.00","11/01/2025 07:00","11/02/2025","11/02/2025","Fixa mensal","0","0","Moradia","Aluguel","-","Banco Inter",""',
    '"Padaria","12.50","0.00","05/03/2025 08:00","05/03/2025","-","Nenhuma","0","0","Alimentação","Café","-","Banco Inter",""',
].join('\n');

/**
 * Troca o diálogo de abrir por um que responde o arquivo dado.
 *
 * @param app App aberto pelo teste.
 * @param filePath Arquivo a responder.
 */
async function answerOpenDialog(app: ElectronApplication, filePath: string): Promise<void> {
    await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = (): Promise<OpenDialogReturnValue> => Promise.resolve({ canceled: false, filePaths: [path] });
    }, filePath);
}

/**
 * Troca o diálogo de salvar (a cópia antes de importar) por um que responde o destino dado.
 *
 * @param app App aberto pelo teste.
 * @param filePath Destino da cópia.
 */
async function answerSaveDialog(app: ElectronApplication, filePath: string): Promise<void> {
    await app.evaluate(({ dialog }, path) => {
        dialog.showSaveDialog = (): Promise<SaveDialogReturnValue> => Promise.resolve({ canceled: false, filePath: path });
    }, filePath);
}

/**
 * Abre o arquivo na etapa Arquivo.
 *
 * @param page Janela na importação.
 */
async function chooseFile(page: Page): Promise<void> {
    await page.getByRole('button', { name: /Escolher arquivo…|Trocar arquivo…/ }).dispatchEvent('click');
    await expect(page.getByRole('region', { name: 'Arquivo', exact: true })).toContainText('Despesas.csv');
}

test('importa um export de despesas de Transações à confirmação, e reconhece o modelo salvo', async () => {
    const { app, window: page, userData } = await launchApp();
    const files = mkdtempSync(join(tmpdir(), 'finance-e2e-import-'));
    try {
        const csv = join(files, 'Despesas.csv');
        writeFileSync(csv, EXPENSES_CSV);
        await completeFirstUse(page, { profileName: 'Gustavo', accountName: 'Banco Inter' });

        // Entrada por Transações; tela de configuração, com o caminho no lugar do mês.
        await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Transações', exact: true }).dispatchEvent('click');
        await page.getByRole('link', { name: 'Importar arquivo…' }).dispatchEvent('click');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Importar transações');
        await expect(page.getByTestId('reference-month')).toHaveCount(0);
        await expect(page.getByRole('navigation', { name: 'Caminho' })).toHaveText(/Ajustes\s*›\s*Importar dados/);

        // 1 — Arquivo: tipo e leitura detectados.
        await answerOpenDialog(app, csv);
        await chooseFile(page);
        await expect(page.getByRole('region', { name: 'O que o arquivo contém' })).toContainText('Detectado: Despesas (nome do arquivo e coluna “Encargos”)');
        await expect(page.getByRole('radio', { name: /Despesas/ })).toHaveAttribute('aria-checked', 'true');
        await expect(page.getByRole('table', { name: 'Primeiras linhas do arquivo' })).toContainText('Mercado');
        await page.getByRole('button', { name: 'Próximo: ligar colunas ›' }).dispatchEvent('click');

        // 2 — Colunas: "Efetivação" fica como dica; ligar pelo clique, a alternativa ao arrastar.
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ligue as colunas do arquivo aos campos do app');
        const columns = page.getByRole('region', { name: 'Colunas do arquivo' });
        await expect(columns).toContainText('Parece ser: Data de pagamento');
        await page.getByRole('complementary', { name: 'Campos do app' }).getByRole('button', { name: /Data de pagamento/ }).dispatchEvent('click');
        await columns.getByRole('button', { name: 'Coluna F sem campo: ligar a Data de pagamento' }).dispatchEvent('click');
        await expect(columns.getByRole('button', { name: 'Coluna F ligada a Data de pagamento' })).toBeVisible();
        await expect(page.getByRole('status').filter({ hasText: 'Todos os campos obrigatórios estão ligados.' })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Prévia' })).toContainText('Pago 12/03/2025');
        await page.getByRole('button', { name: 'Próximo: revisar ›' }).dispatchEvent('click');

        // 3 — Revisar: a conta de mesmo nome é ligada; o cartão novo pede o fechamento.
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Revisar antes de importar');
        await expect(page.getByLabel('Ligar Banco Inter a')).toHaveValue(/.+/);
        await expect(page.getByLabel('Ligar Banco Inter a')).not.toHaveValue('create');
        const importButton = page.getByRole('button', { name: 'Importar 4 linhas' });
        await expect(importButton).toBeDisabled();
        await expect(page.getByText('Falta: fechamento de 1 cartão')).toBeVisible();
        await page.getByLabel('Dia de fechamento de Inter').fill('8');
        await expect(importButton).toBeEnabled();

        // A cópia antes de importar passa pelo diálogo de salvar, como a de Ajustes.
        const copy = join(files, 'antes.sqlite');
        await answerSaveDialog(app, copy);
        await importButton.dispatchEvent('click');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Importação concluída');
        await expect(page.getByRole('status')).toContainText(/Importado: 4 lançamentos, 1 recorrências, 1 faturas pagas, 1 cartões novos/);
        const before = BetterSqliteDatabase.open(copy);
        expect(before.get('SELECT COUNT(*) AS n FROM transactions')).toEqual({ n: 0 });
        before.close();

        // O modelo salvo liga as colunas sozinho na próxima importação.
        await page.getByRole('button', { name: 'Importar outro arquivo' }).dispatchEvent('click');
        await chooseFile(page);
        await expect(page.getByRole('region', { name: 'O que o arquivo contém' })).toContainText('Detectado: Despesas (modelo “Despesas — Despesas.csv”)');
        await page.getByRole('button', { name: 'Próximo: ligar colunas ›' }).dispatchEvent('click');
        await expect(page.getByRole('region', { name: 'Colunas do arquivo' }).getByRole('button', { name: 'Coluna F ligada a Data de pagamento' })).toBeVisible();
    } finally {
        await app.close();
        removeUserData(userData);
        rmSync(files, { recursive: true, force: true });
    }
});
