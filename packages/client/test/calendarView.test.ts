import { describe, expect, it } from 'vitest';
import { buildCalendarView, buildTransactionTable, formatMoney, NO_TRANSACTION_FILTERS, type CalendarDay, type CalendarView } from '../src/index.ts';
import { ClientWorld, type Scenario } from './support/ClientWorld.ts';

/**
 * Monta o calendário como a tela monta: a tabela agrupada de Transações e os extratos das contas
 * que entram no saldo, para que o teste exercite o mesmo caminho dos dados reais.
 *
 * @param world Núcleo do teste, com "hoje" em 15/10/2026.
 * @param s Ids do cenário.
 * @param period Mês do calendário.
 * @return O calendário e o total de Contas do mês, para comparar o fechamento.
 */
async function calendarOf(world: ClientWorld, s: Scenario, period: string): Promise<{ readonly view: CalendarView; readonly projectedClosing: string }> {
    const [transactions, accounts, creditCards, categories, monthInvoices] = await Promise.all([
        world.ok('transactions.listByPeriod', { profileId: s.profileId, period }),
        world.ok('accounts.list', { profileId: s.profileId, period }),
        world.ok('creditCards.list', { profileId: s.profileId, period }),
        world.ok('categories.tree', { profileId: s.profileId }),
        world.ok('statements.profileInvoices', { profileId: s.profileId, period }),
    ]);
    const statements = await Promise.all(
        accounts.accounts.filter((account) => account.considerBalance).map((account) => world.ok('statements.get', { accountId: account.id, period })),
    );
    const table = buildTransactionTable(
        { profileId: s.profileId, transactions, accounts: accounts.accounts, creditCards: creditCards.creditCards, categories, invoices: [], monthInvoices },
        NO_TRANSACTION_FILTERS,
    );
    const view = buildCalendarView({ period, today: '2026-10-15', profileId: s.profileId, currency: 'BRL', rows: table.rows, statements });
    return { view, projectedClosing: formatMoney(accounts.total.projected) };
}

/**
 * @param view Calendário.
 * @param day Dia do mês.
 * @return O dia pedido.
 * @throws {Error} Quando o dia não existe no mês — erro do próprio teste.
 */
function dayOf(view: CalendarView, day: number): CalendarDay {
    const found = view.days.find((candidate) => candidate.day === day);
    if (found === undefined) {
        throw new Error(`o mês não tem o dia ${String(day)}`);
    }
    return found;
}

