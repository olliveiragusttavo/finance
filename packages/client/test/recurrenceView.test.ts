import type { CoreOutput } from '@finance/core';
import { describe, expect, it } from 'vitest';
import {
    buildTransactionTable,
    describeOccurrence,
    describeRepeatPreview,
    describeSeriesPlan,
    formatFrequency,
    formatHiddenRows,
    formatRecurrenceTag,
    NO_TRANSACTION_FILTERS,
    RECURRENCE_FREQUENCY_ORDER,
    REVIEW_VISIBLE_ROWS,
    scopeChoices,
} from '../src/index.ts';
import { ClientWorld } from './support/ClientWorld.ts';

describe('séries na tabela e no painel (desktop-mvp-plan Fase 9.1)', () => {
    it('coluna "Rec." com "n/N" na parcelada e "Fixa" na fixa; subtítulo com o valor total', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const base = { profileId: s.profileId, subCategoryId: s.subCategoryId, type: 'expense' } as const;
        const notebook = await world.ok('transactions.create', {
            ...base, name: 'Notebook', value: 4800, dueDate: '2026-08-08', source: { kind: 'creditCard', creditCardId: s.creditCardId },
            repeat: { kind: 'installments', frequency: 'monthly', installments: 12, valueType: 'total' },
        });
        await world.ok('transactions.create', {
            ...base, name: 'Netflix', value: 55.9, dueDate: '2026-10-12', source: { kind: 'account', accountId: s.checkingId },
            repeat: { kind: 'fixed', frequency: 'monthly', endAt: null },
        });
        const [transactions, accounts, creditCards, categories, recurrences] = await Promise.all([
            world.ok('transactions.listByPeriod', { profileId: s.profileId, period: '2026-10' }),
            world.ok('accounts.list', { profileId: s.profileId, period: '2026-10' }),
            world.ok('creditCards.list', { profileId: s.profileId, period: '2026-10' }),
            world.ok('categories.tree', { profileId: s.profileId }),
            world.ok('recurrences.list', { profileId: s.profileId }),
        ]);
        const table = buildTransactionTable({ profileId: s.profileId, transactions, accounts: accounts.accounts, creditCards: creditCards.creditCards, categories, invoices: [], recurrences }, NO_TRANSACTION_FILTERS);
        const tags = Object.fromEntries(table.rows.map((row) => [row.name, row.recurrenceTag]));
        expect(tags).toMatchObject({ Notebook: '3/12', Netflix: 'Fixa', Aluguel: null });

        const third = transactions.find((transaction) => transaction.name === 'Notebook');
        const series = recurrences.find((recurrence) => recurrence.id === notebook.recurrenceId);
        if (third === undefined || series === undefined) {
            throw new Error('cenário incompleto');
        }
        expect(describeOccurrence(third, series)).toBe('parcela 3 de 12 (valor total R$ 4.800,00)');
        expect(describeOccurrence({ occurrence: 1 }, { ...series, kind: 'fixed', installments: null, endAt: '2026-12-31', frequency: 'weekly' })).toBe('fixa semanal até 31/12/2026');
        expect(formatRecurrenceTag({ recurrenceId: 'x', occurrence: 2 }, undefined)).toBe('Rec.');
    });

    it('frequências na ordem do seletor', () => {
        expect(RECURRENCE_FREQUENCY_ORDER.map((frequency) => formatFrequency(frequency, true))).toEqual(['Mensal', 'Semanal', 'Anual', 'Diária']);
    });
});

describe('diálogo de escopo (mockup `MobileEscopo`; database-design §4.12)', () => {
    it('conta as ocorrências de cada escopo; "futuras" é pelo número', async () => {
        const world = new ClientWorld();
        const { fresh } = await seedRent(world);
        const october = fresh.find((transaction) => transaction.dueDate === '2026-10-05');
        const july = fresh[0];
        if (october === undefined || july === undefined) {
            throw new Error('cenário incompleto');
        }
        expect(scopeChoices({ edited: october, occurrences: fresh }).map((choice) => [choice.label, choice.detail, choice.count])).toEqual([
            ['Somente esta', 'Só a de out/2026', 1],
            ['Esta e as futuras', 'De out/2026 em diante', 3],
            ['Todas', 'A série inteira, inclusive meses passados', 6],
        ]);
        // Julho movido para depois de outubro continua antes dele na série.
        const moved = fresh.map((transaction) => (transaction.id === july.id ? { ...transaction, dueDate: '2026-11-20' } : transaction));
        expect(scopeChoices({ edited: october, occurrences: moved })[1]?.count).toBe(3);
    });
});

