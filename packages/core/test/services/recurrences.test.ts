import { describe, expect, it } from 'vitest';
import type { CoreInput, CoreOutput } from '../../src/index.ts';
import { TestWorld } from '../support/TestWorld.ts';

/*
 * Testes de mesa das recorrências (database-design §4.12; backend-design §5.5, casos 5, 6 e 10;
 * desktop-mvp-plan Fase 9.1). "Hoje" é 05/10/2026: as séries fixas vão até 05/10/2027.
 */

type Transaction = CoreOutput<'transactions.get'>;

/**
 * @return Um perfil com a Nubank (saldo inicial 5.000), o cartão Roxinho (fecha 3, vence 10) e
 * uma subcategoria, num mundo em que hoje é 05/10/2026.
 */
function setup(): {
    world: TestWorld;
    profileId: string;
    accountId: string;
    creditCardId: string;
    base: { profileId: string; subCategoryId: string };
} {
    const world = new TestWorld('2026-10-05');
    const profileId = world.profile();
    const accountId = world.account(profileId, { openingBalance: 5000 });
    const creditCardId = world.creditCard(profileId, accountId, 3, 10);
    return { world, profileId, accountId, creditCardId, base: { profileId, subCategoryId: world.subCategory(profileId) } };
}

/**
 * @param world Núcleo do teste.
 * @param first Uma ocorrência da série.
 * @return As ocorrências vivas da série, por data.
 */
async function series(world: TestWorld, first: Transaction): Promise<readonly Transaction[]> {
    return world.ok('recurrences.occurrences', { recurrenceId: first.recurrenceId ?? '' });
}

/**
 * @param world Núcleo do teste.
 * @param first Uma ocorrência da série.
 * @param occurrence Número procurado.
 * @return A ocorrência viva do número.
 */
async function occurrenceOf(world: TestWorld, first: Transaction, occurrence: number): Promise<Transaction> {
    const found = (await series(world, first)).find((transaction) => transaction.occurrence === occurrence);
    if (found === undefined) {
        throw new Error(`a série não tem a ocorrência ${String(occurrence)} viva`);
    }
    return found;
}

/**
 * @param world Núcleo do teste.
 * @return Os desvios entre o saldo em cache e o recálculo — vazio quando toda escrita recalculou o que devia.
 */
async function drifts(world: TestWorld): Promise<readonly unknown[]> {
    return (await world.ok('integrity.verifyBalances', {})).drifts;
}

describe('parcelamento (database-design §4.12)', () => {
    it('1.000,00 em 3x no cartão: resto na 1ª parcela, uma fatura por mês, série inteira gravada', async () => {
        const { world, creditCardId, base } = setup();
        const first = await world.create(base, {
            source: { kind: 'creditCard', creditCardId },
            name: 'Notebook',
            value: 1000,
            dueDate: '2026-10-06',
            repeat: { kind: 'installments', frequency: 'monthly', installments: 3, valueType: 'total' },
        });

        const all = await series(world, first);
        expect(all.map((t) => [t.occurrence, t.dueDate, t.value.amount, t.container.period])).toEqual([
            [1, '2026-10-06', 333.34, '2026-11'],
            [2, '2026-11-06', 333.33, '2026-12'],
            [3, '2026-12-06', 333.33, '2027-01'],
        ]);
        expect(await world.ok('recurrences.list', { profileId: base.profileId })).toEqual([
            expect.objectContaining({ kind: 'installments', frequency: 'monthly', installments: 3, valueType: 'total', total: { amount: 1000, currency: 'BRL' } }),
        ]);
        expect(await drifts(world)).toEqual([]);
    });

    it('a fatura escolhida para a 1ª parcela desloca todas as seguintes', async () => {
        const { world, creditCardId, base } = setup();
        const first = await world.create(base, {
            source: { kind: 'creditCard', creditCardId, invoicePeriod: '2026-12' },
            value: 100,
            dueDate: '2026-10-06',
            repeat: { kind: 'installments', frequency: 'monthly', installments: 3, valueType: 'perInstallment' },
        });
        expect((await series(world, first)).map((t) => t.container.period)).toEqual(['2026-12', '2027-01', '2027-02']);
    });

    it('12x de 100,00 por parcela atravessando o ano, e a prévia igual ao que é gravado', async () => {
        const { world, accountId, base } = setup();
        const repeat = { kind: 'installments', frequency: 'monthly', installments: 12, valueType: 'perInstallment' } as const;
        const preview = await world.ok('recurrences.preview', { profileId: base.profileId, source: { kind: 'account', accountId }, dueDate: '2026-10-15', value: 100, repeat });
        const first = await world.create(base, { source: { kind: 'account', accountId }, value: 100, dueDate: '2026-10-15', repeat });

        const all = await series(world, first);
        expect(all).toHaveLength(12);
        expect(all.at(-1)?.dueDate).toBe('2027-09-15');
        expect(preview.map((p) => [p.dueDate, p.value.amount, p.invoicePeriod])).toEqual(all.map((t) => [t.dueDate, t.value.amount, null]));
        expect((await world.ok('recurrences.list', { profileId: base.profileId }))[0]?.total).toEqual({ amount: 1200, currency: 'BRL' });
    });
});

