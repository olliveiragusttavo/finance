import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CoreInput, SqlRow } from '../../src/index.ts';
import { TestWorld } from '../support/TestWorld.ts';

/** Uma operação aleatória sobre o mundo. */
type Operation =
    | { readonly kind: 'create'; readonly type: 'income' | 'expense' | 'transference'; readonly source: number; readonly invoiceShift: number | null; readonly cents: number; readonly chargeCents: number; readonly date: string; readonly paid: boolean }
    | { readonly kind: 'update'; readonly pick: number; readonly cents: number; readonly date: string; readonly paid: boolean }
    | { readonly kind: 'delete'; readonly pick: number }
    | { readonly kind: 'partialPayment'; readonly card: number; readonly cents: number; readonly date: string }
    | { readonly kind: 'pay'; readonly pick: number; readonly date: string }
    | { readonly kind: 'reopen'; readonly pick: number }
    | { readonly kind: 'advanceClock'; readonly date: string };

const EPSILON = 0.005;
const dateArb = fc.record({ month: fc.integer({ min: 1, max: 6 }), day: fc.integer({ min: 1, max: 28 }) })
    .map(({ month, day }) => `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
const centsArb = fc.integer({ min: -50_000, max: 500_000 }).filter((cents) => cents !== 0);

const operationArb: fc.Arbitrary<Operation> = fc.oneof(
    { weight: 6, arbitrary: fc.record({
        kind: fc.constant('create' as const),
        type: fc.constantFrom('income' as const, 'expense' as const, 'transference' as const),
        source: fc.integer({ min: 0, max: 3 }),
        invoiceShift: fc.option(fc.integer({ min: -1, max: 1 }), { nil: null }),
        cents: centsArb,
        chargeCents: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 2_000 })),
        date: dateArb,
        paid: fc.boolean(),
    }) },
    { weight: 2, arbitrary: fc.record({ kind: fc.constant('update' as const), pick: fc.nat(), cents: centsArb, date: dateArb, paid: fc.boolean() }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('delete' as const), pick: fc.nat() }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('partialPayment' as const), card: fc.integer({ min: 0, max: 1 }), cents: fc.integer({ min: 1, max: 100_000 }), date: dateArb }) },
    { weight: 2, arbitrary: fc.record({ kind: fc.constant('pay' as const), pick: fc.nat(), date: dateArb }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('reopen' as const), pick: fc.nat() }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('advanceClock' as const), date: dateArb }) },
);

/** O cenário fixo sobre o qual as operações rodam. */
interface Scenario {
    readonly world: TestWorld;
    readonly profileId: string;
    readonly subCategoryId: string;
    readonly accounts: readonly [string, string];
    /** Dois cartões com ciclos diferentes, um quitado por cada conta; o segundo fecha no dia 31. */
    readonly cards: readonly [string, string];
    readonly created: string[];
}

/**
 * @return Um perfil com duas contas e dois cartões com ciclos que exercitam o ajuste do dia 31.
 */
function scenario(): Scenario {
    const world = new TestWorld('2026-03-15');
    const profileId = world.profile();
    const first = world.account(profileId, { openingBalance: 1000 });
    const second = world.account(profileId, { openingBalance: 250.5 });
    return {
        world,
        profileId,
        subCategoryId: world.subCategory(profileId),
        accounts: [first, second],
        cards: [world.creditCard(profileId, first, 10, 17), world.creditCard(profileId, second, 31, 5)],
        created: [],
    };
}

/**
 * @param date Data `YYYY-MM-DD`.
 * @param shift Meses a somar.
 * @return A competência deslocada, `YYYY-MM`.
 */
function shiftPeriod(date: string, shift: number): string {
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(5, 7)) + shift;
    const normalized = new Date(Date.UTC(year, month - 1, 1));
    return `${String(normalized.getUTCFullYear())}-${String(normalized.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Executa uma operação pelas rotas reais. Falhas de regra de negócio são aceitas (pagar uma
 * fatura já paga, por exemplo): o que importa é que os invariantes continuem valendo depois.
 *
 * @param s Cenário.
 * @param operation Operação sorteada.
 * @return void
 */
async function apply(s: Scenario, operation: Operation): Promise<void> {
    const { world } = s;
    const base = { profileId: s.profileId, subCategoryId: s.subCategoryId, name: 'Op' };
    switch (operation.kind) {
        case 'create': {
            const isCard = operation.source >= 2 && operation.type !== 'transference';
            const accountIndex = operation.source % 2;
            const source: CoreInput<'transactions.create'>['source'] = isCard
                ? { kind: 'creditCard', creditCardId: s.cards[accountIndex] ?? '', invoicePeriod: operation.invoiceShift === null ? null : shiftPeriod(operation.date, operation.invoiceShift) }
                : { kind: 'account', accountId: s.accounts[accountIndex] ?? '' };
            const result = await world.core.call('transactions.create', {
                ...base,
                type: operation.type,
                source,
                value: operation.cents / 100,
                charges: operation.chargeCents / 100,
                dueDate: operation.date,
                paymentDate: operation.paid ? operation.date : null,
                destinationAccountId: operation.type === 'transference' ? s.accounts[(accountIndex + 1) % 2] ?? null : null,
            });
            if (result.ok) {
                s.created.push(result.data.id);
            }
            return;
        }
        case 'update': {
            const id = s.created[operation.pick % Math.max(s.created.length, 1)];
            if (id === undefined) {
                return;
            }
            const current = await world.core.call('transactions.get', { id });
            if (!current.ok) {
                return;
            }
            const t = current.data;
            const source: CoreInput<'transactions.update'>['source'] = t.container.kind === 'invoice'
                ? { kind: 'creditCard', creditCardId: t.container.creditCardId, invoicePeriod: null }
                : { kind: 'account', accountId: t.container.accountId };
            await world.core.call('transactions.update', {
                id,
                ...base,
                type: t.type,
                source,
                destinationAccountId: t.destinationAccountId,
                partnerId: t.partnerId,
                goalId: t.goalId,
                description: t.description,
                originCurrency: t.originCurrency,
                conversionRate: t.conversionRate,
                value: operation.cents / 100,
                charges: t.charges.amount,
                dueDate: operation.date,
                paymentDate: operation.paid ? operation.date : null,
            });
            return;
        }
        case 'delete': {
            const id = s.created[operation.pick % Math.max(s.created.length, 1)];
            if (id !== undefined) {
                await world.core.call('transactions.delete', { id });
            }
            return;
        }
        case 'partialPayment': {
            const result = await world.core.call('transactions.create', {
                ...base,
                type: 'transference',
                source: { kind: 'creditCard', creditCardId: s.cards[operation.card] ?? '', invoicePeriod: operation.date.slice(0, 7) },
                destinationAccountId: s.accounts[operation.card] ?? null,
                value: -operation.cents / 100,
                dueDate: operation.date,
                paymentDate: operation.date,
            });
            if (result.ok) {
                s.created.push(result.data.id);
            }
            return;
        }
        case 'pay':
        case 'reopen': {
            const invoices = world.database.all('SELECT id FROM invoices WHERE deleted_at IS NULL ORDER BY year, month, credit_card_id');
            const invoiceId = invoices[operation.pick % Math.max(invoices.length, 1)]?.['id'];
            if (typeof invoiceId !== 'string') {
                return;
            }
            if (operation.kind === 'pay') {
                await world.core.call('invoices.pay', { invoiceId, paymentDate: operation.date });
            } else {
                await world.core.call('invoices.reopen', { invoiceId });
            }
            return;
        }
        case 'advanceClock': {
            world.clock.set(operation.date);
            // A abertura da tela inicial confere o cache do mês corrente.
            await world.core.call('balances.ofProfile', { profileId: s.profileId });
            return;
        }
    }
}

/**
 * @param row Linha crua.
 * @param column Coluna numérica.
 * @return O número.
 */
function num(row: SqlRow | undefined, column: string): number {
    const value = row?.[column];
    if (typeof value !== 'number') {
        throw new Error(`coluna ${column} não numérica: ${String(value)}`);
    }
    return value;
}

/**
 * @param period `YYYY-MM`.
 * @return Dias do mês.
 */
function daysIn(period: string): number {
    return new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate();
}

/**
 * Oráculo independente: refaz faturas, cadeias e caches a partir das tabelas cruas, com uma
 * reimplementação direta das regras em JavaScript simples, sem usar nada do domínio. Se a
 * rotina de recálculo tiver um bug, este cálculo não o compartilha (backend-design §5.6).
 *
 * @param s Cenário depois de uma operação.
 * @return void
 */
function assertInvariants(s: Scenario): void {
    const { world } = s;
    const db = world.database;
    /**
     * Direção do tipo, reimplementada aqui de propósito para o oráculo não depender do domínio.
     *
     * @param type Código do tipo no schema (1: receita).
     * @return `1` para receita, `-1` para os demais tipos, que saem da origem.
     */
    const direction = (type: number): number => (type === 1 ? 1 : -1);

    // Toda transação viva está em exatamente um contêiner.
    expect(db.get('SELECT count(*) AS n FROM transactions WHERE deleted_at IS NULL AND (bank_statement_id IS NULL) = (invoice_id IS NULL)')).toEqual({ n: 0 });

    // Total de cada fatura = soma dos efeitos de todas as transações vivas dela.
    const invoices = db.all(
        `SELECT i.id, i.year, i.month, i.balance, i.credit_card_id, c.account_id, c.closing_date, c.due_date,
            bs.year AS paid_year, bs.month AS paid_month
        FROM invoices i JOIN credit_cards c ON c.id = i.credit_card_id
        LEFT JOIN bank_statements bs ON bs.id = i.bank_statement_id AND bs.deleted_at IS NULL
        WHERE i.deleted_at IS NULL`,
    );
    for (const invoice of invoices) {
        const items = db.all('SELECT type, value, charges FROM transactions WHERE invoice_id = :id AND deleted_at IS NULL', { id: invoice['id'] ?? null });
        const expected = items.reduce((sum, item) => sum + direction(num(item, 'type')) * num(item, 'value') - num(item, 'charges'), 0);
        expect(Math.abs(num(invoice, 'balance') - expected), `fatura ${String(invoice['year'])}-${String(invoice['month'])}`).toBeLessThan(EPSILON);
    }

    const today = world.clock.today().period.toString();
    for (const accountId of s.accounts) {
        const movement = new Map<string, { consolidated: number; projected: number }>();
        /**
         * Acumula um efeito no mês; ponto único da regra consolidado × previsto do oráculo.
         *
         * @param period Mês `YYYY-MM` em que o efeito cai.
         * @param effect Efeito no saldo da conta.
         * @param settled `true` quando já aconteceu e entra também no consolidado.
         * @return void
         */
        const add = (period: string, effect: number, settled: boolean): void => {
            const current = movement.get(period) ?? { consolidated: 0, projected: 0 };
            movement.set(period, { consolidated: current.consolidated + (settled ? effect : 0), projected: current.projected + effect });
        };
        /**
         * Formata a competência das linhas cruas, para indexar o movimento pela mesma chave.
         *
         * @param year Ano lido do banco.
         * @param month Mês lido do banco.
         * @return A competência `YYYY-MM`.
         */
        const period = (year: number, month: number): string => `${String(year)}-${String(month).padStart(2, '0')}`;

        for (const row of db.all(
            `SELECT bs.year, bs.month, t.type, t.value, t.charges, t.paid FROM transactions t
            JOIN bank_statements bs ON bs.id = t.bank_statement_id
            WHERE bs.account_id = :accountId AND bs.deleted_at IS NULL AND t.deleted_at IS NULL`,
            { accountId },
        )) {
            add(period(num(row, 'year'), num(row, 'month')), direction(num(row, 'type')) * num(row, 'value') - num(row, 'charges'), num(row, 'paid') === 1);
        }
        for (const row of db.all(
            `SELECT t.due_date, t.value, t.paid FROM transactions t
            WHERE t.destination_account_id = :accountId AND t.type IN (3, 4) AND t.deleted_at IS NULL`,
            { accountId },
        )) {
            add(String(row['due_date']).slice(0, 7), num(row, 'value'), num(row, 'paid') === 1);
        }
        for (const invoice of invoices.filter((candidate) => candidate['account_id'] === accountId)) {
            if (invoice['paid_year'] !== null) {
                add(period(num(invoice, 'paid_year'), num(invoice, 'paid_month')), num(invoice, 'balance'), true);
            } else {
                const invoicePeriod = period(num(invoice, 'year'), num(invoice, 'month'));
                const closing = Math.min(num(invoice, 'closing_date'), daysIn(invoicePeriod));
                const dueSameMonth = Math.min(num(invoice, 'due_date'), daysIn(invoicePeriod));
                add(dueSameMonth > closing ? invoicePeriod : shiftPeriod(`${invoicePeriod}-01`, 1), num(invoice, 'balance'), false);
            }
        }

        const statements = db.all(
            `SELECT year, month, opening_balance, closing_balance, projected_opening_balance, projected_closing_balance
            FROM bank_statements WHERE account_id = :accountId AND deleted_at IS NULL ORDER BY year, month`,
            { accountId },
        );
        const statementPeriods = new Set(statements.map((row) => period(num(row, 'year'), num(row, 'month'))));
        for (const [monthWithMovement, value] of movement) {
            if (Math.abs(value.projected) >= EPSILON || Math.abs(value.consolidated) >= EPSILON) {
                expect(statementPeriods.has(monthWithMovement), `mês ${monthWithMovement} com movimento e sem extrato`).toBe(true);
            }
        }

        const account = db.get('SELECT opening_balance, balance, projected_balance FROM accounts WHERE id = :accountId', { accountId });
        let consolidated = num(account, 'opening_balance');
        let projected = consolidated;
        let current = { consolidated, projected };
        for (const row of statements) {
            const label = `${accountId} ${period(num(row, 'year'), num(row, 'month'))}`;
            expect(Math.abs(num(row, 'opening_balance') - consolidated), `inicial consolidado ${label}`).toBeLessThan(EPSILON);
            expect(Math.abs(num(row, 'projected_opening_balance') - projected), `inicial previsto ${label}`).toBeLessThan(EPSILON);
            const month = movement.get(period(num(row, 'year'), num(row, 'month'))) ?? { consolidated: 0, projected: 0 };
            consolidated = Math.round((consolidated + month.consolidated) * 100) / 100;
            projected = Math.round((projected + month.projected) * 100) / 100;
            expect(Math.abs(num(row, 'closing_balance') - consolidated), `final consolidado ${label}`).toBeLessThan(EPSILON);
            expect(Math.abs(num(row, 'projected_closing_balance') - projected), `final previsto ${label}`).toBeLessThan(EPSILON);
            if (period(num(row, 'year'), num(row, 'month')) <= today) {
                current = { consolidated, projected };
            }
        }
        expect(Math.abs(num(account, 'balance') - current.consolidated), `cache consolidado ${accountId}`).toBeLessThan(EPSILON);
        expect(Math.abs(num(account, 'projected_balance') - current.projected), `cache previsto ${accountId}`).toBeLessThan(EPSILON);
    }
}

describe('propriedades dos saldos (backend-design §5.6)', () => {
    it('depois de cada operação, todo saldo em cache bate com o oráculo independente', async () => {
        await fc.assert(
            fc.asyncProperty(fc.array(operationArb, { minLength: 1, maxLength: 30 }), async (operations) => {
                const s = scenario();
                for (const operation of operations) {
                    await apply(s, operation);
                    assertInvariants(s);
                }
            }),
            { numRuns: 150 },
        );
    });
});