describe('diálogo de revisão (database-design §4.12)', () => {
    it('excluir todas: a série some, e o aviso diz quantas pagas e os saldos de quais meses e contas mudam', async () => {
        const world = new ClientWorld();
        const { first, accounts } = await seedRent(world);
        const plan = await world.ok('recurrences.planDelete', { id: first.id, scope: 'all' });
        const review = describeSeriesPlan({ plan: withoutHandEdits(plan), action: 'delete', accounts });
        expect(review.summary).toEqual(['A série será excluída, inclusive as transações passadas.']);
        // Marcar pago "hoje" (15/10) leva ago e set para o extrato de outubro: é ele que muda.
        expect(review.warnings).toEqual(['3 ocorrências já pagas serão excluídas. Os saldos de jul e out/2026 da conta Nubank vão mudar.']);
        expect(review.groups.map((group) => group.title)).toEqual(['6 transações serão excluídas']);
        expect(review.groups[0]?.rows.slice(0, 2).map((row) => [row.date, row.status])).toEqual([['05/07/2026', 'Paga'], ['05/08/2026', 'Paga']]);
    });

    it('fixa virando parcelada: remove as futuras, encerra a série, cria a nova sem vínculo e lista as duas pontas', async () => {
        const world = new ClientWorld();
        const { fresh, accounts } = await seedRent(world);
        const october = fresh.find((transaction) => transaction.dueDate === '2026-10-05');
        if (october === undefined) {
            throw new Error('cenário incompleto');
        }
        const plan = await world.ok('recurrences.planUpdate', {
            id: october.id, type: 'expense', source: { kind: 'account', accountId: october.container.kind === 'statement' ? october.container.accountId : '' },
            subCategoryId: october.subCategoryId, destinationAccountId: null, partnerId: null, goalId: null, name: 'Aluguel', description: null,
            value: 900, charges: 0, originCurrency: null, conversionRate: 1, dueDate: '2026-10-05', paymentDate: null, tagIds: [],
            scope: 'future', repeat: { kind: 'installments', frequency: 'monthly', installments: 3, valueType: 'total' },
        });
        const marked = { ...plan, deleted: plan.deleted.map((item, index) => ({ ...item, editedByHand: index === 0 })), created: plan.created.map((item) => ({ ...item, editedByHand: false })) };
        const review = describeSeriesPlan({ plan: marked, action: 'edit', accounts });
        expect(review.summary).toEqual([
            'As transações futuras desta série serão removidas.',
            'A série fixa atual será encerrada em 04/10/2026.',
            'Será criada uma nova série parcelada mensal em 3x, começando nesta transação.',
            'A nova série não terá vínculo com as transações anteriores: a sequência atual se perde.',
        ]);
        expect(review.warnings).toEqual(['1 transação editada manualmente será excluída, e o que foi alterado nela se perde.']);
        expect(review.groups.map((group) => [group.title, group.rows.map((row) => [row.date, row.editedByHand])])).toEqual([
            ['3 transações serão excluídas', [['05/10/2026', true], ['05/11/2026', false], ['05/12/2026', false]]],
            ['3 transações serão criadas', [['05/10/2026', false], ['05/11/2026', false], ['05/12/2026', false]]],
        ]);
    });

    it('reduzir as parcelas e criar uma série descrevem a série; listas longas mostram as 5 primeiras', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const accounts = (await world.ok('accounts.list', { profileId: s.profileId, period: '2026-10' })).accounts;
        const input = {
            profileId: s.profileId, subCategoryId: s.subCategoryId, type: 'expense', name: 'Netflix', value: 55.9, dueDate: '2026-10-12', source: { kind: 'account', accountId: s.checkingId },
            repeat: { kind: 'fixed', frequency: 'monthly', endAt: null },
        } as const;
        const created = describeSeriesPlan({ plan: withoutHandEdits(await world.ok('recurrences.planCreate', input)), action: 'create', accounts });
        expect(created.summary).toEqual(['Será criada uma série fixa mensal, sem término.', 'As próximas transações entram conforme o tempo passa, sempre até 12 meses à frente.']);
        expect(created.groups[0]?.title).toBe('13 transações serão criadas');
        expect(formatHiddenRows((created.groups[0]?.rows.length ?? 0) - REVIEW_VISIBLE_ROWS)).toBe('e mais 8 transações');
        expect(formatHiddenRows(1)).toBe('e mais 1 transação');
        expect(formatHiddenRows(0)).toBeNull();

        const purchase = await world.ok('transactions.create', { ...input, name: 'Notebook', value: 100, repeat: { kind: 'installments', frequency: 'monthly', installments: 6, valueType: 'perInstallment' } });
        const plan = await world.ok('recurrences.planUpdate', {
            id: purchase.id, type: 'expense', source: { kind: 'account', accountId: s.checkingId }, subCategoryId: s.subCategoryId, destinationAccountId: null, partnerId: null, goalId: null,
            name: 'Notebook', description: null, value: 100, charges: 0, originCurrency: null, conversionRate: 1, dueDate: '2026-10-12', paymentDate: null, tagIds: [],
            scope: 'future', repeat: { kind: 'installments', frequency: 'monthly', installments: 4, valueType: 'perInstallment' },
        });
        const reduced = describeSeriesPlan({ plan: withoutHandEdits(plan), action: 'edit', accounts });
        expect(reduced.summary).toEqual(['A série passa de 6 para 4 parcelas.']);
        expect(reduced.groups.map((group) => group.title)).toEqual(['2 transações serão excluídas', '1 transação será alterada']);
    });
});

