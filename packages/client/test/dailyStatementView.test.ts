import { describe, expect, it } from 'vitest';
import {
    adjustStatementRange,
    buildDailyStatementView,
    buildTransactionTable,
    formatMoneyCompact,
    formatMoneyDigits,
    isValidStatementRange,
    NO_TRANSACTION_FILTERS,
    statementPeriods,
    statementPresets,
    type DailyStatementCell,
    type DailyStatementKind,
    type DailyStatementView,
    type TransactionFilters,
} from '../src/index.ts';
import { ClientWorld, type Scenario } from './support/ClientWorld.ts';

/**
 * Monta o extrato como a tela monta: a tabela de Transações de cada mês, com os mesmos filtros e as
 * faturas de cada mês, para que o teste exercite o mesmo caminho dos dados reais.
 *
 * @param world Núcleo do teste, com "hoje" em 15/10/2026.
 * @param s Ids do cenário.
 * @param periods Meses do período, do mais antigo ao mais recente.
 * @param options Filtros de Transações e o filtro "Tipo".
 * @return O extrato do período.
 */
async function statementOf(
    world: ClientWorld,
    s: Scenario,
    periods: readonly string[],
    options: { readonly filters?: TransactionFilters; readonly kind?: DailyStatementKind } = {},
): Promise<DailyStatementView> {
    const [accounts, creditCards, categories] = await Promise.all([
        world.ok('accounts.list', { profileId: s.profileId, period: '2026-10' }),
        world.ok('creditCards.list', { profileId: s.profileId, period: '2026-10' }),
        world.ok('categories.tree', { profileId: s.profileId }),
    ]);
    const months = await Promise.all(
        periods.map(async (period) => {
            const [transactions, monthInvoices] = await Promise.all([
                world.ok('transactions.listByPeriod', { profileId: s.profileId, period }),
                world.ok('statements.profileInvoices', { profileId: s.profileId, period }),
            ]);
            const table = buildTransactionTable(
                { profileId: s.profileId, transactions, accounts: accounts.accounts, creditCards: creditCards.creditCards, categories, invoices: [], monthInvoices },
                options.filters ?? NO_TRANSACTION_FILTERS,
            );
            return { period, rows: table.rows };
        }),
    );
    return buildDailyStatementView({ today: '2026-10-15', currency: 'BRL', kind: options.kind ?? 'all', months });
}

/**
 * @param view Extrato.
 * @param period Mês da coluna.
 * @param day Dia da linha.
 * @return A célula pedida.
 * @throws {Error} Quando a tabela não tem a coluna ou a linha — erro do próprio teste.
 */
function cellOf(view: DailyStatementView, period: string, day: number): DailyStatementCell {
    const column = view.months.findIndex((month) => month.period === period);
    const cell = view.rows.find((row) => row.day === day)?.cells[column];
    if (cell === undefined) {
        throw new Error(`a tabela não tem ${period} dia ${String(day)}`);
    }
    return cell;
}

/**
 * @param cell Célula da tabela.
 * @return Só o que a célula com valor mostra, para comparar sem os textos de acessibilidade.
 * @throws {Error} Quando a célula não tem valor — o que já é a falha que o teste quer apontar.
 */
function shown(cell: DailyStatementCell): { readonly text: string; readonly tone: string; readonly state: string } {
    if (cell.kind !== 'value') {
        throw new Error(`célula sem valor (${cell.kind})`);
    }
    return { text: cell.text, tone: cell.tone, state: cell.state };
}