describe('série fixa e complemento (database-design §4.12)', () => {
    it('grava até 12 meses à frente; o complemento é idempotente, estende com o tempo e não recria a excluída', async () => {
        const { world, accountId, base } = setup();
        const first = await world.create(base, { source: { kind: 'account', accountId }, name: 'Aluguel', value: 2300, dueDate: '2026-10-05', repeat: { kind: 'fixed', frequency: 'monthly', endAt: null } });

        const created = await series(world, first);
        expect(created).toHaveLength(13);
        expect(created.at(-1)?.dueDate).toBe('2027-10-05');
        expect(await world.ok('recurrences.topUp', {})).toEqual({ emitted: 0, failures: [] });

        await world.ok('transactions.delete', { id: (await occurrenceOf(world, first, 13)).id });
        world.clock.set('2026-11-10');
        expect(await world.ok('recurrences.topUp', {})).toEqual({ emitted: 1, failures: [] });
        const after = await series(world, first);
        expect(after.map((t) => t.occurrence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14]);
        expect(after.at(-1)?.dueDate).toBe('2027-11-05');
        expect(await drifts(world)).toEqual([]);
    });

    it('a fixa com fim para no fim; um fim antes do início é recusado', async () => {
        const { world, accountId, base } = setup();
        const first = await world.create(base, { source: { kind: 'account', accountId }, dueDate: '2026-10-05', repeat: { kind: 'fixed', frequency: 'monthly', endAt: '2026-12-31' } });
        expect((await series(world, first)).map((t) => t.dueDate)).toEqual(['2026-10-05', '2026-11-05', '2026-12-05']);

        const error = await world.failure('transactions.create', {
            ...base, type: 'expense', name: 'Errado', value: 1, source: { kind: 'account', accountId }, dueDate: '2026-10-05', repeat: { kind: 'fixed', frequency: 'monthly', endAt: '2026-10-01' },
        });
        expect(error.details).toMatchObject({ rule: 'recurrence-end-before-start' });
    });

    it('continua gerando com a conta desativada, e transferência também pode ser recorrente', async () => {
        const { world, profileId, accountId, base } = setup();
        const savings = world.account(profileId, { name: 'Tesouro' });
        const first = await world.create(base, {
            type: 'investment', source: { kind: 'account', accountId }, destinationAccountId: savings, name: 'Aporte', value: 500, dueDate: '2026-10-10',
            repeat: { kind: 'fixed', frequency: 'monthly', endAt: null },
        });
        await world.ok('accounts.disable', { id: accountId });
        // Começou em 10/10 e foi até 10/09/2027; o horizonte novo (12/11/2027) alcança out e nov.
        world.clock.set('2026-11-12');
        expect(await world.ok('recurrences.topUp', {})).toEqual({ emitted: 2, failures: [] });
        const last = (await series(world, first)).at(-1);
        expect(last).toMatchObject({ dueDate: '2027-11-10', destinationAccountId: savings, type: 'investment' });
        expect(await drifts(world)).toEqual([]);
    });
});

