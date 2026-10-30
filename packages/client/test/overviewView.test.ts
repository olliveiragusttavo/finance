import type { GoalProgressResponse, OverviewPendingResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import {
    categoryShares,
    markedPaidMessage,
    overviewAccounts,
    overviewCardRows,
    overviewGoalRow,
    overviewKpis,
    overviewNextInvoicesKpi,
    overviewSpendingKpis,
    pendingBadge,
    pendingPanel,
    spendingChart,
} from '../src/index.ts';
import { ClientWorld } from './support/ClientWorld.ts';

const PERIOD = '2026-10';

describe('indicadores da Visão geral (mockup DesktopVisaoGeral2)', () => {
    it('saldo consolidado com o previsto na mesma caixa, igual ao total de Contas', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const accounts = await world.ok('accounts.list', { profileId: s.profileId, period: PERIOD });

        expect(overviewKpis(accounts).balance).toEqual({
            label: 'Saldo consolidado',
            value: formatTotal(accounts.total.consolidated.amount),
            sub: `2 contas no total · previsto ${formatTotal(accounts.total.projected.amount)}`,
            tone: 'strong',
        });
    });

    it('Regra de negócio (Contas): o patrimônio soma também as contas fora do total, que a contagem do saldo ignora', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        await world.ok('accounts.create', { profileId: s.profileId, name: 'CDB', type: 'investment', considerBalance: false, openingBalance: 2100 });
        const accounts = await world.ok('accounts.list', { profileId: s.profileId, period: PERIOD });
        const kpis = overviewKpis(accounts);

        expect(kpis.balance.sub).toMatch(/^2 contas no total · /);
        expect(kpis.netWorth).toEqual({ label: 'Patrimônio', value: formatTotal(accounts.total.consolidated.amount + 2100), sub: 'inclui CDB, fora do saldo total', tone: 'strong' });
    });

    it('Regra de negócio (Visão geral): gastos comparados com a média dos meses desde o primeiro com gasto, e as entradas do mês', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const spending = await world.ok('overview.spending', { profileId: s.profileId, period: PERIOD });

        // Setembro (a feira de R$ 120,00) e outubro (o aluguel de R$ 2.300,00): média de R$ 1.210,00.
        expect(overviewSpendingKpis(spending)).toEqual([
            { label: '↓ Gastos em outubro', value: 'R$ 2.300,00', sub: '90% acima da média de 2 meses', tone: 'out' },
            { label: '↑ Entradas em outubro', value: 'R$ 9.500,00', sub: 'receitas + transferências recebidas', tone: 'in' },
        ]);
        const empty = await world.ok('overview.spending', { profileId: s.profileId, period: '2026-03' });
        expect(overviewSpendingKpis(empty)[0].sub).toBe('sem gastos nos últimos meses para comparar');
    });

    it('próximas faturas: a soma da próxima em aberto de cada cartão', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const next = await world.ok('overview.nextInvoices', { profileId: s.profileId });

        expect(overviewNextInvoicesKpi(next, 'BRL')).toEqual({ label: 'Próximas faturas', value: 'R$ 487,32', sub: '1 cartão · vence 10/11', tone: 'strong' });
        expect(overviewNextInvoicesKpi({ today: '2026-10-15', invoices: [] }, 'BRL')).toMatchObject({ value: 'R$ 0,00', sub: 'nenhuma fatura em aberto' });
    });
});

