import { describe, expect, it } from 'vitest';
import {
    buildStatementTable,
    buildTransactionTable,
    compareTransactionRows,
    NO_TRANSACTION_FILTERS,
    type StatementTableSource,
    type TransactionRow,
    type TransactionSortKey,
    type TransactionTable,
    type TransactionTableSource,
} from '../src/index.ts';
import { ClientWorld, type Scenario } from './support/ClientWorld.ts';

/**
 * As linhas de lançamento da tabela. Sem as faturas do mês na fonte, a tabela nunca agrupa, e
 * toda linha é um lançamento; o filtro só estreita o tipo para os campos próprios dele.
 *
 * @param table Tabela montada.
 * @return As linhas que são lançamentos.
 */
function transactionRowsOf(table: TransactionTable): readonly TransactionRow[] {
    return table.rows.flatMap((row) => (row.kind === 'transaction' ? [row] : []));
}

/**
 * Lê do núcleo de verdade tudo que a tela de Transações tem em cache.
 *
 * @param world Núcleo do teste.
 * @param s Ids do cenário.
 * @return A fonte da tabela de outubro.
 */
async function transactionSource(world: ClientWorld, s: Scenario): Promise<TransactionTableSource> {
    const [transactions, accounts, creditCards, categories, cycles] = await Promise.all([
        world.ok('transactions.listByPeriod', { profileId: s.profileId, period: '2026-10' }),
        world.ok('accounts.list', { profileId: s.profileId, period: '2026-10' }),
        world.ok('creditCards.list', { profileId: s.profileId, period: '2026-10' }),
        world.ok('categories.tree', { profileId: s.profileId }),
        world.ok('invoices.listByCard', { creditCardId: s.creditCardId, from: '2026-08' }),
    ]);
    return {
        profileId: s.profileId,
        transactions,
        accounts: accounts.accounts,
        creditCards: creditCards.creditCards,
        categories,
        invoices: cycles.flatMap((cycle) => (cycle.invoice === null ? [] : [cycle.invoice])),
    };
}