describe('editar com escopo (database-design §4.12)', () => {
    it('"esta e as futuras", "todas" e "somente esta" aplicam só o que mudou; pago fica individual', async () => {
        const { world, accountId, base } = setup();
        const first = await world.create(base, { source: { kind: 'account', accountId }, name: 'Aluguel', value: 2300, dueDate: '2026-08-05', repeat: { kind: 'fixed', frequency: 'monthly', endAt: null } });
        await world.ok('transactions.setPaid', { id: first.id, paid: true });

        await world.edit(await occurrenceOf(world, first, 4), { value: 9 });
        await world.edit(await occurrenceOf(world, first, 3), { value: 2500, scope: 'future' });
        await world.edit(await occurrenceOf(world, first, 2), { name: 'Aluguel apto', scope: 'all' });

        const all = await series(world, first);
        expect(all.slice(0, 5).map((t) => [t.occurrence, t.name, t.value.amount, t.paid])).toEqual([
            [1, 'Aluguel apto', 2300, true],
            [2, 'Aluguel apto', 2300, false],
            [3, 'Aluguel apto', 2500, false],
            // A 4ª tinha valor próprio ("somente esta"), mas o valor é justamente o que mudou na
            // editada em "esta e as futuras", então vale para ela também.
            [4, 'Aluguel apto', 2500, false],
            [5, 'Aluguel apto', 2500, false],
        ]);
        // O complemento usa o modelo atualizado.
        world.clock.set('2026-11-10');
        await world.ok('recurrences.topUp', {});
        expect((await series(world, first)).at(-1)).toMatchObject({ name: 'Aluguel apto', value: { amount: 2500 } });
        expect(await drifts(world)).toEqual([]);
    });

    it('renomear em "todas" não copia o valor de uma parcela para as outras', async () => {
        const { world, accountId, base } = setup();
        const first = await world.create(base, { source: { kind: 'account', accountId }, value: 1000, dueDate: '2026-10-06', repeat: { kind: 'installments', frequency: 'monthly', installments: 3, valueType: 'total' } });
        await world.edit(await occurrenceOf(world, first, 3), { name: 'Geladeira', scope: 'all' });
        expect((await series(world, first)).map((t) => [t.name, t.value.amount])).toEqual([['Geladeira', 333.34], ['Geladeira', 333.33], ['Geladeira', 333.33]]);
    });

    it('trocar a data muda o dia dentro do mês de cada uma, e o complemento segue o dia novo', async () => {
        const { world, accountId, base } = setup();
        const first = await world.create(base, { source: { kind: 'account', accountId }, dueDate: '2026-10-05', repeat: { kind: 'fixed', frequency: 'monthly', endAt: null } });
        await world.edit(await occurrenceOf(world, first, 3), { dueDate: '2026-12-31', scope: 'future' });
        expect((await series(world, first)).slice(0, 6).map((t) => t.dueDate)).toEqual(['2026-10-05', '2026-11-05', '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31']);
        // A 13ª passou para 31/10/2027; a 14ª, no dia 30 (novembro não tem 31), entra quando o
        // horizonte a alcança.
        world.clock.set('2026-12-01');
        await world.ok('recurrences.topUp', {});
        expect((await series(world, first)).slice(-2).map((t) => t.dueDate)).toEqual(['2027-10-31', '2027-11-30']);
        expect(await drifts(world)).toEqual([]);
    });

    it('na semanal muda o dia da semana dentro da semana; na diária, trocar a data só vale para "somente esta"', async () => {
        const { world, accountId, base } = setup();
        const weekly = await world.create(base, { source: { kind: 'account', accountId }, dueDate: '2026-10-05', repeat: { kind: 'fixed', frequency: 'weekly', endAt: '2026-10-26' } });
        await world.edit(await occurrenceOf(world, weekly, 2), { dueDate: '2026-10-16', scope: 'future' });
        expect((await series(world, weekly)).map((t) => t.dueDate)).toEqual(['2026-10-05', '2026-10-16', '2026-10-23', '2026-10-30']);

        const daily = await world.create(base, { source: { kind: 'account', accountId }, dueDate: '2026-10-05', repeat: { kind: 'fixed', frequency: 'daily', endAt: '2026-10-07' } });
        const second = await occurrenceOf(world, daily, 2);
        const error = await world.failure('transactions.update', { ...(await editInput(world, second)), dueDate: '2026-10-20', scope: 'future' });
        expect(error.details).toMatchObject({ rule: 'recurrence-daily-date-single-only' });
        expect((await world.edit(second, { dueDate: '2026-10-20' })).dueDate).toBe('2026-10-20');
    });

    it('"futuras" é pelo número: a movida para depois da editada continua antes dela na série', async () => {
        const { world, accountId, base } = setup();
        const first = await world.create(base, { source: { kind: 'account', accountId }, value: 100, dueDate: '2026-10-15', repeat: { kind: 'installments', frequency: 'monthly', installments: 6, valueType: 'perInstallment' } });
        // A 2ª passa a vencer depois da 4ª.
        await world.edit(await occurrenceOf(world, first, 2), { dueDate: '2027-02-01' });

        await world.edit(await occurrenceOf(world, first, 4), { value: 200, scope: 'future' });
        expect((await series(world, first)).map((t) => [t.occurrence, t.value.amount]).sort((a, b) => Number(a[0]) - Number(b[0]))).toEqual([
            [1, 100], [2, 100], [3, 100], [4, 200], [5, 200], [6, 200],
        ]);

        await world.ok('transactions.delete', { id: (await occurrenceOf(world, first, 4)).id, scope: 'future' });
        expect((await series(world, first)).map((t) => t.occurrence).sort()).toEqual([1, 2, 3]);
        expect(await drifts(world)).toEqual([]);
    });

    it('duas ocorrências podem vencer no mesmo dia, e o complemento grava mesmo com a data ocupada', async () => {
        const { world, accountId, base } = setup();
        const first = await world.create(base, { source: { kind: 'account', accountId }, dueDate: '2026-10-05', repeat: { kind: 'fixed', frequency: 'monthly', endAt: null } });
        // A 13ª vai para a data da 14ª, que o complemento ainda não gravou.
        await world.edit(await occurrenceOf(world, first, 13), { dueDate: '2027-11-05' });
        expect((await world.edit(await occurrenceOf(world, first, 12), { dueDate: '2027-08-05' })).dueDate).toBe('2027-08-05');

        world.clock.set('2026-11-10');
        expect(await world.ok('recurrences.topUp', {})).toEqual({ emitted: 1, failures: [] });
        const sameDay = (await series(world, first)).filter((t) => t.dueDate === '2027-11-05');
        expect(sameDay.map((t) => t.occurrence)).toEqual([13, 14]);
        expect(await drifts(world)).toEqual([]);
    });

    it('escopo de série num lançamento avulso é recusado', async () => {
        const { world, accountId, base } = setup();
        const single = await world.create(base, { source: { kind: 'account', accountId } });
        const error = await world.failure('transactions.delete', { id: single.id, scope: 'future' });
        expect(error.details).toMatchObject({ rule: 'recurrence-scope-requires-series' });
    });
});

