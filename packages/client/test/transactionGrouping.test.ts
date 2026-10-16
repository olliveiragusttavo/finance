import { describe, expect, it } from 'vitest';
import { buildTransactionTable, NO_TRANSACTION_FILTERS, type TransactionTableSource } from '../src/index.ts';
import { ClientWorld, type Scenario } from './support/ClientWorld.ts';

/**
 * Lê do núcleo de verdade o que a tela de Transações tem em cache em outubro, com as faturas do
 * mês que agrupam as compras do cartão.
 *
 * @param world Núcleo do teste.
 * @param s Ids do cenário.
 * @return A fonte da tabela de outubro.
 */
async function groupedSource(world: ClientWorld, s: Scenario): Promise<TransactionTableSource> {
    const [transactions, accounts, creditCards, categories, monthInvoices] = await Promise.all([
        world.ok('transactions.listByPeriod', { profileId: s.profileId, period: '2026-10' }),
        world.ok('accounts.list', { profileId: s.profileId, period: '2026-10' }),
        world.ok('creditCards.list', { profileId: s.profileId, period: '2026-10' }),
        world.ok('categories.tree', { profileId: s.profileId }),
        world.ok('statements.profileInvoices', { profileId: s.profileId, period: '2026-10' }),
    ]);
    return { profileId: s.profileId, transactions, accounts: accounts.accounts, creditCards: creditCards.creditCards, categories, invoices: [], monthInvoices };
}

/**
 * Acrescenta ao cenário a fatura de outubro do Roxinho (fecha 3, vence 10/10, em aberto): uma
 * compra de setembro e um pagamento parcial que sai da Nubank em 08/10.
 *
 * @param world Núcleo do teste.
 * @param s Ids do cenário.
 */
async function withOctoberInvoice(world: ClientWorld, s: Scenario): Promise<void> {
    const base = { profileId: s.profileId, subCategoryId: s.subCategoryId } as const;
    await world.ok('transactions.create', { ...base, type: 'expense', source: { kind: 'creditCard', creditCardId: s.creditCardId }, name: 'Farmácia', value: 200, dueDate: '2026-09-20' });
    await world.ok('transactions.create', {
        ...base,
        type: 'transference',
        source: { kind: 'creditCard', creditCardId: s.creditCardId, invoicePeriod: '2026-10' },
        destinationAccountId: s.checkingId,
        name: 'Pagamento parcial',
        value: -50,
        dueDate: '2026-10-08',
        paymentDate: '2026-10-08',
    });
}

