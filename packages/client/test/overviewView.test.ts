import type { CategoryReportResponse, MoneyResponse, MonthSummaryResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { balanceEvolutionRows, overviewAccountRows, overviewCardRows, overviewKpis, topCategories } from '../src/index.ts';
import { ClientWorld } from './support/ClientWorld.ts';

/**
 * @param amount Valor em reais.
 * @return O dinheiro como o núcleo o devolve.
 */
function brl(amount: number): MoneyResponse {
    return { amount, currency: 'BRL' };
}

/**
 * @param overrides Campos que o teste fixa.
 * @return Os indicadores do mockup `Main`: 9.500 de receita, 3.219,32 de despesa (−12%) e uma
 * fatura de 2.449,75 vencendo em 10/10.
 */
function summary(overrides: Partial<MonthSummaryResponse> = {}): MonthSummaryResponse {
    return {
        period: '2026-10',
        income: brl(9500),
        incomeCount: 1,
        expenses: brl(3219.32),
        expenseCount: 6,
        previousExpenses: brl(3658.32),
        expenseVariation: { absolute: brl(-439), change: { kind: 'ratio', ratio: -0.12 } },
        openInvoices: { amountDue: brl(2449.75), invoices: 1, creditCards: 1, nextDueDate: '2026-10-10' },
        ...overrides,
    };
}

/**
 * @param categories Nome e valor do período de cada categoria, na ordem do núcleo.
 * @return Um relatório por categoria só com o que o bloco "Maiores categorias" lê.
 */
function categoryReport(categories: readonly (readonly [string, number])[]): CategoryReportResponse {
    const flat = { comparison: brl(0), variation: { absolute: brl(0), change: { kind: 'new' } } } as const;
    return {
        period: '2026-10',
        comparison: { mode: 'previousMonth', periods: ['2026-09'] },
        categories: categories.map(([name, amount]) => ({ categoryId: name, name, amount: brl(amount), ...flat, subCategories: [] })),
        total: { amount: brl(categories.reduce((sum, [, amount]) => sum + amount, 0)), ...flat },
    };
}

describe('indicadores da Visão geral (mockup Main)', () => {
    it('cinco indicadores com o sinal da entrada e da saída, e o saldo igual ao total de Contas', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const accounts = await world.ok('accounts.list', { profileId: s.profileId, period: '2026-10' });
        const kpis = overviewKpis(accounts, await world.ok('reports.monthSummary', { profileId: s.profileId, period: '2026-10' }));

        expect(kpis.consolidated).toEqual({ label: 'Saldo consolidado', value: formatTotal(accounts.total.consolidated.amount), sub: 'Já pago/recebido · 2 contas', tone: 'strong' });
        expect(kpis.projected).toMatchObject({ label: 'Saldo previsto', value: formatTotal(accounts.total.projected.amount), sub: 'Fim do mês, com tudo lançado', tone: 'projected' });
        expect(kpis.income).toEqual({ label: '↑ Receitas', value: '+R$ 9.500,00', sub: '1 lançamento', tone: 'in' });
        // Regra de negócio (Relatórios): o aluguel pendente vence em out e a feira de ago entra
        // em out, mês em que a fatura de set foi paga; setembro não tem despesa (base zero, R6).
        expect(kpis.expenses).toEqual({ label: '↓ Despesas', value: '−R$ 2.420,00', sub: 'Sem despesas no mês anterior', tone: 'out' });
        // A fatura de set está paga e a do supermercado vence em nov: nenhuma vence em out.
        expect(kpis.openInvoices).toEqual({ label: 'Faturas em aberto', value: 'R$ 0,00', sub: 'Nenhuma vence neste mês', tone: 'strong' });
    });

    it('Regra de negócio (Contas): a contagem do consolidado ignora a conta fora do total, como o próprio total', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        await world.ok('accounts.create', { profileId: s.profileId, name: 'Wise', type: 'checking', considerBalance: false, openingBalance: 2100 });
        const accounts = await world.ok('accounts.list', { profileId: s.profileId, period: '2026-10' });

        expect(overviewKpis(accounts, summary()).consolidated.sub).toBe('Já pago/recebido · 2 contas');
    });

    it('variação das despesas em percentual inteiro e faturas pelo vencimento mais próximo', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const accounts = await world.ok('accounts.list', { profileId: s.profileId, period: '2026-10' });

        expect(overviewKpis(accounts, summary()).expenses).toMatchObject({ value: '−R$ 3.219,32', sub: '−12% vs mês anterior' });
        expect(overviewKpis(accounts, summary({ expenseVariation: { absolute: brl(0), change: { kind: 'ratio', ratio: 0 } } })).expenses.sub).toBe('0% vs mês anterior');
        expect(overviewKpis(accounts, summary()).openInvoices).toMatchObject({ value: 'R$ 2.449,75', sub: '1 cartão · vence 10/10' });
        expect(overviewKpis(accounts, summary({ openInvoices: { amountDue: brl(3062.05), invoices: 2, creditCards: 2, nextDueDate: '2026-10-07' } })).openInvoices.sub).toBe('2 cartões · a primeira vence 07/10');
        expect(overviewKpis(accounts, summary({ incomeCount: 0, income: brl(0) })).income).toMatchObject({ value: 'R$ 0,00', sub: 'Nenhum lançamento' });
        expect(overviewKpis(accounts, summary({ incomeCount: 3 })).income.sub).toBe('3 lançamentos');
        // Só estornos no mês: o gasto é negativo e a saída vira entrada, com o sinal certo.
        expect(overviewKpis(accounts, summary({ expenses: brl(-23.9) })).expenses.value).toBe('+R$ 23,90');
    });
});

