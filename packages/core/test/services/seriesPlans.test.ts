import { describe, expect, it } from 'vitest';
import { parseTimestamp, type CoreInput, type CoreOutput, type Timestamp } from '../../src/index.ts';
import { editedByHand } from '../../src/services/recurrence/SeriesPlanner.ts';
import { TestWorld } from '../support/TestWorld.ts';

/*
 * Plano das escritas de série para o diálogo de revisão (database-design
 * §4.12). "Hoje" é 05/10/2026: as séries fixas vão até 05/10/2027.
 */

type Transaction = CoreOutput<'transactions.get'>;
type Plan = CoreOutput<'recurrences.planUpdate'>;

/**
 * @return Um perfil com a Nubank e uma subcategoria, e um aluguel fixo mensal desde 05/10/2026
 * (13 ocorrências gravadas), com a 10ª paga.
 */
async function setup(): Promise<{ world: TestWorld; accountId: string; base: { profileId: string; subCategoryId: string }; rent: Transaction }> {
    const world = new TestWorld('2026-10-05');
    const profileId = world.profile();
    const accountId = world.account(profileId, { openingBalance: 5000 });
    const base = { profileId, subCategoryId: world.subCategory(profileId) };
    const rent = await world.create(base, { source: { kind: 'account', accountId }, name: 'Aluguel', value: 2300, dueDate: '2026-10-05', repeat: { kind: 'fixed', frequency: 'monthly', endAt: null } });
    await world.ok('transactions.setPaid', { id: (await occurrenceOf(world, rent, 10)).id, paid: true });
    return { world, accountId, base, rent };
}

/**
 * @param world Núcleo do teste.
 * @param first Uma ocorrência da série.
 * @param occurrence Número procurado.
 * @return A ocorrência viva do número.
 */
async function occurrenceOf(world: TestWorld, first: Transaction, occurrence: number): Promise<Transaction> {
    const found = (await world.ok('recurrences.occurrences', { recurrenceId: first.recurrenceId ?? '' })).find((transaction) => transaction.occurrence === occurrence);
    if (found === undefined) {
        throw new Error(`a série não tem a ocorrência ${String(occurrence)} viva`);
    }
    return found;
}

/**
 * @param transaction Transação como está.
 * @return A entrada de `transactions.update` sem mudança nenhuma, para o teste sobrepor o que quer.
 */
function editInput(transaction: Transaction): CoreInput<'transactions.update'> {
    const { container } = transaction;
    return {
        id: transaction.id,
        type: transaction.type,
        source: container.kind === 'statement' ? { kind: 'account', accountId: container.accountId } : { kind: 'creditCard', creditCardId: container.creditCardId, invoicePeriod: container.period },
        subCategoryId: transaction.subCategoryId,
        destinationAccountId: transaction.destinationAccountId,
        partnerId: transaction.partnerId,
        goalId: transaction.goalId,
        name: transaction.name,
        description: transaction.description,
        value: transaction.value.amount,
        charges: transaction.charges.amount,
        originCurrency: transaction.originCurrency,
        conversionRate: transaction.conversionRate,
        dueDate: transaction.dueDate,
        paymentDate: transaction.paymentDate,
        tagIds: [...transaction.tagIds],
    };
}

/**
 * @param items Ocorrências de um grupo do plano.
 * @return Número, data e situação de cada uma, para comparar de uma vez.
 */
function rows(items: Plan['deleted']): readonly (readonly [number | null, string, boolean])[] {
    return items.map((item) => [item.transaction.occurrence, item.transaction.dueDate, item.transaction.paid] as const);
}