describe('Transações agrupadas por fatura (desktop-mvp-plan Fase 11.1)', () => {
    it('Regra de negócio (Transações): sem filtro, a compra no cartão some e a fatura entra no dia do pagamento', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const table = buildTransactionTable(await groupedSource(world, s), NO_TRANSACTION_FILTERS);

        expect(table.grouped).toBe(true);
        // O Supermercado de 06/10 está na fatura de novembro: some da lista. A fatura de setembro,
        // paga em 02/10, entra no dia do pagamento, na conta que a paga.
        expect(table.rows.map((row) => [row.kind, row.date, row.name, row.category, row.container, row.amountText, row.situationText])).toEqual([
            ['transaction', '01/10', 'Salário', 'Alimentação › Mercado', 'Nubank', '+R$ 9.500,00', 'Pago'],
            ['invoice', '02/10', 'Fatura Roxinho · set', 'Fatura do cartão', 'Nubank', '−R$ 120,00', 'Paga'],
            ['transaction', '05/10', 'Aluguel', 'Alimentação › Mercado', 'Nubank', '−R$ 2.300,00', 'Pendente'],
            ['transaction', '10/10', 'Aporte', 'Alimentação › Mercado', 'Nubank → Tesouro', '⇄ R$ 500,00', 'Pendente'],
        ]);
        const invoice = table.rows.find((row) => row.kind === 'invoice');
        expect(invoice?.kind === 'invoice' ? invoice.invoice : null).toEqual({ id: s.paidInvoiceId, creditCardId: s.creditCardId, period: '2026-09' });
        // O resultado é o que saiu das contas: a fatura no lugar das compras.
        // As faturas contam à parte: a linha da fatura representa várias compras.
        expect(table.summary).toBe('3 lançamentos · 1 fatura · resultado +R$ 7.080,00');
    });

    it('a fatura em aberto entra no vencimento, líquida do pagamento parcial, que aparece como saída da conta e conta no resultado', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        await withOctoberInvoice(world, s);
        const table = buildTransactionTable(await groupedSource(world, s), NO_TRANSACTION_FILTERS);

        expect(table.rows.filter((row) => row.name.startsWith('Fatura') || row.name === 'Pagamento parcial').map((row) => [row.date, row.name, row.amountText, row.situationText])).toEqual([
            ['02/10', 'Fatura Roxinho · set', '−R$ 120,00', 'Paga'],
            ['08/10', 'Pagamento parcial', '⇄ −R$ 50,00', 'Pago'],
            ['10/10', 'Fatura Roxinho · out', '−R$ 150,00', 'Em aberto'],
        ]);
        // 9.500 − 2.300 − 120 − 50 do parcial − 150 que falta da fatura: o parcial não some do caixa.
        expect(table.summary).toBe('4 lançamentos · 2 faturas · resultado +R$ 6.880,00');
        // O resultado é a soma do que a tabela mostra com sinal: nenhuma linha neutra entra nele.
        const signed = table.rows.filter((row) => row.direction !== 'transfer').reduce((sum, row) => sum + Math.round(row.amount.amount * 100), 0);
        expect(signed / 100).toBe(table.result?.amount);
    });

    it('a fatura zerada por um estorno fica neutra, sem sinal nem cor de entrada', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const base = { profileId: s.profileId, subCategoryId: s.subCategoryId, type: 'expense', source: { kind: 'creditCard', creditCardId: s.creditCardId } } as const;
        await world.ok('transactions.create', { ...base, name: 'Farmácia', value: 50, dueDate: '2026-09-20' });
        await world.ok('transactions.create', { ...base, name: 'Estorno Farmácia', value: -50, dueDate: '2026-09-21' });
        const table = buildTransactionTable(await groupedSource(world, s), NO_TRANSACTION_FILTERS);

        const zeroed = table.rows.find((row) => row.name === 'Fatura Roxinho · out');
        expect([zeroed?.amountText, zeroed?.direction]).toEqual(['R$ 0,00', 'none']);
    });

    it('a compra de um cartão sem conta pagadora entre as contas do perfil não some na tabela agrupada', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        await withOctoberInvoice(world, s);
        const source = await groupedSource(world, s);
        // Sem a conta pagadora (excluída, por exemplo), o núcleo não lista as faturas do cartão.
        const orphan = buildTransactionTable({
            ...source,
            accounts: source.accounts.filter((account) => account.id !== s.checkingId),
            monthInvoices: (source.monthInvoices ?? []).filter((invoice) => invoice.accountId !== s.checkingId),
        }, NO_TRANSACTION_FILTERS);

        expect(orphan.grouped).toBe(true);
        expect(orphan.rows.some((row) => row.kind === 'invoice')).toBe(false);
        expect(orphan.rows.map((row) => row.name)).toContain('Supermercado');
    });

    it('com qualquer filtro, as compras voltam uma a uma e as faturas saem', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        await withOctoberInvoice(world, s);
        const source = await groupedSource(world, s);

        const searched = buildTransactionTable(source, { ...NO_TRANSACTION_FILTERS, search: 'supermercado' });
        expect(searched.grouped).toBe(false);
        expect(searched.rows.map((row) => [row.kind, row.name, row.container])).toEqual([['transaction', 'Supermercado', 'Roxinho · fat. nov']]);

        const byCategory = buildTransactionTable(source, { ...NO_TRANSACTION_FILTERS, category: { kind: 'subCategory', subCategoryId: s.subCategoryId } });
        expect(byCategory.rows.some((row) => row.kind === 'invoice')).toBe(false);
        expect(byCategory.rows.map((row) => row.name)).toContain('Supermercado');
        // Sem agrupar, as compras contam no resultado e o parcial é transferência: nada em dobro.
        const byCard = buildTransactionTable(source, { ...NO_TRANSACTION_FILTERS, container: { kind: 'creditCard', creditCardId: s.creditCardId } });
        expect(byCard.rows.map((row) => [row.name, row.situationText])).toEqual([['Supermercado', 'Na fatura'], ['Pagamento parcial', 'Pago']]);
        expect(byCard.summary).toBe('2 lançamentos · resultado −R$ 487,32');
    });

    it('sem as faturas do mês na fonte, a tabela não agrupa', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const source = await groupedSource(world, s);
        const { profileId, transactions, accounts, creditCards, categories, invoices } = source;
        const table = buildTransactionTable({ profileId, transactions, accounts, creditCards, categories, invoices }, NO_TRANSACTION_FILTERS);
        expect(table.grouped).toBe(false);
        expect(table.rows.map((row) => row.name)).toContain('Supermercado');
    });
});
