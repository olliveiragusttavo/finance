import { describe, expect, it } from 'vitest';
import {
    buildInvoiceTable,
    buildStatementTable,
    buildTransactionTable,
    compareMovementRows,
    movementPermissions,
    movementsFromInvoice,
    movementsFromStatement,
    movementsFromTransactions,
    NO_TRANSACTION_FILTERS,
    overviewNotes,
    type MovementRow,
} from '../src/index.ts';
import { ClientWorld, type Scenario } from './support/ClientWorld.ts';

/**
 * @param rows Linhas da listagem.
 * @return Nome, alvo, situação e se paga pelo clique, para comparar de uma vez.
 */
function summary(rows: readonly MovementRow[]): readonly (readonly unknown[])[] {
    return rows.map((row) => [row.name, row.target.kind, row.situation?.text ?? null, row.target.kind === 'transaction' && row.target.payable]);
}

/**
 * @param world Núcleo do teste.
 * @param s Ids do cenário.
 * @return As linhas do extrato de outubro da Nubank na listagem comum.
 */
async function statementMovements(world: ClientWorld, s: Scenario): Promise<readonly MovementRow[]> {
    const [statement, accounts, creditCards, categories] = await Promise.all([
        world.ok('statements.get', { accountId: s.checkingId, period: '2026-10' }),
        world.ok('accounts.list', { profileId: s.profileId, period: '2026-10' }),
        world.ok('creditCards.list', { profileId: s.profileId, period: '2026-10' }),
        world.ok('categories.tree', { profileId: s.profileId }),
    ]);
    const table = buildStatementTable({ statement, accounts: accounts.accounts, creditCards: creditCards.creditCards, categories });
    return movementsFromStatement(table, statement, { profileId: s.profileId, recurrences: [] });
}

