import { describe, expect, it } from 'vitest';
import { buildTransactionTable, formatWeekdayDayMonth, groupTransactionsByDay, NO_TRANSACTION_FILTERS, transactionTotals } from '../src/index.ts';
import { ClientWorld } from './support/ClientWorld.ts';

/**
 * @param world Núcleo do teste, já com o cenário.
 * @param profileId Perfil do cenário.
 * @return A tabela agrupada de outubro, como a tela de Transações a monta.
 */
async function octoberTable(world: ClientWorld, profileId: string): Promise<ReturnType<typeof buildTransactionTable>> {
    const [transactions, accounts, creditCards, categories, monthInvoices] = await Promise.all([
        world.ok('transactions.listByPeriod', { profileId, period: '2026-10' }),
        world.ok('accounts.list', { profileId, period: '2026-10' }),
        world.ok('creditCards.list', { profileId, period: '2026-10' }),
        world.ok('categories.tree', { profileId }),
        world.ok('statements.profileInvoices', { profileId, period: '2026-10' }),
    ]);
    return buildTransactionTable({ profileId, transactions, accounts: accounts.accounts, creditCards: creditCards.creditCards, categories, invoices: [], monthInvoices }, NO_TRANSACTION_FILTERS);
}

describe('lista de Transações do celular (mobile-mvp-plan, Fase 9)', () => {
    it('o título do dia traz o dia da semana', () => {
        expect(formatWeekdayDayMonth('2026-10-12')).toBe('Seg, 12/10');
        expect(formatWeekdayDayMonth('2026-10-18')).toBe('Dom, 18/10');
    });

    it('agrupa as linhas por dia, na ordem da tabela', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const table = await octoberTable(world, s.profileId);

        const days = groupTransactionsByDay(table);

        expect(days.flatMap((day) => day.rows)).toEqual(table.rows);
        expect(new Set(days.map((day) => day.key)).size).toBe(days.length);
        expect(days.map((day) => day.label)).toContain('Qui, 01/10');
    });

    it('entradas mais saídas dão o resultado, sem as transferências dentro do perfil', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const table = await octoberTable(world, s.profileId);

        // Salário +9.500; aluguel −2.300; fatura de setembro paga em 02/10 −120; aporte fora.
        expect(transactionTotals(table)).toEqual({ incoming: '+R$ 9.500,00', outgoing: '−R$ 2.420,00', result: '+R$ 7.080,00' });
    });
});
