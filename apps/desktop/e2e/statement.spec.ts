import { expect, test, type Page } from '@playwright/test';
import { currentPeriod, shiftPeriod } from '../src/renderer/src/shell/referenceMonth.ts';
import { completeFirstUse } from './firstUse.ts';
import { launchApp, removeUserData } from './launchApp.ts';

/*
 * Extrato (mockup `DesktopExtrato`) no app empacotado: o resultado de cada dia na tabela dia × mês
 * dos últimos 12 meses, o atraso, o detalhe do dia, o filtro "Tipo" e a volta para a lista de
 * Transações. O cenário fica no mês anterior, que já passou inteiro: o vencimento do dia 5 é
 * atrasado em qualquer dia em que o teste rode. Os cliques usam `dispatchEvent`, pelo motivo
 * explicado em `firstUse.ts`.
 */

/** Meses abreviados como nas colunas da tabela (`formatMonthAbbreviation`). */
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;

/**
 * @param period Mês `YYYY-MM`.
 * @return O rótulo da coluna, `out/26`, como o nome acessível das células o usa.
 */
function columnLabel(period: string): string {
    return `${MONTHS[Number(period.slice(5)) - 1] ?? ''}/${period.slice(2, 4)}`;
}

/**
 * Semeia pela ponte o mês anterior: Salário recebido no dia 1 e Aluguel em aberto no dia 5. Depois
 * recarrega, porque a escrita pela ponte não passa pelo mapa de invalidação da tela.
 *
 * @param page Janela do app, com o shell aberto no perfil do primeiro uso.
 * @param period Mês do cenário, `YYYY-MM`.
 */
async function seedMonth(page: Page, period: string): Promise<void> {
    await page.evaluate(async (period) => {
        const { core } = window.finance;
        const { lastProfileId: profileId } = await window.finance.preferences.get();
        if (profileId === null) {
            throw new Error('nenhum perfil aberto');
        }
        const accounts = await core.call('accounts.list', { profileId, period });
        const tree = await core.call('categories.tree', { profileId });
        const nubank = accounts.ok ? accounts.data.accounts[0] : undefined;
        const market = tree.ok ? tree.data.find((category) => category.name === 'Alimentação')?.subCategories.find((sub) => sub.name === 'Mercado') : undefined;
        if (nubank === undefined || market === undefined) {
            throw new Error('cenário incompleto');
        }
        const base = { profileId, subCategoryId: market.id, source: { kind: 'account', accountId: nubank.id } } as const;
        await core.call('transactions.create', { ...base, type: 'income', name: 'Salário', value: 9500, dueDate: `${period}-01`, paymentDate: `${period}-01` });
        await core.call('transactions.create', { ...base, type: 'expense', name: 'Aluguel', value: 2300, dueDate: `${period}-05` });
    }, period);
    await page.reload();
}

test('extrato: resultado do dia por mês, atraso, detalhe do dia, tipo e volta à lista', async () => {
    const { app, window: page, userData } = await launchApp();
    const previous = shiftPeriod(currentPeriod(new Date()), -1);
    const column = columnLabel(previous);
    try {
        await completeFirstUse(page, { profileName: 'Pessoal', accountName: 'Nubank', openingBalance: '1.000,00' });
        await seedMonth(page, previous);
        await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Extrato', exact: true }).dispatchEvent('click');
        await expect(page.getByRole('heading', { name: 'Extrato', level: 1 })).toBeVisible();

        // O mês de referência vira o período: os últimos 12 meses, sem o ‹ mês ›.
        await expect(page.getByTestId('statement-period')).toContainText('(12 meses)');
        await expect(page.getByRole('button', { name: 'Mês anterior' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Últimos 12 meses' })).toHaveAttribute('aria-pressed', 'true');

        const table = page.getByRole('table', { name: 'Resultado por dia e mês' });
        const salary = table.getByRole('button', { name: `1 de ${column}: resultado +R$ 9.500,00, 1 lançamento` });
        const rent = table.getByRole('button', { name: `5 de ${column}: resultado −R$ 2.300,00, 1 lançamento, com atrasado` });
        await expect(salary).toHaveText('+9.500');
        await expect(rent).toHaveText('−2.300');

        if (process.env['FINANCE_E2E_SCREENSHOTS'] !== undefined) {
            await page.screenshot({ path: `${process.env['FINANCE_E2E_SCREENSHOTS']}/statement.png`, fullPage: true });
        }

        // Clicar na célula abre o dia no detalhe.
        await rent.dispatchEvent('click');
        await expect(rent).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByText('Tem lançamento atrasado', { exact: true })).toBeVisible();

        // Só despesas: o salário some da tabela, e o aluguel continua.
        await page.getByRole('group', { name: 'Tipo' }).getByRole('button', { name: 'Despesas' }).dispatchEvent('click');
        await expect(salary).toHaveCount(0);
        await expect(rent).toBeVisible();

        // "Lista" volta para Transações no mês do dia aberto.
        await page.getByRole('group', { name: 'Visualização' }).getByRole('link', { name: 'Lista' }).dispatchEvent('click');
        await expect(page.getByRole('heading', { name: 'Transações', level: 1 })).toBeVisible();
        await expect(page.getByRole('row', { name: /Aluguel/ })).toBeVisible();
    } finally {
        await app.close();
        removeUserData(userData);
    }
});