describe('listagem única de movimentos (desktop-mvp-plan Fase 13.2)', () => {
    it('o extrato vira linhas editáveis: lançamentos pagam pelo clique, a fatura abre a fatura', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const rows = await statementMovements(world, s);

        expect(summary(rows)).toEqual([
            ['Salário', 'transaction', 'Pago', true],
            ['Fatura Roxinho · set', 'invoice', 'Paga', false],
            ['Aluguel', 'transaction', 'Pendente', true],
            ['Aporte', 'transaction', 'Pendente', true],
        ]);
        const invoice = rows[1];
        expect(invoice?.muted).toBe(true);
        expect(invoice?.target).toEqual({ kind: 'invoice', creditCardId: s.creditCardId, period: '2026-09' });
        // O pendente é o que ainda vai sair da conta: em destaque, como em Transações.
        expect(rows[2]?.situation?.tone).toBe('warn');
        const rent = rows[2]?.target;
        expect(rent?.kind === 'transaction' && rent.container).toBe('Nubank');
    });

    it('Regra de negócio (Cartão): na fatura, a compra não paga pelo clique, o pagamento parcial sim, e a parcela mostra "1/3"', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const base = { profileId: s.profileId, subCategoryId: s.subCategoryId } as const;
        await world.ok('transactions.create', {
            ...base,
            type: 'expense',
            source: { kind: 'creditCard', creditCardId: s.creditCardId, invoicePeriod: '2026-11' },
            name: 'Fone',
            value: 300,
            dueDate: '2026-10-07',
            repeat: { kind: 'installments', frequency: 'monthly', installments: 3, valueType: 'total' },
        });
        await world.ok('transactions.create', {
            ...base,
            type: 'transference',
            source: { kind: 'creditCard', creditCardId: s.creditCardId, invoicePeriod: '2026-11' },
            destinationAccountId: s.checkingId,
            name: 'Pagamento parcial',
            value: -50,
            dueDate: '2026-10-20',
            paymentDate: '2026-10-20',
        });
        const cycles = await world.ok('invoices.listByCard', { creditCardId: s.creditCardId, from: '2026-11' });
        const invoiceId = cycles[0]?.invoice?.id ?? '';
        const [invoice, accounts, categories, recurrences] = await Promise.all([
            world.ok('invoices.get', { invoiceId }),
            world.ok('accounts.list', { profileId: s.profileId, period: '2026-10' }),
            world.ok('categories.tree', { profileId: s.profileId }),
            world.ok('recurrences.list', { profileId: s.profileId }),
        ]);
        const rows = movementsFromInvoice(buildInvoiceTable({ invoice, accounts: accounts.accounts, categories }), invoice, { profileId: s.profileId, recurrences });

        expect(rows.map((row) => [row.name, row.badges, row.recurrenceTag, row.target.kind === 'transaction' && row.target.payable, row.situation])).toEqual([
            ['Supermercado', [], null, false, null],
            ['Fone', [], '1/3', false, null],
            ['Pagamento parcial', ['pagamento parcial'], null, true, null],
        ]);
        const fone = rows[1]?.target;
        expect(fone?.kind === 'transaction' && fone.container).toBe('Roxinho · fat. nov');
    });

    it('Transações agrupadas: a linha da fatura abre a fatura e a situação dela ordena junto das compras', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const [transactions, accounts, creditCards, categories, monthInvoices] = await Promise.all([
            world.ok('transactions.listByPeriod', { profileId: s.profileId, period: '2026-10' }),
            world.ok('accounts.list', { profileId: s.profileId, period: '2026-10' }),
            world.ok('creditCards.list', { profileId: s.profileId, period: '2026-10' }),
            world.ok('categories.tree', { profileId: s.profileId }),
            world.ok('statements.profileInvoices', { profileId: s.profileId, period: '2026-10' }),
        ]);
        const table = buildTransactionTable({ profileId: s.profileId, transactions, accounts: accounts.accounts, creditCards: creditCards.creditCards, categories, invoices: [], monthInvoices }, NO_TRANSACTION_FILTERS);
        const rows = movementsFromTransactions(table.rows, s.profileId);

        expect(summary(rows)).toEqual([
            ['Salário', 'transaction', 'Pago', true],
            ['Fatura Roxinho · set', 'invoice', 'Paga', false],
            ['Aluguel', 'transaction', 'Pendente', true],
            ['Aporte', 'transaction', 'Pendente', true],
        ]);
        const bySituation = [...rows].sort(compareMovementRows('situation')).map((row) => row.name);
        expect(bySituation).toEqual(['Aluguel', 'Aporte', 'Salário', 'Fatura Roxinho · set']);
        const byAmount = [...rows].sort(compareMovementRows('amount')).map((row) => row.name);
        expect(byAmount).toEqual(['Aluguel', 'Aporte', 'Fatura Roxinho · set', 'Salário']);
    });

    it('Regra de negócio (Transferência entre perfis): a transferência recebida de outro perfil é só leitura', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const salary = await world.ok('transactions.get', { id: s.incomeId });

        expect(movementPermissions(salary, s.profileId)).toEqual({ readOnly: false, payable: true });
        expect(movementPermissions(salary, 'outro-perfil')).toEqual({ readOnly: true, payable: false });
    });
});

describe('anotações da Visão geral (desktop-mvp-plan Fase 13.2)', () => {
    it('mostra só o título das mais recentes e conta as que ficaram de fora', () => {
        const notes = ['IPTU 2027\nparcelar em 10x', 'Senha do wi-fi', 'Lista de compras'].map((text, index) => ({ id: `n${String(index)}`, profileId: 'p', text }));

        expect(overviewNotes(notes, 2)).toEqual({
            rows: [
                { noteId: 'n0', title: 'IPTU 2027' },
                { noteId: 'n1', title: 'Senha do wi-fi' },
            ],
            hiddenCount: 1,
        });
        expect(overviewNotes(notes).hiddenCount).toBe(0);
    });
});