describe('gráfico e categorias', () => {
    it('barras dos seis meses relativas ao maior valor, com a média e a descrição para o leitor de tela', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const chart = spendingChart(await world.ok('overview.spending', { profileId: s.profileId, period: PERIOD }));

        expect(chart.bars.map((bar) => [bar.label, bar.value, bar.current])).toEqual([
            ['mai', '0', false],
            ['jun', '0', false],
            ['jul', '0', false],
            ['ago', '0', false],
            ['set', '120', false],
            ['out', '2.300', true],
        ]);
        expect(chart.bars.at(-1)?.ratio).toBe(1);
        expect(chart.average).toEqual({ text: 'média R$ 1.210', ratio: 1210 / 2300 });
        expect(chart.description).toBe('Gastos de maio a outubro: 0, 0, 0, 0, 120, 2.300; média R$ 1.210');
    });

    it('participação sobre as categorias com gasto, e as outras numa linha só', () => {
        const brl = (amount: number): { readonly amount: number; readonly currency: string } => ({ amount, currency: 'BRL' });
        const shares = categoryShares({
            period: PERIOD,
            months: [],
            average: null,
            expenses: brl(1000),
            income: brl(0),
            categories: [
                { categoryId: 'a', name: 'Compras', amount: brl(500) },
                { categoryId: 'b', name: 'Moradia', amount: brl(250) },
            ],
            others: { count: 1, amount: brl(250) },
        });

        expect(shares.title).toBe('Para onde foi em outubro');
        expect(shares.rows.map((row) => [row.name, row.amount, row.share, row.barRatio])).toEqual([
            ['Compras', 'R$ 500,00', '50%', 1],
            ['Moradia', 'R$ 250,00', '25%', 0.5],
        ]);
        expect(shares.others).toMatchObject({ name: 'Outra categoria', amount: 'R$ 250,00', share: '25%' });
    });
});

describe('resumos de contas e cartões', () => {
    it('Regra de negócio (Contas): contas fora do total em grupo próprio, só com o consolidado; a zerada esmaecida', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const cdb = await world.ok('accounts.create', { profileId: s.profileId, name: 'CDB', type: 'investment', considerBalance: false, openingBalance: 2100 });
        const wallet = await world.ok('accounts.create', { profileId: s.profileId, name: 'Carteira', type: 'checking' });
        const accounts = await world.ok('accounts.list', { profileId: s.profileId, period: PERIOD });
        const summary = overviewAccounts(accounts);

        expect(summary.outsideTotal).toEqual([{ accountId: cdb.id, name: 'CDB', detail: 'Investimentos', consolidated: 'R$ 2.100,00', projected: null, empty: false, disabled: false }]);
        expect(summary.inTotal.find((row) => row.accountId === wallet.id)).toMatchObject({ empty: true, projected: null });
        expect(summary.inTotal.find((row) => row.accountId === s.checkingId)?.projected).toMatch(/^R\$ /);
        expect(summary.total).toBe(formatTotal(accounts.total.consolidated.amount));
    });

    it('Regra de negócio (Fatura): a fatura do mês e, quando é outra, a próxima em aberto', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const accounts = (await world.ok('accounts.list', { profileId: s.profileId, period: PERIOD })).accounts;
        const next = await world.ok('overview.nextInvoices', { profileId: s.profileId });
        /**
         * @param period Mês de referência.
         * @return A linha do único cartão do cenário.
         */
        const rowOf = async (period: string): Promise<ReturnType<typeof overviewCardRows>[number] | undefined> =>
            overviewCardRows(await world.ok('creditCards.list', { profileId: s.profileId, period }), accounts, next)[0];

        expect((await rowOf('2026-09'))?.invoices).toEqual([
            { period: '2026-09', label: 'set · vence 10/09', status: { text: 'Paga', tone: 'ok' }, amount: 'R$ 120,00', next: false },
            { period: '2026-11', label: 'nov · vence 10/11', status: { text: 'Em aberto', tone: 'warn' }, amount: 'R$ 487,32', next: true },
        ]);
        // No mês da próxima fatura, ela aparece uma vez só.
        expect((await rowOf('2026-11'))?.invoices).toEqual([{ period: '2026-11', label: 'nov · vence 10/11', status: { text: 'Em aberto', tone: 'warn' }, amount: 'R$ 487,32', next: true }]);
        expect(await rowOf('2026-10')).toMatchObject({ name: 'Roxinho', payer: 'paga com Nubank' });
    });
});