describe('plano do diálogo de revisão (database-design §4.12)', () => {
    it('trocar o tipo lista as excluídas (com as pagas), as criadas e as regras, e não grava nada', async () => {
        const { world, rent } = await setup();
        const third = await occurrenceOf(world, rent, 3);
        const input = { ...editInput(third), value: 1000, scope: 'future', repeat: { kind: 'installments', frequency: 'monthly', installments: 4, valueType: 'total' } } as const;

        const plan = await world.ok('recurrences.planUpdate', input);
        expect(plan.seriesBefore).toMatchObject({ kind: 'fixed', endAt: null });
        expect(plan.seriesAfter).toMatchObject({ kind: 'fixed', endAt: '2026-12-04' });
        expect(plan.newSeries).toMatchObject({ kind: 'installments', installments: 4, valueType: 'total' });
        expect(plan.deleted).toHaveLength(11);
        expect(plan.deleted.filter((item) => item.transaction.paid).map((item) => item.transaction.occurrence)).toEqual([10]);
        expect(rows(plan.created)).toEqual([[1, '2026-12-05', false], [2, '2027-01-05', false], [3, '2027-02-05', false], [4, '2027-03-05', false]]);
        expect(plan.updated).toEqual([]);

        // O ensaio foi desfeito: a série continua inteira, e confirmar grava exatamente o plano.
        expect(await world.ok('recurrences.occurrences', { recurrenceId: rent.recurrenceId ?? '' })).toHaveLength(13);
        const saved = await world.ok('transactions.update', input);
        expect(rows((await world.ok('recurrences.occurrences', { recurrenceId: saved.recurrenceId ?? '' })).map((transaction) => ({ transaction, editedByHand: false })))).toEqual(rows(plan.created));
    });

    it('editar o conteúdo em "esta e as futuras" lista as alteradas, com a data nova', async () => {
        const { world, rent } = await setup();
        const plan = await world.ok('recurrences.planUpdate', { ...editInput(await occurrenceOf(world, rent, 12)), dueDate: '2027-09-10', scope: 'future' });
        expect(rows(plan.updated)).toEqual([[12, '2027-09-10', false], [13, '2027-10-10', false]]);
        expect([plan.deleted, plan.created, plan.newSeries]).toEqual([[], [], null]);
        expect(plan.seriesAfter).toMatchObject({ kind: 'fixed', endAt: null });
    });

    it('a exclusão lista as excluídas e diz se a regra é encerrada ou excluída', async () => {
        const { world, rent } = await setup();
        const future = await world.ok('recurrences.planDelete', { id: (await occurrenceOf(world, rent, 12)).id, scope: 'future' });
        expect(rows(future.deleted)).toEqual([[12, '2027-09-05', false], [13, '2027-10-05', false]]);
        expect(future.seriesAfter).toMatchObject({ endAt: '2027-09-04' });

        const all = await world.ok('recurrences.planDelete', { id: rent.id, scope: 'all' });
        expect(all.deleted).toHaveLength(13);
        expect(all.seriesAfter).toBeNull();
    });

    it('a criação lista o que a série grava agora', async () => {
        const { world, accountId, base } = await setup();
        const plan = await world.ok('recurrences.planCreate', {
            ...base, type: 'expense', name: 'Notebook', value: 1000, source: { kind: 'account', accountId }, dueDate: '2026-10-06', paymentDate: '2026-10-06',
            repeat: { kind: 'installments', frequency: 'monthly', installments: 3, valueType: 'total' },
        });
        expect(plan.seriesBefore).toBeNull();
        expect(plan.newSeries).toMatchObject({ kind: 'installments', installments: 3 });
        expect(rows(plan.created)).toEqual([[1, '2026-10-06', true], [2, '2026-11-06', false], [3, '2026-12-06', false]]);
        expect((await world.ok('recurrences.list', { profileId: base.profileId })).map((r) => r.name)).toEqual(['Aluguel']);
    });

    it('a recusa de uma regra aparece já no plano', async () => {
        const { world, rent } = await setup();
        const error = await world.failure('recurrences.planUpdate', { ...editInput(await occurrenceOf(world, rent, 3)), scope: 'all', repeat: { kind: 'fixed', frequency: 'weekly', endAt: null } });
        expect(error.details).toMatchObject({ rule: 'recurrence-change-requires-scope' });
    });
});

describe('ocorrência editada à mão (desktop-mvp-plan Fase 9.2)', () => {
    it('conta como editada quando a última escrita passou da criação mais de um segundo', () => {
        const stamps = (createdAt: string, updatedAt: string): { createdAt: Timestamp; updatedAt: Timestamp } => ({ createdAt: parseTimestamp(createdAt), updatedAt: parseTimestamp(updatedAt) });
        expect(editedByHand(stamps('2026-10-05 12:00:00', '2026-10-05 12:00:00'))).toBe(false);
        expect(editedByHand(stamps('2026-10-05 12:00:00', '2026-10-05 12:00:01'))).toBe(false);
        expect(editedByHand(stamps('2026-10-05 12:00:00', '2026-10-05 12:00:02'))).toBe(true);
        expect(editedByHand(stamps('2026-10-05 23:59:59', '2026-10-06 00:00:00'))).toBe(false);
        expect(editedByHand(stamps('2026-10-05 23:59:59', '2026-10-06 00:01:00'))).toBe(true);
        expect(editedByHand(undefined)).toBe(false);
    });
});