describe('tabela de Transações', () => {
    it('junta nomes, sinais e situação como no mockup, e soma o resultado sem transferências', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        await world.ok('transactions.create', {
            profileId: s.profileId, subCategoryId: s.otherSubCategoryId, type: 'expense', source: { kind: 'creditCard', creditCardId: s.creditCardId }, name: 'Estorno Uber', value: -23.9, dueDate: '2026-10-09',
        });
        const table = buildTransactionTable(await transactionSource(world, s), NO_TRANSACTION_FILTERS);

        expect(table.rows.map((row) => [row.date, row.name, row.category, row.container, row.amountText, row.situationText])).toEqual([
            ['01/10', 'Salário', 'Alimentação › Mercado', 'Nubank', '+R$ 9.500,00', 'Pago'],
            ['05/10', 'Aluguel', 'Alimentação › Mercado', 'Nubank', '−R$ 2.300,00', 'Pendente'],
            ['06/10', 'Supermercado', 'Alimentação › Mercado', 'Roxinho · fat. nov', '−R$ 487,32', 'Na fatura'],
            ['09/10', 'Estorno Uber', 'Alimentação › Restaurantes', 'Roxinho · fat. nov', '+R$ 23,90', 'Na fatura'],
            ['10/10', 'Aporte', 'Alimentação › Mercado', 'Nubank → Tesouro', '⇄ R$ 500,00', 'Pendente'],
        ]);
        expect(transactionRowsOf(table).find((row) => row.name === 'Estorno Uber')?.refund).toBe(true);
        expect(table.summary).toBe('5 lançamentos · resultado +R$ 6.736,58');
    });

    it('Regra de negócio (Transferência entre perfis): conta no resultado dos dois perfis e é só leitura no destino', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const { profile: business, account: itau } = await world.ok('onboarding.start', {
            profile: { name: 'Empresa', type: 'business', currency: 'BRL' },
            account: { name: 'Itaú', type: 'checking', openingBalance: 0 },
            suggestedCategories: false,
        });
        await world.ok('transactions.create', {
            profileId: s.profileId, subCategoryId: s.subCategoryId, type: 'transference', source: { kind: 'account', accountId: s.checkingId }, destinationAccountId: itau.id, name: 'Pró-labore', value: 500, charges: 8, dueDate: '2026-10-12',
        });

        const personal = buildTransactionTable(
            { ...(await transactionSource(world, s)), otherProfileAccounts: await world.ok('accounts.transferTargets', { profileId: s.profileId }) },
            NO_TRANSACTION_FILTERS,
        );
        const sent = transactionRowsOf(personal).find((row) => row.name === 'Pró-labore');
        expect([sent?.container, sent?.amountText, sent?.direction, sent?.readOnly]).toEqual(['Nubank → Itaú (Empresa)', '⇄ −R$ 508,00', 'out', false]);
        // 9.500 − 2.300 − 487,32 do cenário, menos os 508 que saíram do perfil.
        expect(personal.summary).toBe('5 lançamentos · resultado +R$ 6.204,68');

        const [transactions, accounts, otherProfileAccounts] = await Promise.all([
            world.ok('transactions.listByPeriod', { profileId: business.id, period: '2026-10' }),
            world.ok('accounts.list', { profileId: business.id, period: '2026-10' }),
            world.ok('accounts.transferTargets', { profileId: business.id }),
        ]);
        const received = buildTransactionTable(
            { profileId: business.id, transactions, accounts: accounts.accounts, otherProfileAccounts, creditCards: [], categories: [], invoices: [] },
            NO_TRANSACTION_FILTERS,
        );
        expect(transactionRowsOf(received).map((row) => [row.category, row.container, row.amountText, row.direction, row.readOnly])).toEqual([
            ['Transferência recebida', 'Nubank (Pessoal) → Itaú', '⇄ +R$ 500,00', 'in', true],
        ]);
        expect(received.summary).toBe('1 lançamento · resultado +R$ 500,00');
    });

    it('marca a compra de fatura paga como "Fat. paga"', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        await world.ok('invoices.pay', { invoiceId: s.openInvoiceId, paymentDate: '2026-11-09' });
        const table = buildTransactionTable(await transactionSource(world, s), NO_TRANSACTION_FILTERS);
        expect(table.rows.find((row) => row.name === 'Supermercado')?.situationText).toBe('Fat. paga');
    });

    it('filtra por conta (incluindo o que chega nela), cartão, categoria, situação e busca sem acento', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const source = await transactionSource(world, s);
        const names = (filters: Partial<typeof NO_TRANSACTION_FILTERS>): readonly string[] =>
            buildTransactionTable(source, { ...NO_TRANSACTION_FILTERS, ...filters }).rows.map((row) => row.name);

        expect(names({ container: { kind: 'account', accountId: s.savingsId } })).toEqual(['Aporte']);
        expect(names({ container: { kind: 'creditCard', creditCardId: s.creditCardId } })).toEqual(['Supermercado']);
        expect(names({ category: { kind: 'subCategory', subCategoryId: s.otherSubCategoryId } })).toEqual([]);
        expect(names({ category: { kind: 'category', categoryId: s.categoryId } })).toHaveLength(4);
        expect(names({ situation: 'pending' })).toEqual(['Aluguel', 'Aporte']);
        expect(names({ search: '  SALARIO ' })).toEqual(['Salário']);
        expect(buildTransactionTable(source, { ...NO_TRANSACTION_FILTERS, search: 'nada' }).summary).toBe('Nenhum lançamento');
    });

    it('filtra pela tag do lançamento', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const table = buildTransactionTable(await transactionSource(world, s), { ...NO_TRANSACTION_FILTERS, tagId: s.tagId });
        expect(table.rows.map((row) => row.name)).toEqual(['Supermercado']);
    });

    it('ordena por coluna sem diferenciar acentos, com empate pela data e pelo nome', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        await world.ok('transactions.create', {
            profileId: s.profileId, subCategoryId: s.subCategoryId, type: 'expense', source: { kind: 'account', accountId: s.checkingId }, name: 'Água', value: 80, dueDate: '2026-10-20',
        });
        const { rows } = buildTransactionTable(await transactionSource(world, s), NO_TRANSACTION_FILTERS);
        const sorted = (key: TransactionSortKey): readonly string[] => [...rows].sort(compareTransactionRows(key)).map((row) => row.name);

        expect(sorted('name')).toEqual(['Água', 'Aluguel', 'Aporte', 'Salário', 'Supermercado']);
        // Crescente pelo efeito com sinal: as maiores saídas primeiro.
        expect(sorted('amount')).toEqual(['Aluguel', 'Aporte', 'Supermercado', 'Água', 'Salário']);
        // Pendentes, depois na fatura, depois pagos; o empate segue a data.
        expect(sorted('situation')).toEqual(['Aluguel', 'Aporte', 'Água', 'Supermercado', 'Salário']);
        expect(sorted('container')).toEqual(['Salário', 'Aluguel', 'Água', 'Aporte', 'Supermercado']);
    });

    it('usa o singular com um lançamento', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        expect(buildTransactionTable(await transactionSource(world, s), { ...NO_TRANSACTION_FILTERS, search: 'aluguel' }).summary)
            .toBe('1 lançamento · resultado −R$ 2.300,00');
    });
});

