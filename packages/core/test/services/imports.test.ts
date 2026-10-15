import { describe, expect, it } from 'vitest';
import type { CoreInput } from '../../src/index.ts';
import { TestWorld } from '../support/TestWorld.ts';

type RunInput = CoreInput<'imports.run'>;
type RowInput = RunInput['rows'][number];

const OPTIONS: RunInput['options'] = { groupSeries: true, keepFutureOccurrences: true, hashtagsAsTags: true, pastDueAsPaid: false };
const TRANSFER_CATEGORY = { category: 'Transferências', subCategory: 'Entre contas' };

/**
 * Linha de despesa paga na conta "Banco", como o client envia; cada teste troca o que importa.
 *
 * @param line Linha no arquivo.
 * @param overrides Campos a trocar.
 * @return A linha.
 */
function row(line: number, overrides: Partial<RowInput> = {}): RowInput {
    return {
        line,
        type: 'expense',
        name: 'Mercado',
        value: 100,
        dueDate: '2026-03-10',
        paymentDate: '2026-03-10',
        account: 'Banco',
        category: 'Moradia',
        subCategory: 'Mercado',
        ...overrides,
    };
}

/**
 * Mundo com "hoje" em 15/10/2026, como o arquivo real, e um perfil.
 *
 * @return O mundo e o perfil.
 */
function setup(): { readonly world: TestWorld; readonly profileId: string } {
    const world = new TestWorld('2026-10-15');
    return { world, profileId: world.profile() };
}

/**
 * @param world Mundo do teste.
 * @param name Nome da conta.
 * @return O id da conta viva com esse nome.
 */
function accountId(world: TestWorld, name: string): string {
    const found = world.database.get('SELECT id FROM accounts WHERE name = :name AND deleted_at IS NULL', { name });
    return String(found?.['id']);
}

/**
 * @param world Mundo do teste.
 * @param sql Consulta de contagem com uma coluna `n`.
 * @return O número contado.
 */
function count(world: TestWorld, sql: string): number {
    return Number(world.database.get(sql)?.['n']);
}