describe('evolução do saldo', () => {
    it('seis meses até o de referência, com o rótulo do eixo, o da tabela e os textos da tabela', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const rows = balanceEvolutionRows(await world.ok('reports.balanceEvolution', { profileId: s.profileId, period: '2026-10', months: 6 }));

        expect(rows.map((row) => [row.axisLabel, row.label, row.isReference])).toEqual([
            ['mai', 'mai/2026', false],
            ['jun', 'jun/2026', false],
            ['jul', 'jul/2026', false],
            ['ago', 'ago/2026', false],
            ['set', 'set/2026', false],
            ['out', 'out/2026', true],
        ]);
        // A tabela e o gráfico saem da mesma linha: o texto é o número formatado.
        const reference = rows.at(-1);
        expect(reference?.consolidatedText).toBe(formatTotal(reference?.consolidated ?? Number.NaN));
        expect(reference?.projectedText).toBe(formatTotal(reference?.projected ?? Number.NaN));
    });
});

describe('maiores categorias', () => {
    it('as quatro maiores na ordem do núcleo, com a barra relativa à maior', () => {
        const top = topCategories(categoryReport([['Moradia', 2300], ['Alimentação', 487.32], ['Compras', 400], ['Assinaturas', 55.9], ['Saúde', 30]]));

        expect(top.map((category) => [category.name, category.amount])).toEqual([
            ['Moradia', 'R$ 2.300,00'],
            ['Alimentação', 'R$ 487,32'],
            ['Compras', 'R$ 400,00'],
            ['Assinaturas', 'R$ 55,90'],
        ]);
        expect(top[0]?.barRatio).toBe(1);
        expect(top[1]?.barRatio).toBeCloseTo(0.2119, 4);
    });

    it('Regra de negócio (Relatórios, R2): categoria zerada ou negativa pelos estornos não é gasto e fica fora', () => {
        expect(topCategories(categoryReport([['Moradia', 100], ['Viagem', 0], ['Compras', -40]])).map((category) => category.name)).toEqual(['Moradia']);
        expect(topCategories(categoryReport([]))).toEqual([]);
    });

    it('lê o mesmo relatório da tela Por categoria', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const report = await world.ok('reports.byCategory', { profileId: s.profileId, period: '2026-10' });

        expect(topCategories(report)).toEqual([{ categoryId: s.categoryId, name: 'Alimentação', amount: 'R$ 2.420,00', barRatio: 1 }]);
    });
});

describe('resumos de contas e cartões', () => {
    it('Regra de negócio (Contas): conta fora do total apagada e só com o consolidado; desativada continua', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const wise = await world.ok('accounts.create', { profileId: s.profileId, name: 'Wise', type: 'checking', considerBalance: false, openingBalance: 2100 });
        await world.ok('accounts.disable', { id: s.savingsId });
        const rows = overviewAccountRows((await world.ok('accounts.list', { profileId: s.profileId, period: '2026-10' })).accounts);

        expect(rows.find((row) => row.accountId === wise.id)).toEqual({
            accountId: wise.id,
            name: 'Wise',
            detail: 'Corrente · fora do total',
            consolidated: 'R$ 2.100,00',
            projected: null,
            outsideTotal: true,
            disabled: false,
        });
        expect(rows.find((row) => row.accountId === s.savingsId)).toMatchObject({ detail: 'Investimentos', outsideTotal: false, disabled: true });
        expect(rows.find((row) => row.accountId === s.checkingId)?.projected).toMatch(/^previsto R\$ /);
    });

    it('Regra de negócio (Fatura): paga, em aberto ou sem fatura no mês, com o vencimento e a conta que paga', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const accounts = (await world.ok('accounts.list', { profileId: s.profileId, period: '2026-10' })).accounts;
        const rowOf = async (period: string): Promise<ReturnType<typeof overviewCardRows>[number] | undefined> =>
            overviewCardRows(await world.ok('creditCards.list', { profileId: s.profileId, period }), accounts)[0];

        expect(await rowOf('2026-09')).toEqual({ creditCardId: s.creditCardId, name: 'Roxinho', detail: 'vence 10/09 · paga com Nubank', status: { text: 'Paga', tone: 'ok' }, amount: 'R$ 120,00', disabled: false });
        expect(await rowOf('2026-11')).toMatchObject({ detail: 'vence 10/11 · paga com Nubank', status: { text: 'Em aberto', tone: 'warn' }, amount: 'R$ 487,32' });
        expect(await rowOf('2026-10')).toMatchObject({ detail: 'vence 10/10 · paga com Nubank', status: null, amount: '—' });
    });
});

/**
 * Formata um saldo pelo caminho mais curto, sem os formatadores do `client`, para que o teste
 * não confira o formatador contra ele mesmo.
 *
 * @param amount Valor em reais.
 * @return `R$ 1.234,56` ou `−R$ 1.234,56`.
 */
function formatTotal(amount: number): string {
    const [integer = '0', fraction = '00'] = Math.abs(amount).toFixed(2).split('.');
    return `${amount < 0 ? '−' : ''}R$ ${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${fraction}`;
}