describe('extrato dia × mês (mockup DesktopExtrato)', () => {
    it('tem uma coluna por mês e 31 linhas, hachurando os dias que o mês não tem', async () => {
        const world = new ClientWorld();
        const view = await statementOf(world, await world.seed(), ['2026-08', '2026-09', '2026-10', '2026-11']);

        expect(view.months.map((month) => month.label)).toEqual(['ago/26', 'set/26', 'out/26', 'nov/26']);
        expect(view.months.map((month) => month.current)).toEqual([false, false, true, false]);
        expect(view.periodLabel).toBe('ago/26 – nov/26 (4 meses)');
        expect(view.rows).toHaveLength(31);
        expect(cellOf(view, '2026-09', 31).kind).toBe('missing');
        expect(cellOf(view, '2026-08', 31).kind).toBe('empty');
    });

    it('Regra de negócio (Extrato): a célula mostra o resultado do dia, com a situação mais urgente', async () => {
        const world = new ClientWorld();
        const view = await statementOf(world, await world.seed(), ['2026-10']);

        expect(shown(cellOf(view, '2026-10', 1))).toEqual({ text: '+9.500', tone: 'in', state: 'paid' });
        // A fatura de setembro, paga em 02/10, entra pela linha da fatura, no dia em que pesou na conta.
        expect(shown(cellOf(view, '2026-10', 2))).toEqual({ text: '−120', tone: 'out', state: 'paid' });
        // O aluguel venceu em 05/10 e não foi pago: atrasado, porque hoje é 15/10.
        expect(shown(cellOf(view, '2026-10', 5))).toEqual({ text: '−2.300', tone: 'out', state: 'overdue' });
        const rent = cellOf(view, '2026-10', 5);
        expect(rent.kind === 'value' && rent.detail).toEqual({
            weekday: 'Segunda-feira',
            date: '05/10/2026',
            count: '1',
            income: 'R$ 0,00',
            expenses: '−R$ 2.300,00',
            result: '−R$ 2.300,00',
            tone: 'out',
            stateText: 'Tem lançamento atrasado',
        });
        expect(rent.kind === 'value' && rent.accessibleName).toBe('5 de out/26: resultado −R$ 2.300,00, 1 lançamento, com atrasado');
    });

    it('Regra de negócio (Extrato): a transferência dentro do perfil conta como lançamento, mas não muda o resultado', async () => {
        const world = new ClientWorld();
        const view = await statementOf(world, await world.seed(), ['2026-10']);

        // O aporte venceu em 10/10 e não foi feito: atrasado, mesmo sem mudar o resultado.
        expect(shown(cellOf(view, '2026-10', 10))).toEqual({ text: '0', tone: 'zero', state: 'overdue' });
        const [october] = view.months;
        expect(october).toMatchObject({ income: '9.500,00', expenses: '−2.420,00', result: '+7.080', resultTone: 'in', count: '4' });
    });

    it('com o filtro "Tipo", só o sentido escolhido entra, e o outro total vira "—"', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const expenses = await statementOf(world, s, ['2026-10'], { kind: 'expense' });

        expect(cellOf(expenses, '2026-10', 1).kind).toBe('empty');
        expect(cellOf(expenses, '2026-10', 10).kind).toBe('empty');
        expect(expenses.months[0]).toMatchObject({ income: '—', expenses: '−2.420,00', result: '−2.420', count: '2' });

        const income = await statementOf(world, s, ['2026-10'], { kind: 'income' });
        expect(income.months[0]).toMatchObject({ income: '9.500,00', expenses: '—', result: '+9.500', count: '1' });
    });

    it('com os filtros de Transações, a compra no cartão aparece no dia dela e não fica atrasada', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const view = await statementOf(world, s, ['2026-10'], { filters: { ...NO_TRANSACTION_FILTERS, tagId: s.tagId } });

        // Supermercado (06/10) está na fatura de novembro, em aberto: a vencer, e não atrasado.
        expect(shown(cellOf(view, '2026-10', 6))).toEqual({ text: '−487,32', tone: 'out', state: 'upcoming' });
        expect(cellOf(view, '2026-10', 1).kind).toBe('empty');
    });

    it('colore pela raiz do valor sobre o maior do período e abre o último dia com movimento até hoje', async () => {
        const world = new ClientWorld();
        const view = await statementOf(world, await world.seed(), ['2026-09', '2026-10']);

        const salary = cellOf(view, '2026-10', 1);
        const rent = cellOf(view, '2026-10', 5);
        expect(salary.kind === 'value' && salary.intensity).toBe(1);
        expect(rent.kind === 'value' && rent.intensity).toBeCloseTo(Math.sqrt(2300 / 9500));
        expect(view.defaultSelection).toEqual({ period: '2026-10', day: 10 });
    });
});

describe('período do extrato', () => {
    it('conta os atalhos a partir do mês corrente', () => {
        expect(statementPresets('2026-10').map(({ id, from, to }) => ({ id, from, to }))).toEqual([
            { id: 'last3', from: '2026-08', to: '2026-10' },
            { id: 'last6', from: '2026-05', to: '2026-10' },
            { id: 'last12', from: '2025-11', to: '2026-10' },
            { id: 'next6', from: '2026-11', to: '2027-04' },
        ]);
        expect(statementPeriods('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    });

    it('recusa período invertido ou maior que 24 meses, e ajusta o outro campo', () => {
        expect(isValidStatementRange('2025-01', '2026-12')).toBe(true);
        expect(isValidStatementRange('2025-01', '2027-01')).toBe(false);
        expect(isValidStatementRange('2026-10', '2026-09')).toBe(false);
        expect(adjustStatementRange('2026-10', '2026-01', 'from')).toEqual({ from: '2026-10', to: '2026-10' });
        expect(adjustStatementRange('2026-10', '2026-01', 'to')).toEqual({ from: '2026-01', to: '2026-01' });
        expect(adjustStatementRange('2024-01', '2026-10', 'from')).toEqual({ from: '2024-01', to: '2025-12' });
        expect(adjustStatementRange('2024-01', '2026-10', 'to')).toEqual({ from: '2024-11', to: '2026-10' });
    });

    it('formata os valores compactos das células e os totais sem símbolo', () => {
        expect(formatMoneyCompact({ amount: -1830, currency: 'BRL' })).toBe('−1.830');
        expect(formatMoneyCompact({ amount: -66.5, currency: 'BRL' })).toBe('−66,50');
        expect(formatMoneyCompact({ amount: 500, currency: 'BRL' })).toBe('+500');
        expect(formatMoneyCompact({ amount: 0, currency: 'BRL' })).toBe('0');
        expect(formatMoneyDigits({ amount: -2787.32, currency: 'BRL' })).toBe('−2.787,32');
    });
});