describe('imports.run — cadastros, saldos e faturas', () => {
    it('cria o que falta, paga a fatura pela maior data de pagamento e deixa os saldos íntegros', async () => {
        const { world, profileId } = setup();
        const outcome = await world.ok('imports.run', {
            rows: [
                row(1),
                row(2, { type: 'income', name: 'Salário', value: 1000, dueDate: '2026-03-05', paymentDate: '2026-03-05', category: 'Renda', subCategory: 'Salário', description: 'mês cheio #bonus' }),
                row(3, { name: 'Livro', value: 50, creditCard: 'Inter', purchaseDate: '2026-03-02', dueDate: '2026-03-15', paymentDate: '2026-03-11' }),
                row(4, { name: 'Caneta', value: 10, creditCard: 'Inter', purchaseDate: '2026-02-25', dueDate: '2026-03-15', paymentDate: '2026-03-12' }),
                row(5, { name: 'Cinema', value: 30, creditCard: 'Inter', purchaseDate: '2026-03-20', dueDate: '2026-04-15', paymentDate: null }),
                row(6, { type: 'transference', name: 'Aplicação', value: 200, dueDate: '2026-03-20', paymentDate: '2026-03-20', destination: 'Corretora', category: null, subCategory: null }),
                row(7, { category: null }),
            ],
            options: OPTIONS,
            accounts: [
                { name: 'banco', profileId, target: { kind: 'create', type: 'checking', considerBalance: true } },
                { name: 'Corretora', profileId, target: { kind: 'create', type: 'investment', considerBalance: false } },
            ],
            creditCards: [{ name: 'Inter', target: { kind: 'create', payingAccount: 'Banco', closingDay: 8, dueDay: 15, limit: 5000 } }],
            transferCategory: TRANSFER_CATEGORY,
        });

        expect(outcome).toEqual({
            transactions: 6,
            fixedSeries: 0,
            installmentSeries: 0,
            invoicesPaid: 1,
            accountsCreated: 2,
            creditCardsCreated: 1,
            categoriesCreated: 3,
            subCategoriesCreated: 3,
            tagsCreated: 1,
            skipped: 1,
        });
        const card = String(world.database.get("SELECT id FROM credit_cards WHERE name = 'Inter'")?.['id']);
        // A compra de 25/02 vai para a fatura que vence em março, como o arquivo diz, e não para a
        // sugerida pela data; a fatura é paga na maior Efetivação das compras dela.
        expect(world.invoiceRow(card, '2026-03')).toMatchObject({ paidIn: '2026-03' });
        expect(world.invoiceRow(card, '2026-03')?.balance).toEqualMoney('-60');
        expect(world.database.get('SELECT payment_date AS d FROM invoices WHERE credit_card_id = :card AND month = 3', { card })?.['d']).toBe('2026-03-12');
        expect(world.invoiceRow(card, '2026-04')).toMatchObject({ paidIn: null });

        const bank = accountId(world, 'banco');
        expect(world.statementRow(bank, '2026-03')?.closing).toEqualMoney('640');
        expect(world.accountRow(bank).balance).toEqualMoney('640');
        expect(world.accountRow(bank).projected).toEqualMoney('610');
        expect(world.accountRow(accountId(world, 'Corretora')).balance).toEqualMoney('200');
        expect(world.database.get("SELECT t.name FROM tags t WHERE t.profile_id = :profileId", { profileId })?.['name']).toBe('bonus');
        expect((await world.ok('integrity.verifyBalances', {})).drifts).toEqual([]);
    });

    it('liga a conta, a categoria e o cartão existentes em vez de criar outros', async () => {
        const { world, profileId } = setup();
        const bank = world.account(profileId, { name: 'Conta antiga' });
        world.namedSubCategory(profileId, 'Moradia', 'Mercado');
        const card = world.creditCard(profileId, bank, 8, 15);
        const outcome = await world.ok('imports.run', {
            rows: [row(1, { category: 'MORADIA', subCategory: 'mercado' }), row(2, { creditCard: 'Cartão', dueDate: '2026-05-15', paymentDate: null })],
            options: OPTIONS,
            accounts: [{ name: 'Banco', profileId, target: { kind: 'link', accountId: bank } }],
            creditCards: [{ name: 'Cartão', target: { kind: 'link', creditCardId: card } }],
            transferCategory: TRANSFER_CATEGORY,
        });
        expect(outcome).toMatchObject({ accountsCreated: 0, creditCardsCreated: 0, categoriesCreated: 0, subCategoriesCreated: 0 });
        expect(world.statementRow(bank, '2026-03')?.closing).toEqualMoney('-100');
        expect(world.invoiceRow(card, '2026-05')?.balance).toEqualMoney('-100');
    });

    it('reabre a fatura já paga que recebe compras e a paga de novo pela data do arquivo', async () => {
        const { world, profileId } = setup();
        const bank = world.account(profileId);
        const card = world.creditCard(profileId, bank, 8, 15);
        await world.create({ profileId, subCategoryId: world.subCategory(profileId) }, { source: { kind: 'creditCard', creditCardId: card, invoicePeriod: '2026-03' }, dueDate: '2026-03-01' });
        await world.payInvoice(card, '2026-03', '2026-03-15');
        await world.ok('imports.run', {
            rows: [row(1, { creditCard: 'Cartão', dueDate: '2026-03-15', paymentDate: '2026-04-02' })],
            options: OPTIONS,
            accounts: [{ name: 'Banco', profileId, target: { kind: 'link', accountId: bank } }],
            creditCards: [{ name: 'Cartão', target: { kind: 'link', creditCardId: card } }],
            transferCategory: TRANSFER_CATEGORY,
        });
        expect(world.invoiceRow(card, '2026-03')).toMatchObject({ paidIn: '2026-04' });
        expect(world.invoiceRow(card, '2026-03')?.balance).toEqualMoney('-200');
        expect(world.statementRow(bank, '2026-04')?.closing).toEqualMoney('-200');
    });

    it('aceita a transferência para a conta de outro perfil, que a vê chegar', async () => {
        const { world, profileId } = setup();
        const business = world.profile({ type: 'business' });
        await world.ok('imports.run', {
            rows: [row(1, { type: 'transference', name: 'Pró-labore', value: 500, account: 'Empresa', destination: 'Banco', category: null, subCategory: null })],
            options: OPTIONS,
            accounts: [
                { name: 'Empresa', profileId: business, target: { kind: 'create', type: 'checking', considerBalance: true } },
                { name: 'Banco', profileId, target: { kind: 'create', type: 'checking', considerBalance: true } },
            ],
            creditCards: [],
            transferCategory: TRANSFER_CATEGORY,
        });
        expect(world.accountRow(accountId(world, 'Banco')).balance).toEqualMoney('500');
        expect(world.accountRow(accountId(world, 'Empresa')).balance).toEqualMoney('-500');
        // A categoria padrão é criada no perfil de origem.
        expect(world.database.get('SELECT profile_id AS p FROM transaction_categories WHERE name = :name', { name: 'Transferências' })?.['p']).toBe(business);
    });

    it('paga no vencimento as linhas vencidas quando o arquivo não tem coluna de pagamento', async () => {
        const { world, profileId } = setup();
        await world.ok('imports.run', {
            rows: [row(1, { paymentDate: null }), row(2, { dueDate: '2026-11-10', paymentDate: null })],
            options: { ...OPTIONS, pastDueAsPaid: true },
            accounts: [{ name: 'Banco', profileId, target: { kind: 'create', type: 'checking', considerBalance: true } }],
            creditCards: [],
            transferCategory: TRANSFER_CATEGORY,
        });
        const bank = accountId(world, 'Banco');
        expect(world.accountRow(bank).balance).toEqualMoney('-100');
        expect(world.statementRow(bank, '2026-11')?.projectedClosing).toEqualMoney('-200');
    });
});