describe('metas', () => {
    /**
     * Meta com o progresso, com os campos que o resumo lê e o resto neutro.
     *
     * @param overrides Campos que o caso fixa.
     * @return A meta.
     */
    function goal(overrides: Partial<GoalProgressResponse>): GoalProgressResponse {
        const brl = (amount: number): { readonly amount: number; readonly currency: string } => ({ amount, currency: 'BRL' });
        return {
            id: 'g',
            profileId: 'p',
            name: 'Reserva',
            funding: { kind: 'transactions' },
            value: brl(16000),
            targetDate: '2020-12-31',
            archived: false,
            saved: brl(7514.27),
            remaining: brl(8485.73),
            ratio: 0.47,
            reached: false,
            linkedCount: 3,
            pending: { count: 0, total: brl(0) },
            monthsLeft: 0,
            paceBase: { period: PERIOD, saved: brl(7514.27), kind: 'current' },
            requiredPerMonth: null,
            averagePerMonth: null,
            projectedGap: null,
            ...overrides,
        };
    }

    it('Regra de negócio (Metas): prazo encerrado sem atingir a meta é "Prazo vencido", sem ritmo', () => {
        expect(overviewGoalRow(goal({}))).toMatchObject({ overdue: true, pace: null, percentText: '47%', summary: 'R$ 7.514,27 de R$ 16.000,00 · prazo era 31/12/2020' });
    });

    it('Regra de negócio (Metas): com prazo pela frente, o ritmo necessário por mês', () => {
        const row = overviewGoalRow(goal({ targetDate: '2030-12-31', monthsLeft: 50, requiredPerMonth: { amount: 3600.66, currency: 'BRL' } }));
        expect(row).toMatchObject({ overdue: false, pace: 'Ritmo necessário ≈ R$ 3.600,66/mês', summary: 'R$ 7.514,27 de R$ 16.000,00 · até 31/12/2030' });
        expect(overviewGoalRow(goal({ reached: true })).overdue).toBe(false);
    });
});

describe('selo de atrasados e painel', () => {
    it('Regra de negócio (Visão geral): os atrasados contam e somam a pagar e a receber; a transferência interna só aparece', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const pending = await world.ok('overview.pending', { profileId: s.profileId });

        expect(pendingBadge(pending)).toEqual({ tone: 'warn', title: '2 atrasados', detail: 'R$ 2.300,00 a pagar', opens: true });
        const panel = pendingPanel(pending);
        expect(panel.overdue.map((row) => [row.name, row.date, row.when, row.where, row.value, row.tone, row.action?.label])).toEqual([
            ['Aluguel', '05/10/2026', 'há 10 dias', 'Nubank', '−R$ 2.300,00', 'out', 'Marcar como pago'],
            ['Aporte', '10/10/2026', 'há 5 dias', 'Nubank → Tesouro', '⇄ R$ 500,00', 'transfer', 'Marcar como pago'],
        ]);
        expect(panel.footer).toBe('Nada mais vence até 31/10.');
        const [first] = panel.overdue;
        expect(first === undefined ? '' : markedPaidMessage(first, pending.today)).toBe('Aluguel marcado como pago em 15/10/2026.');
    });

    it('sem atraso: selo verde, que ainda abre o painel quando há algo em aberto no mês', () => {
        const brl = (amount: number): { readonly amount: number; readonly currency: string } => ({ amount, currency: 'BRL' });
        const pending: OverviewPendingResponse = {
            today: '2026-10-27',
            until: '2026-10-31',
            overdue: [],
            overdueTotals: { toPay: brl(0), toReceive: brl(0) },
            upcoming: [
                { kind: 'transaction', id: 't', name: 'Distribuição', dueDate: '2026-10-29', direction: 'in', amount: brl(300), where: 'Empresa → Inter', canMarkPaid: false },
                { kind: 'invoice', id: 'i', creditCardId: 'c', period: '2026-10', name: 'Nubank', dueDate: '2026-10-27', direction: 'out', amount: brl(749.6), where: 'Inter' },
            ],
            upcomingTotals: { toPay: brl(749.6), toReceive: brl(300) },
        };

        expect(pendingBadge(pending)).toEqual({ tone: 'ok', title: 'Nada atrasado', detail: '2 em aberto até 31/10', opens: true });
        const panel = pendingPanel(pending);
        // A transferência de outro perfil não tem ação: quem a paga é a origem. A fatura leva à tela Cartões.
        expect(panel.upcoming.map((row) => [row.name, row.when, row.where, row.value, row.action])).toEqual([
            ['Distribuição', 'em 2 dias', 'Empresa → Inter', '+R$ 300,00', null],
            ['Fatura Nubank', 'vence hoje', 'out · paga com Inter', '−R$ 749,60', { kind: 'openInvoice', creditCardId: 'c', period: '2026-10', label: 'Abrir fatura' }],
        ]);
        expect(panel.footer).toBe('Até 31/10: R$ 749,60 a pagar · R$ 300,00 a receber.');
        expect(pendingBadge({ ...pending, upcoming: [] }).opens).toBe(false);
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