/**
 * Aluguel fixo mensal de julho a dezembro de 2026 na Nubank, com julho, agosto e setembro pagos.
 *
 * @param world Núcleo do teste.
 * @return O cenário, a 1ª ocorrência, as ocorrências vivas e as contas do perfil.
 */
async function seedRent(world: ClientWorld): Promise<{
    s: Awaited<ReturnType<ClientWorld['seed']>>;
    first: CoreOutput<'transactions.create'>;
    fresh: readonly CoreOutput<'transactions.get'>[];
    accounts: CoreOutput<'accounts.list'>['accounts'];
}> {
    const s = await world.seed();
    const first = await world.ok('transactions.create', {
        profileId: s.profileId, subCategoryId: s.housingSubCategoryId, type: 'expense', name: 'Aluguel', value: 2300, dueDate: '2026-07-05',
        paymentDate: '2026-07-05', source: { kind: 'account', accountId: s.checkingId }, repeat: { kind: 'fixed', frequency: 'monthly', endAt: '2026-12-31' },
    });
    const occurrences = await world.ok('recurrences.occurrences', { recurrenceId: first.recurrenceId ?? '' });
    for (const paid of occurrences.slice(1, 3)) {
        await world.ok('transactions.setPaid', { id: paid.id, paid: true });
    }
    const fresh = await world.ok('recurrences.occurrences', { recurrenceId: first.recurrenceId ?? '' });
    const accounts = (await world.ok('accounts.list', { profileId: s.profileId, period: '2026-10' })).accounts;
    return { s, first, fresh, accounts };
}

/**
 * O relógio fixo do teste carimba `updated_at` num dia e o banco carimba `created_at` no dia
 * real, então "editada à mão" sairia de acordo com a data em que o teste roda. Os testes que não
 * tratam disso zeram a marca para não depender do calendário.
 *
 * @param plan Plano do núcleo.
 * @return O mesmo plano, sem nenhuma ocorrência marcada como editada à mão.
 */
function withoutHandEdits(plan: CoreOutput<'recurrences.planUpdate'>): CoreOutput<'recurrences.planUpdate'> {
    const clear = (items: CoreOutput<'recurrences.planUpdate'>['deleted']): CoreOutput<'recurrences.planUpdate'>['deleted'] => items.map((item) => ({ ...item, editedByHand: false }));
    return { ...plan, deleted: clear(plan.deleted), created: clear(plan.created), updated: clear(plan.updated) };
}

describe('prévia das parcelas (mockup `MobileParcelar`)', () => {
    it('parcelado no cartão: total, parcelas, fatura de cada uma, o resto e a nota do arredondamento', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const repeat = { kind: 'installments', frequency: 'monthly', installments: 12, valueType: 'total' } as const;
        const occurrences = await world.ok('recurrences.preview', { profileId: s.profileId, source: { kind: 'creditCard', creditCardId: s.creditCardId }, dueDate: '2026-10-06', value: 1000, repeat });
        const preview = describeRepeatPreview({ occurrences, repeat });
        expect(preview).toEqual({
            headline: 'R$ 1.000,00 em 12x de R$ 83,33',
            rows: [
                { key: 1, label: '1/12', detail: 'fatura nov/2026', amount: 'R$ 83,37' },
                { key: 2, label: '2/12', detail: 'fatura dez/2026', amount: 'R$ 83,33' },
                { key: 3, label: '3/12', detail: 'fatura jan/2027', amount: 'R$ 83,33' },
                { key: 4, label: '4/12', detail: 'fatura fev/2027', amount: 'R$ 83,33' },
            ],
            more: 'Ver as 8 restantes, até out/2027',
            note: 'A divisão não fecha: a diferença do arredondamento vai para a 1ª parcela.',
        });
    });

    it('fixa na conta: valor, frequência e fim', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const repeat = { kind: 'fixed', frequency: 'monthly', endAt: '2026-12-31' } as const;
        const occurrences = await world.ok('recurrences.preview', { profileId: s.profileId, source: { kind: 'account', accountId: s.checkingId }, dueDate: '2026-10-05', value: 2300, repeat });
        const preview = describeRepeatPreview({ occurrences, repeat });
        expect(preview.headline).toBe('R$ 2.300,00 todo mês até 31/12/2026');
        expect(preview.rows.map((row) => [row.label, row.detail, row.amount])).toEqual([['05/10/2026', '', 'R$ 2.300,00'], ['05/11/2026', '', 'R$ 2.300,00'], ['05/12/2026', '', 'R$ 2.300,00']]);
        expect(preview.more).toBeNull();
        expect(describeRepeatPreview({ occurrences: [], repeat }).headline).toBe('');
    });
});