describe('imports.run — séries (import-design §5.5)', () => {
    it('grava a fixa com os números do arquivo e termina na última linha antes do horizonte', async () => {
        const { world, profileId } = setup();
        const months = ['2026-01-11', '2026-02-11', '2026-03-11', '2026-05-11'];
        await world.ok('imports.run', {
            rows: months.map((dueDate, index) => row(index + 1, { name: 'Aluguel', value: index === 3 ? 1100 : 1000, dueDate, paymentDate: dueDate, repetition: { kind: 'fixed', frequency: 'monthly' } })),
            options: OPTIONS,
            accounts: [{ name: 'Banco', profileId, target: { kind: 'create', type: 'checking', considerBalance: true } }],
            creditCards: [],
            transferCategory: TRANSFER_CATEGORY,
        });
        const series = world.database.get('SELECT id, type, end_at, materialized_count, starts_at, anchor_day, value FROM recurrences');
        expect(series).toMatchObject({ type: 2, end_at: '2026-05-11', materialized_count: 5, starts_at: 5, anchor_day: 11, value: 1100 });
        const occurrences = world.database.all('SELECT occurrence, paid FROM transactions WHERE recurrence_id = :id ORDER BY occurrence', { id: String(series?.['id']) });
        expect(occurrences).toEqual([1, 2, 3, 5].map((occurrence) => ({ occurrence, paid: 1 })));
        // O complemento da abertura não recria abril, que foi excluído na origem.
        expect((await world.ok('recurrences.topUp', {})).emitted).toBe(0);
    });

    it('fixa no dia 31 que termina num mês de 30 dias mantém o dia âncora 31', async () => {
        const { world, profileId } = setup();
        const months = ['2027-07-31', '2027-08-31', '2027-09-30', '2027-10-31', '2027-11-30', '2027-12-31'];
        await world.ok('imports.run', {
            rows: months.map((dueDate, index) => row(index + 1, { name: 'Aluguel', dueDate, paymentDate: null, repetition: { kind: 'fixed', frequency: 'monthly' } })),
            // Sem as futuras, a referência é 30/09/2027, a última antes do horizonte de 15/10/2027.
            options: { ...OPTIONS, keepFutureOccurrences: false },
            accounts: [{ name: 'Banco', profileId, target: { kind: 'create', type: 'checking', considerBalance: true } }],
            creditCards: [],
            transferCategory: TRANSFER_CATEGORY,
        });
        expect(world.database.get('SELECT starts_on, anchor_day FROM recurrences')).toMatchObject({ starts_on: '2027-09-30', anchor_day: 31 });
    });

    it('mantém sem fim a fixa que passa do horizonte, sem emitir além do arquivo', async () => {
        const { world, profileId } = setup();
        const dates = ['2026-09-15', '2026-10-15', '2027-12-15', '2030-12-15'];
        await world.ok('imports.run', {
            rows: dates.map((dueDate, index) => row(index + 1, { name: 'Spotify', dueDate, paymentDate: null, repetition: { kind: 'fixed', frequency: 'monthly' } })),
            options: OPTIONS,
            accounts: [{ name: 'Banco', profileId, target: { kind: 'create', type: 'checking', considerBalance: true } }],
            creditCards: [],
            transferCategory: TRANSFER_CATEGORY,
        });
        expect(world.database.get('SELECT end_at, materialized_count FROM recurrences')).toEqual({ end_at: null, materialized_count: 52 });
        expect(count(world, 'SELECT COUNT(*) AS n FROM transactions')).toBe(4);
    });

    it('grava o parcelamento no cartão pelas parcelas do arquivo e gera as que faltam no fim', async () => {
        const { world, profileId } = setup();
        const parcel = (line: number, installment: number, dueDate: string, paymentDate: string | null): RowInput => row(line, {
            name: `Mouse  ${String(installment)}/3`,
            value: installment === 1 ? 33.34 : 33.33,
            creditCard: 'Nubank',
            purchaseDate: '2026-08-20',
            dueDate,
            paymentDate,
            repetition: { kind: 'installments', frequency: 'monthly', installment, installments: 3 },
        });
        const outcome = await world.ok('imports.run', {
            rows: [parcel(1, 1, '2026-09-16', '2026-09-10'), parcel(2, 2, '2026-10-16', null)],
            options: OPTIONS,
            accounts: [{ name: 'Banco', profileId, target: { kind: 'create', type: 'checking', considerBalance: true } }],
            creditCards: [{ name: 'Nubank', target: { kind: 'create', payingAccount: 'Banco', closingDay: 9, dueDay: 16, limit: 0 } }],
            transferCategory: TRANSFER_CATEGORY,
        });
        expect(outcome).toMatchObject({ transactions: 2, installmentSeries: 1, invoicesPaid: 1 });
        const rows = world.database.all('SELECT occurrence, name, due_date, value FROM transactions ORDER BY occurrence');
        expect(rows).toEqual([
            { occurrence: 1, name: 'Mouse', due_date: '2026-08-20', value: 33.34 },
            { occurrence: 2, name: 'Mouse', due_date: '2026-09-20', value: 33.33 },
            // A 3ª não estava no arquivo: o app a gera pelo modelo, como num parcelamento lançado aqui.
            { occurrence: 3, name: 'Mouse', due_date: '2026-10-20', value: 33.33 },
        ]);
        expect(world.database.get('SELECT installments, value_type, materialized_count FROM recurrences')).toEqual({ installments: 3, value_type: 2, materialized_count: 3 });
        const card = String(world.database.get("SELECT id FROM credit_cards WHERE name = 'Nubank'")?.['id']);
        // Fecha no 9 e vence no 16: o vencimento de setembro é da fatura de setembro.
        expect(world.invoiceRow(card, '2026-09')).toMatchObject({ paidIn: '2026-09' });
        expect(world.invoiceRow(card, '2026-10')).toMatchObject({ paidIn: null });
        expect(world.invoiceRow(card, '2026-10')?.balance).toEqualMoney('-33.33');
        // A gerada cai na fatura sugerida pela data dela (20/10 → novembro), com o deslocamento
        // zero do modelo.
        expect(world.invoiceRow(card, '2026-11')?.balance).toEqualMoney('-33.33');
    });
});