describe('mudar a quantidade de parcelas ou o término mantém a regra (database-design §4.12)', () => {
    it('reduzir apaga só as excedentes, mesmo pagas; aumentar só cria as novas; as outras ficam intactas', async () => {
        const { world, accountId, base } = setup();
        const repeat = { kind: 'installments', frequency: 'monthly', installments: 12, valueType: 'perInstallment' } as const;
        const first = await world.create(base, { source: { kind: 'account', accountId }, value: 100, dueDate: '2026-10-15', repeat });
        await world.ok('transactions.setPaid', { id: (await occurrenceOf(world, first, 10)).id, paid: true });
        await world.edit(await occurrenceOf(world, first, 3), { value: 150 });

        await world.edit(await occurrenceOf(world, first, 4), { scope: 'future', repeat: { ...repeat, installments: 8 } });
        expect((await series(world, first)).map((t) => [t.occurrence, t.value.amount])).toEqual([
            [1, 100], [2, 100], [3, 150], [4, 100], [5, 100], [6, 100], [7, 100], [8, 100],
        ]);
        expect((await world.ok('recurrences.list', { profileId: base.profileId }))[0]).toMatchObject({ installments: 8 });

        await world.edit(await occurrenceOf(world, first, 4), { scope: 'future', repeat: { ...repeat, installments: 10 } });
        const grown = await series(world, first);
        expect(grown.map((t) => t.occurrence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        // A 10ª volta como ocorrência nova: em aberto, pelo modelo.
        expect(grown.slice(-2).map((t) => [t.dueDate, t.value.amount, t.paid])).toEqual([['2027-06-15', 100, false], ['2027-07-15', 100, false]]);
        expect(await drifts(world)).toEqual([]);
    });

    it('a quantidade não fica abaixo da editada, e mudar a série só vale para "esta e as futuras"', async () => {
        const { world, accountId, base } = setup();
        const repeat = { kind: 'installments', frequency: 'monthly', installments: 6, valueType: 'perInstallment' } as const;
        const first = await world.create(base, { source: { kind: 'account', accountId }, value: 100, dueDate: '2026-10-15', repeat });
        const fourth = await occurrenceOf(world, first, 4);

        const below = await world.failure('transactions.update', { ...(await editInput(world, fourth)), scope: 'future', repeat: { ...repeat, installments: 3 } });
        expect(below.details).toMatchObject({ rule: 'recurrence-installments-below-occurrence' });
        const all = await world.failure('transactions.update', { ...(await editInput(world, fourth)), scope: 'all', repeat: { ...repeat, installments: 8 } });
        expect(all.details).toMatchObject({ rule: 'recurrence-change-requires-scope' });
        const single = await world.failure('transactions.update', { ...(await editInput(world, fourth)), repeat: { ...repeat, installments: 8 } });
        expect(single.details).toMatchObject({ rule: 'recurrence-change-requires-scope' });
    });

    it('encurtar o término apaga só as que passam do fim; estender recria até o horizonte', async () => {
        const { world, accountId, base } = setup();
        const first = await world.create(base, { source: { kind: 'account', accountId }, dueDate: '2026-10-05', repeat: { kind: 'fixed', frequency: 'monthly', endAt: null } });
        await world.edit(await occurrenceOf(world, first, 5), { name: 'Fevereiro' });

        await world.edit(await occurrenceOf(world, first, 3), { scope: 'future', repeat: { kind: 'fixed', frequency: 'monthly', endAt: '2027-02-28' } });
        expect((await series(world, first)).map((t) => [t.occurrence, t.name])).toEqual([
            [1, 'Lançamento'], [2, 'Lançamento'], [3, 'Lançamento'], [4, 'Lançamento'], [5, 'Fevereiro'],
        ]);
        expect((await world.ok('recurrences.list', { profileId: base.profileId }))[0]).toMatchObject({ endAt: '2027-02-28' });

        await world.edit(await occurrenceOf(world, first, 3), { scope: 'future', repeat: { kind: 'fixed', frequency: 'monthly', endAt: null } });
        const extended = await series(world, first);
        expect(extended.map((t) => t.occurrence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
        expect(extended.at(4)?.name).toBe('Fevereiro');
        expect(extended.at(-1)?.dueDate).toBe('2027-10-05');
        expect(await world.ok('recurrences.topUp', {})).toEqual({ emitted: 0, failures: [] });

        const before = await world.failure('transactions.update', { ...(await editInput(world, await occurrenceOf(world, first, 3))), scope: 'future', repeat: { kind: 'fixed', frequency: 'monthly', endAt: '2026-11-30' } });
        expect(before.details).toMatchObject({ rule: 'recurrence-end-before-occurrence' });
        expect(await drifts(world)).toEqual([]);
    });
});

describe('mudar a periodicidade ou o tipo começa uma regra nova (database-design §4.12)', () => {
    it('a diária que vira mensal encerra a antiga e grava a nova só até o horizonte, apagando as futuras pagas', async () => {
        const { world, accountId, base } = setup();
        const first = await world.create(base, { source: { kind: 'account', accountId }, dueDate: '2026-10-05', repeat: { kind: 'fixed', frequency: 'daily', endAt: null } });
        expect(await series(world, first)).toHaveLength(366);
        await world.ok('transactions.setPaid', { id: (await occurrenceOf(world, first, 10)).id, paid: true });

        const restarted = await world.edit(await occurrenceOf(world, first, 3), { scope: 'future', repeat: { kind: 'fixed', frequency: 'monthly', endAt: null } });
        expect(restarted.recurrenceId).not.toBe(first.recurrenceId);
        expect(restarted.occurrence).toBe(1);
        expect((await series(world, first)).map((t) => t.dueDate)).toEqual(['2026-10-05', '2026-10-06']);
        const fresh = await series(world, restarted);
        expect(fresh).toHaveLength(12);
        expect([fresh[0]?.dueDate, fresh.at(-1)?.dueDate]).toEqual(['2026-10-07', '2027-09-07']);
        expect(fresh.some((t) => t.paid)).toBe(false);
        const rules = await world.ok('recurrences.list', { profileId: base.profileId });
        expect(rules.find((r) => r.id === first.recurrenceId)).toMatchObject({ frequency: 'daily', endAt: '2026-10-06' });
        expect(rules.find((r) => r.id === restarted.recurrenceId)).toMatchObject({ frequency: 'monthly', endAt: null });
        expect(await world.ok('recurrences.topUp', {})).toEqual({ emitted: 0, failures: [] });
        expect(await drifts(world)).toEqual([]);
    });

    it('a parcelada que muda de periodicidade continua com as parcelas restantes', async () => {
        const { world, accountId, base } = setup();
        const repeat = { kind: 'installments', frequency: 'monthly', installments: 12, valueType: 'perInstallment' } as const;
        const first = await world.create(base, { source: { kind: 'account', accountId }, value: 100, dueDate: '2026-10-15', repeat });

        const restarted = await world.edit(await occurrenceOf(world, first, 3), { scope: 'future', repeat: { ...repeat, frequency: 'weekly' } });
        expect((await series(world, first)).map((t) => t.occurrence)).toEqual([1, 2]);
        const fresh = await series(world, restarted);
        expect(fresh.map((t) => t.dueDate).slice(0, 3)).toEqual(['2026-12-15', '2026-12-22', '2026-12-29']);
        expect(fresh).toHaveLength(10);
        const rules = await world.ok('recurrences.list', { profileId: base.profileId });
        expect(rules.find((r) => r.id === first.recurrenceId)).toMatchObject({ installments: 2 });
        expect(rules.find((r) => r.id === restarted.recurrenceId)).toMatchObject({ frequency: 'weekly', installments: 10, valueType: 'perInstallment', total: { amount: 1000, currency: 'BRL' } });
        expect(await drifts(world)).toEqual([]);
    });

    it('a fixa vira parcelada com a quantidade e a leitura do valor informadas, e a parcelada vira fixa', async () => {
        const { world, accountId, base } = setup();
        const fixed = await world.create(base, { source: { kind: 'account', accountId }, dueDate: '2026-10-05', repeat: { kind: 'fixed', frequency: 'monthly', endAt: null } });
        const purchase = await world.edit(await occurrenceOf(world, fixed, 3), { value: 1000, scope: 'future', repeat: { kind: 'installments', frequency: 'monthly', installments: 4, valueType: 'total' } });
        expect((await series(world, purchase)).map((t) => [t.occurrence, t.dueDate, t.value.amount])).toEqual([
            [1, '2026-12-05', 250], [2, '2027-01-05', 250], [3, '2027-02-05', 250], [4, '2027-03-05', 250],
        ]);
        expect((await world.ok('recurrences.list', { profileId: base.profileId })).find((r) => r.id === fixed.recurrenceId)).toMatchObject({ endAt: '2026-12-04' });

        const installments = await world.create(base, { source: { kind: 'account', accountId }, value: 100, dueDate: '2026-10-06', repeat: { kind: 'installments', frequency: 'monthly', installments: 6, valueType: 'perInstallment' } });
        const rent = await world.edit(await occurrenceOf(world, installments, 2), { scope: 'future', repeat: { kind: 'fixed', frequency: 'monthly', endAt: '2027-02-28' } });
        expect((await series(world, rent)).map((t) => t.dueDate)).toEqual(['2026-11-06', '2026-12-06', '2027-01-06', '2027-02-06']);
        expect((await world.ok('recurrences.list', { profileId: base.profileId })).find((r) => r.id === installments.recurrenceId)).toMatchObject({ installments: 1 });
        expect(await drifts(world)).toEqual([]);
    });

    it('recomeçar na 1ª ocorrência exclui a regra antiga', async () => {
        const { world, accountId, base } = setup();
        const first = await world.create(base, { source: { kind: 'account', accountId }, dueDate: '2026-10-05', repeat: { kind: 'fixed', frequency: 'monthly', endAt: null } });
        const restarted = await world.edit(first, { scope: 'future', repeat: { kind: 'fixed', frequency: 'weekly', endAt: '2026-10-26' } });
        expect((await series(world, restarted)).map((t) => t.dueDate)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
        expect((await world.ok('recurrences.list', { profileId: base.profileId })).map((r) => r.id)).toEqual([restarted.recurrenceId]);
        expect(await drifts(world)).toEqual([]);
    });
});

describe('excluir com escopo (database-design §4.12)', () => {
    it('"esta e as futuras" encerra a série; "todas" exclui a regra', async () => {
        const { world, accountId, base } = setup();
        const fixed = await world.create(base, { source: { kind: 'account', accountId }, dueDate: '2026-10-05', repeat: { kind: 'fixed', frequency: 'monthly', endAt: null } });
        await world.ok('transactions.setPaid', { id: fixed.id, paid: true });
        await world.ok('transactions.delete', { id: (await occurrenceOf(world, fixed, 3)).id, scope: 'future' });
        expect((await series(world, fixed)).map((t) => t.dueDate)).toEqual(['2026-10-05', '2026-11-05']);
        expect((await world.ok('recurrences.list', { profileId: base.profileId }))[0]).toMatchObject({ endAt: '2026-12-04' });
        world.clock.set('2027-03-01');
        expect(await world.ok('recurrences.topUp', {})).toEqual({ emitted: 0, failures: [] });

        const installments = await world.create(base, { source: { kind: 'account', accountId }, value: 300, dueDate: '2026-10-06', repeat: { kind: 'installments', frequency: 'monthly', installments: 3, valueType: 'total' } });
        await world.ok('transactions.delete', { id: (await occurrenceOf(world, installments, 2)).id, scope: 'future' });
        expect((await world.ok('recurrences.list', { profileId: base.profileId })).find((r) => r.id === installments.recurrenceId)).toMatchObject({ installments: 1 });

        await world.ok('transactions.delete', { id: fixed.id, scope: 'all' });
        expect(await series(world, installments)).toHaveLength(1);
        expect((await world.ok('recurrences.list', { profileId: base.profileId })).map((r) => r.id)).toEqual([installments.recurrenceId]);
        expect(await drifts(world)).toEqual([]);
    });
});

describe('cadeias que levam a regra junto (database-design §4.12)', () => {
    it('excluir a conta ou o cartão exclui a regra, e o alerta conta', async () => {
        const { world, accountId, creditCardId, base } = setup();
        await world.create(base, { source: { kind: 'creditCard', creditCardId }, dueDate: '2026-10-06', repeat: { kind: 'fixed', frequency: 'monthly', endAt: null } });
        expect((await world.ok('creditCards.deletionImpact', { id: creditCardId })).recurrences).toBe(1);
        await world.create(base, { source: { kind: 'account', accountId }, dueDate: '2026-10-05', repeat: { kind: 'fixed', frequency: 'monthly', endAt: null } });
        expect((await world.ok('accounts.deletionImpact', { id: accountId })).recurrences).toBe(2);

        await world.ok('accounts.delete', { id: accountId });
        expect(await world.ok('recurrences.list', { profileId: base.profileId })).toEqual([]);
        world.clock.set('2027-03-01');
        expect(await world.ok('recurrences.topUp', {})).toEqual({ emitted: 0, failures: [] });
    });

    it('mover a subcategoria move o modelo; excluir a tag a tira do modelo', async () => {
        const { world, profileId, accountId, base } = setup();
        const other = world.subCategory(profileId);
        const tag = await world.ok('tags.create', { profileId, name: 'casa' });
        const first = await world.create(base, { source: { kind: 'account', accountId }, dueDate: '2026-10-05', tagIds: [tag.id], repeat: { kind: 'fixed', frequency: 'monthly', endAt: null } });
        expect(first.tagIds).toEqual([tag.id]);

        await world.ok('subCategories.delete', { id: base.subCategoryId, moveTo: other });
        await world.ok('tags.delete', { id: tag.id });
        world.clock.set('2026-11-10');
        await world.ok('recurrences.topUp', {});
        expect((await series(world, first)).at(-1)).toMatchObject({ subCategoryId: other, tagIds: [] });
    });
});

describe('o fim da série segue o calendário, não a data gravada (database-design §4.12)', () => {
    it('"esta e as futuras" encerra na véspera da data do calendário, mesmo com a editada movida para depois', async () => {
        const { world, accountId, base } = setup();
        const first = await world.create(base, { source: { kind: 'account', accountId }, dueDate: '2026-10-10', repeat: { kind: 'fixed', frequency: 'monthly', endAt: null } });
        // A 3ª (10/12) vai para 20/01 em "somente esta" e depois é excluída com as futuras.
        const third = await world.edit(await occurrenceOf(world, first, 3), { dueDate: '2027-01-20' });
        await world.ok('transactions.delete', { id: third.id, scope: 'future' });
        expect((await world.ok('recurrences.list', { profileId: base.profileId }))[0]).toMatchObject({ endAt: '2026-12-09' });
        expect((await series(world, first)).map((t) => t.occurrence)).toEqual([1, 2]);
    });

    it('a editada movida para antes da 1ª não deixa o fim antes do início, e a série continua editável', async () => {
        const { world, accountId, base } = setup();
        const first = await world.create(base, { source: { kind: 'account', accountId }, dueDate: '2026-10-10', repeat: { kind: 'fixed', frequency: 'monthly', endAt: null } });
        const third = await world.edit(await occurrenceOf(world, first, 3), { dueDate: '2026-09-01' });
        await world.ok('transactions.delete', { id: third.id, scope: 'future' });
        expect((await world.ok('recurrences.list', { profileId: base.profileId }))[0]).toMatchObject({ endAt: '2026-12-09' });
        expect((await world.edit(first, { name: 'Aluguel', scope: 'all' })).name).toBe('Aluguel');
    });

    it('recomeçar a série encerra a antiga na véspera da data do calendário', async () => {
        const { world, accountId, base } = setup();
        const first = await world.create(base, { source: { kind: 'account', accountId }, dueDate: '2026-10-10', repeat: { kind: 'fixed', frequency: 'monthly', endAt: null } });
        const third = await world.edit(await occurrenceOf(world, first, 3), { dueDate: '2027-01-20' });
        await world.edit(third, { scope: 'future', repeat: { kind: 'fixed', frequency: 'weekly', endAt: '2027-02-10' } });
        expect((await world.ok('recurrences.list', { profileId: base.profileId })).find((r) => r.id === first.recurrenceId)).toMatchObject({ endAt: '2026-12-09' });
    });
});

describe('trocar o dia âncora não muda quais ocorrências a fixa com fim tem (database-design §4.12)', () => {
    it('o dia mais adiante leva o fim junto, e estender o término depois só cria as novas', async () => {
        const { world, accountId, base } = setup();
        const first = await world.create(base, { source: { kind: 'account', accountId }, dueDate: '2026-10-10', repeat: { kind: 'fixed', frequency: 'monthly', endAt: '2026-12-15' } });
        await world.edit(await occurrenceOf(world, first, 2), { dueDate: '2026-11-20', scope: 'future' });
        expect((await series(world, first)).map((t) => [t.occurrence, t.dueDate])).toEqual([[1, '2026-10-10'], [2, '2026-11-20'], [3, '2026-12-20']]);
        expect((await world.ok('recurrences.list', { profileId: base.profileId }))[0]).toMatchObject({ endAt: '2026-12-20' });

        await world.edit(await occurrenceOf(world, first, 3), { scope: 'future', repeat: { kind: 'fixed', frequency: 'monthly', endAt: '2027-02-28' } });
        expect((await series(world, first)).map((t) => [t.occurrence, t.dueDate])).toEqual([
            [1, '2026-10-10'], [2, '2026-11-20'], [3, '2026-12-20'], [4, '2027-01-20'], [5, '2027-02-20'],
        ]);
        expect(await drifts(world)).toEqual([]);
    });

    it('o dia mais cedo não traz a seguinte para dentro do fim', async () => {
        const { world, accountId, base } = setup();
        const first = await world.create(base, { source: { kind: 'account', accountId }, dueDate: '2026-10-20', repeat: { kind: 'fixed', frequency: 'monthly', endAt: '2026-12-15' } });
        await world.edit(await occurrenceOf(world, first, 2), { dueDate: '2026-11-05', scope: 'future' });
        expect((await series(world, first)).map((t) => t.occurrence)).toEqual([1, 2]);
        expect((await world.ok('recurrences.list', { profileId: base.profileId }))[0]).toMatchObject({ endAt: '2026-12-04' });
    });

    it('a única ocorrência pode ir para depois do fim sem a edição ser recusada', async () => {
        const { world, accountId, base } = setup();
        const only = await world.create(base, { source: { kind: 'account', accountId }, dueDate: '2026-10-10', repeat: { kind: 'fixed', frequency: 'monthly', endAt: '2026-10-10' } });
        expect((await world.edit(only, { dueDate: '2026-10-25', scope: 'all' })).dueDate).toBe('2026-10-25');
        expect((await world.ok('recurrences.list', { profileId: base.profileId }))[0]).toMatchObject({ endAt: '2026-10-25' });
    });
});

describe('o valor de um parcelamento que muda de tamanho (database-design §4.12)', () => {
    it('"esta e as futuras" excluída no "valor total" reduz o total às parcelas que ficam', async () => {
        const { world, accountId, base } = setup();
        const first = await world.create(base, { source: { kind: 'account', accountId }, value: 1200, dueDate: '2026-10-06', repeat: { kind: 'installments', frequency: 'monthly', installments: 12, valueType: 'total' } });
        await world.ok('transactions.delete', { id: (await occurrenceOf(world, first, 7)).id, scope: 'future' });
        expect((await world.ok('recurrences.list', { profileId: base.profileId }))[0]).toMatchObject({ installments: 6, valueType: 'total', total: { amount: 600 } });

        const odd = await world.create(base, { source: { kind: 'account', accountId }, value: 100, dueDate: '2026-10-06', repeat: { kind: 'installments', frequency: 'monthly', installments: 3, valueType: 'total' } });
        await world.ok('transactions.delete', { id: (await occurrenceOf(world, odd, 3)).id, scope: 'future' });
        expect((await world.ok('recurrences.list', { profileId: base.profileId })).find((r) => r.id === odd.recurrenceId)).toMatchObject({ installments: 2, total: { amount: 66.67 } });
    });

    it('as parcelas novas não herdam o resto do arredondamento da 1ª', async () => {
        const { world, accountId, base } = setup();
        const repeat = { kind: 'installments', frequency: 'monthly', installments: 3, valueType: 'total' } as const;
        const first = await world.create(base, { source: { kind: 'account', accountId }, value: 100, dueDate: '2026-10-06', repeat });
        await world.edit(first, { scope: 'future', repeat: { ...repeat, installments: 5 } });
        expect((await series(world, first)).map((t) => t.value.amount)).toEqual([33.34, 33.33, 33.33, 33.33, 33.33]);
    });

    it('as parcelas novas não herdam o valor dado à editada em "somente esta"; o valor alterado na tela, sim', async () => {
        const { world, accountId, base } = setup();
        const repeat = { kind: 'installments', frequency: 'monthly', installments: 3, valueType: 'perInstallment' } as const;
        const first = await world.create(base, { source: { kind: 'account', accountId }, value: 100, dueDate: '2026-10-06', repeat });
        const third = await world.edit(await occurrenceOf(world, first, 3), { value: 150 });
        await world.edit(third, { scope: 'future', repeat: { ...repeat, installments: 4 } });
        expect((await series(world, first)).map((t) => t.value.amount)).toEqual([100, 100, 150, 100]);

        await world.edit(await occurrenceOf(world, first, 4), { value: 120, scope: 'future', repeat: { ...repeat, installments: 5 } });
        expect((await series(world, first)).map((t) => t.value.amount)).toEqual([100, 100, 150, 120, 120]);
    });
});

describe('o complemento nunca impede a abertura por uma série (backend-design §4.5)', () => {
    it('um número já vivo acima da marca d\'água é pulado, e a marca avança', async () => {
        const { world, accountId, base } = setup();
        const first = await world.create(base, { source: { kind: 'account', accountId }, dueDate: '2026-10-05', repeat: { kind: 'fixed', frequency: 'monthly', endAt: null } });
        // Como se as linhas de outro aparelho tivessem chegado antes da marca d'água dele.
        world.database.run('UPDATE recurrences SET materialized_count = 10 WHERE id = :id', { id: first.recurrenceId });
        world.clock.set('2026-11-10');
        expect(await world.ok('recurrences.topUp', {})).toEqual({ emitted: 1, failures: [] });
        expect((await series(world, first)).map((t) => t.occurrence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
        expect(await world.ok('recurrences.topUp', {})).toEqual({ emitted: 0, failures: [] });
        expect(await drifts(world)).toEqual([]);
    });

    it('a série que falha entra no resultado e desfaz só ela; as outras são complementadas', async () => {
        const { world, accountId, base } = setup();
        const broken = await world.create(base, { source: { kind: 'account', accountId }, dueDate: '2026-10-05', repeat: { kind: 'fixed', frequency: 'monthly', endAt: null } });
        // Começa um dia depois do horizonte de hoje: nasce com 12 e o complemento emite a 13ª e a 14ª.
        const healthy = await world.create(base, { source: { kind: 'account', accountId }, dueDate: '2026-10-06', repeat: { kind: 'fixed', frequency: 'monthly', endAt: null } });
        // A regra perde a origem: a linha não pode mais ser lida.
        world.database.run('UPDATE recurrences SET account_id = NULL WHERE id = :id', { id: broken.recurrenceId });

        world.clock.set('2026-11-10');
        const outcome = await world.ok('recurrences.topUp', {});
        expect(outcome.emitted).toBe(2);
        expect(outcome.failures.map((failure) => [failure.recurrenceId, failure.error.code])).toEqual([[broken.recurrenceId, 'INTERNAL']]);
        expect(await series(world, healthy)).toHaveLength(14);
        // A regra quebrada não pode ser lida pelas rotas; as ocorrências dela, sim, pelo banco.
        expect(world.database.all('SELECT id FROM transactions WHERE recurrence_id = :id AND deleted_at IS NULL', { id: broken.recurrenceId })).toHaveLength(13);
        expect(await drifts(world)).toEqual([]);
    });
});

/**
 * @param world Núcleo do teste.
 * @param transaction Transação como está.
 * @return A entrada completa de `transactions.update` sem mudança nenhuma, para o teste sobrepor
 * só o que quer recusar.
 */
async function editInput(world: TestWorld, transaction: Transaction): Promise<CoreInput<'transactions.update'>> {
    const fresh = await world.ok('transactions.get', { id: transaction.id });
    const { container } = fresh;
    return {
        id: fresh.id,
        type: fresh.type,
        source: container.kind === 'statement' ? { kind: 'account', accountId: container.accountId } : { kind: 'creditCard', creditCardId: container.creditCardId, invoicePeriod: container.period },
        subCategoryId: fresh.subCategoryId,
        destinationAccountId: fresh.destinationAccountId,
        partnerId: fresh.partnerId,
        goalId: fresh.goalId,
        name: fresh.name,
        description: fresh.description,
        value: fresh.value.amount,
        charges: fresh.charges.amount,
        originCurrency: fresh.originCurrency,
        conversionRate: fresh.conversionRate,
        dueDate: fresh.dueDate,
        paymentDate: fresh.paymentDate,
        tagIds: [...fresh.tagIds],
    };
}
