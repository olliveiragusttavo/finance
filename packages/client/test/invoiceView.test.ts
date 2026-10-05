import type { InvoiceCycleResponse, MoneyResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import {
    buildInvoiceTable,
    buildUpcomingInvoices,
    describeInvoicePayment,
    describeInvoiceReopening,
    describeLimitUsage,
    formatInvoiceAmount,
    formatInvoiceSituation,
    invoiceStage,
} from '../src/index.ts';
import { ClientWorld, type Scenario } from './support/ClientWorld.ts';

/*
 * Fatura do cartão na tela Cartões (desktop-mvp-plan Fase 8), sobre o núcleo de verdade: o
 * Roxinho do cenário fecha dia 3 e vence dia 10, a fatura de setembro foi paga em 02/10 e o
 * Supermercado de 06/10 caiu na de novembro.
 */

/**
 * Acrescenta à fatura de outubro uma compra, um estorno e um pagamento parcial da Nubank.
 *
 * @param world Núcleo do teste.
 * @param s Ids do cenário.
 * @return O id da fatura de outubro.
 */
async function withOctoberInvoice(world: ClientWorld, s: Scenario): Promise<string> {
    const base = { profileId: s.profileId, subCategoryId: s.subCategoryId } as const;
    const card = { kind: 'creditCard', creditCardId: s.creditCardId } as const;
    const purchase = await world.ok('transactions.create', { ...base, type: 'expense', source: card, name: 'Farmácia', value: 200, dueDate: '2026-09-10' });
    await world.ok('transactions.create', { ...base, type: 'expense', source: { ...card, invoicePeriod: '2026-10' }, name: 'Estorno farmácia', value: -20, dueDate: '2026-09-15' });
    await world.ok('transactions.create', {
        ...base,
        type: 'transference',
        source: { ...card, invoicePeriod: '2026-10' },
        destinationAccountId: s.checkingId,
        name: 'Pagamento parcial',
        value: -50,
        dueDate: '2026-10-08',
        paymentDate: '2026-10-08',
    });
    if (purchase.container.kind !== 'invoice') {
        throw new Error('a compra não caiu numa fatura');
    }
    return purchase.container.invoiceId;
}

describe('situação da fatura do mês (lista de cartões)', () => {
    it('em aberto com o vencimento, paga com o dia e mês sem fatura', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        /**
         * @param period Mês da lista de cartões.
         * @return A fatura do mês do único cartão do cenário.
         * @throws {Error} Quando o cartão some da lista — erro de montagem do cenário.
         */
        const cycleOf = async (period: string): Promise<InvoiceCycleResponse> => {
            const list = await world.ok('creditCards.list', { profileId: s.profileId, period });
            const card = list.creditCards[0];
            if (card === undefined) {
                throw new Error('cartão ausente');
            }
            return card.invoiceOfMonth;
        };

        const november = await cycleOf('2026-11');
        expect(formatInvoiceSituation(november)).toBe('Em aberto · vence 10/11');
        expect(formatInvoiceAmount(november)).toBe('R$ 487,32');
        const september = await cycleOf('2026-09');
        expect(formatInvoiceSituation(september)).toBe('Paga em 02/10');
        const december = await cycleOf('2026-12');
        expect(formatInvoiceSituation(december)).toBe('Sem lançamentos · vence 10/12');
        expect(formatInvoiceAmount(december)).toBe('—');
    });

    it('fatura paga sem o dia gravado mostra o mês do extrato, sem inventar o dia', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const list = await world.ok('creditCards.list', { profileId: s.profileId, period: '2026-09' });
        const cycle = list.creditCards[0]?.invoiceOfMonth;
        if (cycle?.invoice == null) {
            throw new Error('fatura de setembro ausente');
        }
        expect(formatInvoiceSituation({ ...cycle, invoice: { ...cycle.invoice, paymentDate: null } })).toBe('Paga no extrato de out');
    });
});

describe('lançamentos da fatura', () => {
    it('compra positiva, estorno e pagamento parcial negativos, e o total fecha com o valor a pagar', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const invoiceId = await withOctoberInvoice(world, s);
        const [invoice, accounts, categories] = await Promise.all([
            world.ok('invoices.get', { invoiceId }),
            world.ok('accounts.list', { profileId: s.profileId, period: '2026-10' }),
            world.ok('categories.tree', { profileId: s.profileId }),
        ]);
        const table = buildInvoiceTable({ invoice, accounts: accounts.accounts, categories });

        expect(table.lines.map((line) => [line.date, line.name, line.detail, line.category, line.kind, line.amountText])).toEqual([
            ['10/09', 'Farmácia', null, 'Alimentação › Mercado', 'purchase', 'R$ 200,00'],
            ['15/09', 'Estorno farmácia', null, 'Alimentação › Mercado', 'refund', '−R$ 20,00'],
            ['08/10', 'Pagamento parcial', 'de Nubank', 'Alimentação › Mercado', 'payment', '⇄ −R$ 50,00'],
        ]);
        expect(table.totalText).toBe('R$ 130,00');
        expect(invoice.amountDue).toEqual({ amount: 130, currency: 'BRL' });
    });
});