describe('imports.run — recusa sem gravar nada', () => {
    it('recusa conta do arquivo sem decisão, e nada fica no banco', async () => {
        const { world, profileId } = setup();
        const error = await world.failure('imports.run', {
            rows: [row(1), row(2, { account: 'Outra' })],
            options: OPTIONS,
            accounts: [{ name: 'Banco', profileId, target: { kind: 'create', type: 'checking', considerBalance: true } }],
            creditCards: [],
            transferCategory: TRANSFER_CATEGORY,
        });
        expect(error.code).toBe('VALIDATION_FAILED');
        expect(count(world, 'SELECT COUNT(*) AS n FROM accounts')).toBe(0);
        expect(count(world, 'SELECT COUNT(*) AS n FROM transactions')).toBe(0);
    });

    it('recusa ligar a uma conta desativada ou de outro perfil', async () => {
        const { world, profileId } = setup();
        const other = world.account(world.profile());
        const disabled = world.account(profileId);
        await world.ok('accounts.disable', { id: disabled });
        const input = (accountId: string): RunInput => ({
            rows: [row(1)],
            options: OPTIONS,
            accounts: [{ name: 'Banco', profileId, target: { kind: 'link', accountId } }],
            creditCards: [],
            transferCategory: TRANSFER_CATEGORY,
        });
        expect((await world.failure('imports.run', input(disabled))).details).toMatchObject({ rule: 'account-disabled' });
        expect((await world.failure('imports.run', input(other))).details).toMatchObject({ rule: 'reference-outside-profile' });
        expect(count(world, 'SELECT COUNT(*) AS n FROM transactions')).toBe(0);
    });
});
