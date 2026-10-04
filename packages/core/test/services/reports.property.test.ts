import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CoreInput } from '../../src/index.ts';
import { TestWorld } from '../support/TestWorld.ts';

/** Uma operação aleatória que só mexe com despesas e com o estado das faturas. */
type Operation =
    | { readonly kind: 'create'; readonly source: number; readonly subCategory: number; readonly cents: number; readonly chargeCents: number; readonly date: string; readonly paidOn: string | null }
    | { readonly kind: 'update'; readonly pick: number; readonly cents: number; readonly date: string; readonly paidOn: string | null }
    | { readonly kind: 'setPaid'; readonly pick: number; readonly paid: boolean; readonly today: string }
    | { readonly kind: 'delete'; readonly pick: number }
    | { readonly kind: 'pay'; readonly pick: number; readonly date: string }
    | { readonly kind: 'reopen'; readonly pick: number };

/** Meses em que as operações caem; faturas em aberto podem vencer até agosto. */
const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];

const dateArb = fc.record({ month: fc.integer({ min: 1, max: 6 }), day: fc.integer({ min: 1, max: 28 }) })
    .map(({ month, day }) => `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
const centsArb = fc.integer({ min: -30_000, max: 300_000 }).filter((cents) => cents !== 0);
// Pagamento em qualquer mês: relatório e extrato seguem a mesma data de pagamento.
const paidOnArb = fc.option(dateArb, { nil: null });

const operationArb: fc.Arbitrary<Operation> = fc.oneof(
    { weight: 6, arbitrary: fc.record({
        kind: fc.constant('create' as const),
        source: fc.integer({ min: 0, max: 3 }),
        subCategory: fc.integer({ min: 0, max: 2 }),
        cents: centsArb,
        chargeCents: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 2_000 })),
        date: dateArb,
        paidOn: paidOnArb,
    }) },
    { weight: 2, arbitrary: fc.record({ kind: fc.constant('update' as const), pick: fc.nat(), cents: centsArb, date: dateArb, paidOn: paidOnArb }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('setPaid' as const), pick: fc.nat(), paid: fc.boolean(), today: dateArb }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('delete' as const), pick: fc.nat() }) },
    { weight: 2, arbitrary: fc.record({ kind: fc.constant('pay' as const), pick: fc.nat(), date: dateArb }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('reopen' as const), pick: fc.nat() }) },
);

/** O cenário fixo sobre o qual as operações rodam. */
interface Scenario {
    readonly world: TestWorld;
    readonly profileId: string;
    readonly subCategories: readonly string[];
    /** A segunda conta está fora do total: o relatório a conta mesmo assim (R4). */
    readonly accounts: readonly [string, string];
    /** Um cartão por conta; o segundo fecha no dia 31 e vence no mês seguinte. */
    readonly cards: readonly [string, string];
    readonly created: string[];
}

/**
 * @return Um perfil com duas contas, dois cartões e três subcategorias em duas categorias.
 */
function scenario(): Scenario {
    const world = new TestWorld('2026-03-15');
    const profileId = world.profile();
    const first = world.account(profileId, { openingBalance: 1000 });
    const second = world.account(profileId, { openingBalance: 0, considerBalance: false });
    return {
        world,
        profileId,
        subCategories: [
            world.namedSubCategory(profileId, 'Alimentação', 'Mercado').subCategoryId,
            world.namedSubCategory(profileId, 'Alimentação', 'Restaurantes').subCategoryId,
            world.namedSubCategory(profileId, 'Moradia', 'Aluguel').subCategoryId,
        ],
        accounts: [first, second],
        cards: [world.creditCard(profileId, first, 10, 17), world.creditCard(profileId, second, 31, 5)],
        created: [],
    };
}

/**
 * Executa uma operação pelas rotas reais. Falhas de regra de negócio são aceitas: o que
 * importa é que a propriedade continue valendo depois.
 *
 * @param s Cenário.
 * @param operation Operação sorteada.
 * @return void
 */
async function apply(s: Scenario, operation: Operation): Promise<void> {
    const { world } = s;
    switch (operation.kind) {
        case 'create': {
            const index = operation.source % 2;
            const source: CoreInput<'transactions.create'>['source'] = operation.source >= 2
                ? { kind: 'creditCard', creditCardId: s.cards[index] ?? '' }
                : { kind: 'account', accountId: s.accounts[index] ?? '' };
            const result = await world.core.call('transactions.create', {
                profileId: s.profileId,
                subCategoryId: s.subCategories[operation.subCategory] ?? '',
                type: 'expense',
                name: 'Op',
                source,
                value: operation.cents / 100,
                charges: operation.chargeCents / 100,
                dueDate: operation.date,
                paymentDate: operation.paidOn,
            });
            if (result.ok) {
                s.created.push(result.data.id);
            }
            return;
        }
        case 'update': {
            const id = s.created[operation.pick % Math.max(s.created.length, 1)];
            const current = id === undefined ? null : await world.core.call('transactions.get', { id });
            if (id === undefined || current === null || !current.ok) {
                return;
            }
            const t = current.data;
            await world.core.call('transactions.update', {
                id,
                subCategoryId: t.subCategoryId,
                type: t.type,
                name: t.name,
                source: t.container.kind === 'invoice'
                    ? { kind: 'creditCard', creditCardId: t.container.creditCardId, invoicePeriod: null }
                    : { kind: 'account', accountId: t.container.accountId },
                destinationAccountId: null,
                partnerId: null,
                goalId: null,
                description: null,
                originCurrency: t.originCurrency,
                conversionRate: t.conversionRate,
                value: operation.cents / 100,
                charges: t.charges.amount,
                dueDate: operation.date,
                paymentDate: operation.paidOn,
                tagIds: [...t.tagIds],
            });
            return;
        }
        case 'setPaid': {
            const id = s.created[operation.pick % Math.max(s.created.length, 1)];
            if (id !== undefined) {
                // O atalho marca pago com "hoje": move a transação para o extrato do mês de hoje.
                world.clock.set(operation.today);
                await world.core.call('transactions.setPaid', { id, paid: operation.paid });
            }
            return;
        }
        case 'delete': {
            const id = s.created[operation.pick % Math.max(s.created.length, 1)];
            if (id !== undefined) {
                await world.core.call('transactions.delete', { id });
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
    }
}

/**
 * A propriedade da Fase 2.3: com só despesas no perfil, o que o relatório diz que saiu num
 * mês é exatamente o que o saldo **previsto** das contas diz que saiu — o movimento previsto
 * de cada extrato, lido da tabela que a rotina de recálculo mantém. Vale para qualquer data
 * de pagamento, porque o extrato e o relatório seguem a mesma data (reports-design §2). Se o
 * SQL do mês de pagamento discordar da regra do saldo (transação paga em outro mês, fatura em
 * aberto no vencimento, paga no extrato do pagamento), um mês fica com valor sobrando e outro
 * faltando.
 *
 * @param s Cenário depois de uma operação.
 * @return void
 */
async function assertTreeMatchesProjectedMovement(s: Scenario): Promise<void> {
    for (const period of MONTHS) {
        const projectedOutflow = s.accounts.reduce((sum, accountId) => {
            const row = s.world.statementRow(accountId, period);
            return row === undefined ? sum : sum + row.projectedOpening.amount - row.projectedClosing.amount;
        }, 0);
        const report = await s.world.ok('reports.byCategory', { profileId: s.profileId, period });
        const subCategories = report.categories.flatMap((category) => category.subCategories);
        const treeTotal = subCategories.reduce((sum, subCategory) => sum + subCategory.amount.amount, 0);

        expect(report.total.amount, `total do relatório em ${period}`).toEqualMoney(projectedOutflow.toFixed(2));
        expect({ amount: treeTotal, currency: 'BRL' }, `soma das subcategorias em ${period}`).toEqualMoney(projectedOutflow.toFixed(2));
    }
}

describe('Propriedade — relatório por categoria × saldo previsto', () => {
    it('soma das despesas da árvore no mês = saída prevista das contas no mês', async () => {
        await fc.assert(
            fc.asyncProperty(fc.array(operationArb, { minLength: 1, maxLength: 20 }), async (operations) => {
                const s = scenario();
                for (const operation of operations) {
                    await apply(s, operation);
                    await assertTreeMatchesProjectedMovement(s);
                }
            }),
            { numRuns: 60 },
        );
    });
});