describe('próximas faturas', () => {
    it('distingue a que recebe as compras de hoje ("aberta") das futuras', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        await withOctoberInvoice(world, s);
        // Parcela posta à mão em dezembro: a fatura existe antes de receber compras.
        await world.ok('transactions.create', {
            profileId: s.profileId, subCategoryId: s.subCategoryId, type: 'expense', source: { kind: 'creditCard', creditCardId: s.creditCardId, invoicePeriod: '2026-12' }, name: 'Notebook', value: 400, dueDate: '2026-10-07',
        });
        const cycles = await world.ok('invoices.listByCard', { creditCardId: s.creditCardId, from: '2026-10' });

        expect(buildUpcomingInvoices(cycles, 3, '2026-10-15').map((row) => [row.period, row.label, row.amountText])).toEqual([
            ['2026-11', 'nov/2026 · aberta', 'R$ 487,32'],
            ['2026-12', 'dez/2026 · futura', 'R$ 400,00'],
        ]);
        // No dia do fechamento a compra já cai na seguinte: novembro fechou.
        expect(buildUpcomingInvoices(cycles, 3, '2026-11-03').map((row) => row.label)).toEqual(['nov/2026 · fechada · vence 10/11', 'dez/2026 · aberta']);
    });

    it('a fase usa o fechamento anterior com o ajuste de fim de mês', () => {
        // Fecha dia 31: a fatura de março recebe compras a partir de 28/02 (ano comum).
        const march: InvoiceCycleResponse = { period: '2027-03', closingDate: '2027-03-31', dueDate: '2027-04-10', invoice: null };
        expect(invoiceStage(march, 31, '2027-02-27')).toBe('future');
        expect(invoiceStage(march, 31, '2027-02-28')).toBe('receiving');
        expect(invoiceStage(march, 31, '2027-03-31')).toBe('closed');
    });

    it('mês sem fatura depois do aberto não aparece', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const cycles = await world.ok('invoices.listByCard', { creditCardId: s.creditCardId, from: '2026-11' });
        expect(buildUpcomingInvoices(cycles, 3, '2026-10-15')).toEqual([]);
    });
});

describe('limite usado', () => {
    it('percentual sem casas, barra limitada a 100% e cartão sem limite com traço', () => {
        /**
         * @param amount Valor.
         * @return Dinheiro em BRL como vem do núcleo.
         */
        const brl = (amount: number): MoneyResponse => ({ amount, currency: 'BRL' });
        expect(describeLimitUsage({ limit: brl(8000), limitUsed: brl(2449.75) })).toEqual({ percentText: '31%', share: 2449.75 / 8000, exceeded: false, limitText: 'de R$ 8.000,00' });
        expect(describeLimitUsage({ limit: brl(1000), limitUsed: brl(1500) })).toEqual(expect.objectContaining({ percentText: '150%', share: 1, exceeded: true }));
        expect(describeLimitUsage({ limit: brl(0), limitUsed: brl(10) })).toEqual({ percentText: '—', share: null, exceeded: true, limitText: 'de R$ 0,00' });
    });
});

describe('frases de pagar e reabrir', () => {
    it('o saldo depois do pagamento é o consolidado do fim do mês mais o balance da fatura', () => {
        const preview = describeInvoicePayment({
            invoice: { balance: { amount: -2449.75, currency: 'BRL' } },
            accountName: 'Nubank',
            paymentDate: '2026-10-10',
            closingConsolidated: { amount: 4320.15, currency: 'BRL' },
        });
        expect(preview).toEqual({
            statement: 'A fatura vira paga no extrato de out/2026 da conta Nubank.',
            balanceChange: 'Saldo consolidado de Nubank no fim de out/2026: R$ 4.320,15 → R$ 1.870,40',
        });
        expect(describeInvoicePayment({ invoice: { balance: { amount: -1, currency: 'BRL' } }, accountName: 'Nubank', paymentDate: '2026-10-10', closingConsolidated: null }).balanceChange).toBeNull();
    });

    it('reabrir diz de onde o pagamento sai e quando a fatura volta a pesar', () => {
        expect(describeInvoiceReopening({ invoice: { balance: { amount: -612.3, currency: 'BRL' }, paidInPeriod: '2026-10' }, accountName: 'Itaú', dueDate: '2026-10-10' })).toBe(
            'O pagamento de R$ 612,30 sai do extrato de out/2026 da conta Itaú, e o saldo dela volta como se ele não tivesse acontecido. ' +
                'A fatura volta a pesar só no saldo previsto de out/2026, no vencimento (10/10).',
        );
    });
});