/**
 * Lê do núcleo de verdade o extrato de outubro e os cadastros que dão nome às linhas.
 *
 * @param world Núcleo do teste.
 * @param s Ids do cenário.
 * @param accountId Conta do extrato.
 * @return A fonte da tabela de movimentos.
 */
async function statementSource(world: ClientWorld, s: Scenario, accountId: string): Promise<StatementTableSource> {
    const [statement, accounts, creditCards, categories] = await Promise.all([
        world.ok('statements.get', { accountId, period: '2026-10' }),
        world.ok('accounts.list', { profileId: s.profileId, period: '2026-10' }),
        world.ok('creditCards.list', { profileId: s.profileId, period: '2026-10' }),
        world.ok('categories.tree', { profileId: s.profileId }),
    ]);
    return { statement, accounts: accounts.accounts, creditCards: creditCards.creditCards, categories };
}

describe('extrato da conta', () => {
    /**
     * Acrescenta ao cenário a fatura de outubro do Roxinho (vence 10/10, em aberto) com um
     * pagamento parcial que sai da Nubank em 08/10.
     *
     * @param world Núcleo do teste.
     * @param s Ids do cenário.
     * @return void
     */
    async function withOctoberInvoice(world: ClientWorld, s: Scenario): Promise<void> {
        const base = { profileId: s.profileId, subCategoryId: s.subCategoryId } as const;
        await world.ok('transactions.create', { ...base, type: 'expense', source: { kind: 'creditCard', creditCardId: s.creditCardId }, name: 'Farmácia', value: 200, dueDate: '2026-09-10' });
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

    it('junta as quatro fontes por data de caixa, com o efeito nesta conta', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        await withOctoberInvoice(world, s);
        const table = buildStatementTable(await statementSource(world, s, s.checkingId));

        expect(table.rows.map((row) => [row.date, row.name, row.detail, row.category, row.situationText, row.amountText])).toEqual([
            ['01/10', 'Salário', null, 'Alimentação › Mercado', 'Pago', '+R$ 9.500,00'],
            ['02/10', 'Fatura Roxinho · set', null, 'Fatura do cartão', 'Paga', '−R$ 120,00'],
            ['05/10', 'Aluguel', null, 'Alimentação › Mercado', 'Pendente', '−R$ 2.300,00'],
            // Pagamento parcial: transferência negativa que chega — sai desta conta.
            ['08/10', 'Pagamento parcial', 'fatura Roxinho · out', 'Alimentação › Mercado', 'Pago', '⇄ −R$ 50,00'],
            ['10/10', 'Aporte', '→ Tesouro', 'Alimentação › Mercado', 'Pendente', '⇄ −R$ 500,00'],
            ['10/10', 'Fatura Roxinho · out', null, 'Fatura do cartão', 'Em aberto', '−R$ 150,00'],
        ]);
        expect(table.rows.find((row) => row.name === 'Fatura Roxinho · set')?.invoice).toEqual({ creditCardId: s.creditCardId, period: '2026-09' });
        expect(table.rows.find((row) => row.name === 'Pagamento parcial')?.invoice).toEqual({ creditCardId: s.creditCardId, period: '2026-10' });
        expect(table.hasOpenInvoices).toBe(true);
    });

    it('a transferência aparece como entrada no extrato do destino', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const table = buildStatementTable(await statementSource(world, s, s.savingsId));
        expect(table.rows.map((row) => [row.date, row.name, row.detail, row.amountText, row.direction])).toEqual([
            ['10/10', 'Aporte', 'de Nubank', '⇄ +R$ 500,00', 'transfer'],
        ]);
        expect(table.hasOpenInvoices).toBe(false);
    });

    it('fatura paga sem o dia gravado mostra "—" e vai para o fim do mês', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const source = await statementSource(world, s, s.checkingId);
        const statement = { ...source.statement, paidInvoices: source.statement.paidInvoices.map((invoice) => ({ ...invoice, paymentDate: null })) };
        const rows = buildStatementTable({ ...source, statement }).rows;
        expect(rows.at(-1)).toEqual(expect.objectContaining({ date: '—', name: 'Fatura Roxinho · set' }));
    });
});