describe('calendário do mês (mockup DesktopCalendario)', () => {
    it('monta a grade começando no domingo, com hoje marcado', async () => {
        const world = new ClientWorld();
        const { view } = await calendarOf(world, await world.seed(), '2026-10');

        // 01/10/2026 é uma quinta-feira: quatro casas vazias (dom a qua), e 4 + 31 fecham 5 semanas.
        expect(view.leadingBlanks).toBe(4);
        expect(view.trailingBlanks).toBe(0);
        expect(view.days).toHaveLength(31);
        expect(view.days.filter((day) => day.today).map((day) => day.day)).toEqual([15]);
        expect(dayOf(view, 1).weekday).toBe('Quinta-feira');
        expect(dayOf(view, 1).title).toBe('1 de outubro de 2026');
    });

    it('Regra de negócio (Calendário): lançamento no dia do vencimento; em aberto antes de hoje é atrasado', async () => {
        const world = new ClientWorld();
        const { view } = await calendarOf(world, await world.seed(), '2026-10');

        expect(dayOf(view, 1).lines).toEqual([{ key: 'in|paid', direction: 'in', state: 'paid', amountText: '+R$ 9.500,00', name: 'Salário' }]);
        // A fatura de setembro, paga em 02/10, entra pela linha da fatura, no dia em que pesou na conta.
        expect(dayOf(view, 2).lines).toEqual([{ key: 'out|paid', direction: 'out', state: 'paid', amountText: '−R$ 120,00', name: 'Fatura Roxinho · set' }]);
        const rent = dayOf(view, 5);
        expect(rent.lines).toEqual([{ key: 'out|overdue', direction: 'out', state: 'overdue', amountText: '⚠ −R$ 2.300,00', name: 'Aluguel' }]);
        expect(rent.overdueCount).toBe(1);
        expect(rent.accessibleName).toBe('5 de outubro de 2026, 1 lançamento, 1 atrasado');
        expect(rent.entries.map((entry) => [entry.stateText, entry.action?.label ?? null])).toEqual([['Atrasado', 'Marcar pago']]);
        expect(rent.result).toEqual({ text: '−R$ 2.300,00', tone: 'out' });
    });

    it('Regra de negócio (Calendário): a transferência dentro do perfil fica no painel do dia, mas fora de receitas × despesas', async () => {
        const world = new ClientWorld();
        const { view } = await calendarOf(world, await world.seed(), '2026-10');
        const transfer = dayOf(view, 10);

        expect(transfer.entries.map((entry) => [entry.movement.name, entry.direction])).toEqual([['Aporte', 'transfer']]);
        expect(transfer.lines).toEqual([]);
        expect(transfer.result).toBeNull();
        // Transferência não entra no total de atrasados, que é o que falta pagar ou receber.
        expect(view.summary.overdue).toEqual({ label: 'Atrasados', value: '1 · −R$ 2.300,00', sub: 'Venceram e não foram pagos', alert: true });
    });

    it('Regra de negócio (Calendário, saldo do dia): consolidado até hoje, só nos dias com movimento', async () => {
        const world = new ClientWorld();
        const { view } = await calendarOf(world, await world.seed(), '2026-10');

        expect(dayOf(view, 1).balance).toEqual({ value: 'R$ 10.500,00', negative: false, projected: false, detail: '+R$ 9.500,00 no dia' });
        expect(dayOf(view, 2).balance).toEqual({ value: 'R$ 10.380,00', negative: false, projected: false, detail: '−R$ 120,00 no dia' });
        // O aluguel em aberto não muda o consolidado.
        expect(dayOf(view, 5).balance).toEqual({ value: 'R$ 10.380,00', negative: false, projected: false, detail: 'sem mudança no consolidado' });
        expect(dayOf(view, 3).balance).toBeNull();
        expect(view.summary.balance.label).toBe('Saldo consolidado hoje');
        expect(view.summary.balance.value).toBe('R$ 10.380,00');
    });

    it('Regra de negócio (Calendário, saldo do dia): o previsto do último dia bate com o fechamento de Contas', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const { view, projectedClosing } = await calendarOf(world, s, '2026-11');

        expect(view.summary.balance).toEqual({ label: 'Saldo previsto no fim do mês', value: projectedClosing, sub: 'Se tudo for pago no vencimento' });
        // A fatura de novembro do Roxinho, com a compra de 06/10, vence em 10/11: a vencer, e paga-se em Cartões.
        const invoice = dayOf(view, 10);
        expect(invoice.lines.map((line) => [line.state, line.amountText, line.name])).toEqual([['upcoming', '−R$ 487,32', 'Fatura Roxinho · nov']]);
        expect(invoice.entries[0]?.action).toMatchObject({ kind: 'openInvoice', label: 'Abrir fatura' });
        expect(invoice.balance).toMatchObject({ projected: true, detail: 'previsto' });
    });

    it('resume receitas e despesas pagas e a pagar do mês', async () => {
        const world = new ClientWorld();
        const { view } = await calendarOf(world, await world.seed(), '2026-10');

        expect(view.summary.income).toEqual({ label: 'Receitas no mês', value: 'R$ 9.500,00', sub: 'R$ 9.500,00 recebido · R$ 0,00 a receber' });
        expect(view.summary.expenses).toEqual({ label: 'Despesas no mês', value: 'R$ 2.420,00', sub: 'R$ 120,00 pago · R$ 2.300,00 a pagar' });
    });
});
