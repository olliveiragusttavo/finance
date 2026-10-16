import { describe, expect, it } from 'vitest';
import type { CoreInput, PartnerLineResponse, PartnerReportResponse } from '../../src/index.ts';
import { TestWorld } from '../support/TestWorld.ts';

/** O cenário do exemplo de aportes: a empresa, com Matheus (60%) e Gustavo (40%). */
interface Scenario {
    readonly world: TestWorld;
    readonly profileId: string;
    readonly accountId: string;
    readonly card: string;
    readonly subCategoryId: string;
    readonly matheus: string;
    readonly gustavo: string;
    /** Perfil pessoal com a mesma moeda, de onde saem as transferências para a empresa. */
    readonly personalId: string;
    readonly personalAccountId: string;
    readonly personalSubCategoryId: string;
}

/**
 * Hoje é 03/10/2026.
 *
 * @return O mundo e os ids semeados.
 */
function scenario(): Scenario {
    const world = new TestWorld('2026-10-03');
    const profileId = world.profile({ type: 'business' });
    const accountId = world.account(profileId, { openingBalance: 10000 });
    const personalId = world.profile();
    return {
        world,
        profileId,
        accountId,
        card: world.creditCard(profileId, accountId, 28, 10),
        subCategoryId: world.subCategory(profileId),
        matheus: world.partner(profileId, { name: 'Matheus', percentage: 60 }),
        gustavo: world.partner(profileId, { name: 'Gustavo', percentage: 40 }),
        personalId,
        personalAccountId: world.account(personalId, { openingBalance: 50000 }),
        personalSubCategoryId: world.subCategory(personalId),
    };
}

/**
 * Lança no perfil empresarial; sem tipo, uma receita de outubro.
 *
 * @param scene Cenário.
 * @param partnerId Sócio que aportou, ou `null`.
 * @param overrides Tipo, origem, valor e datas.
 * @return O id do lançamento.
 */
async function launch(scene: Scenario, partnerId: string | null, overrides: Partial<CoreInput<'transactions.create'>> = {}): Promise<string> {
    const created = await scene.world.create(
        { profileId: scene.profileId, subCategoryId: scene.subCategoryId },
        { source: { kind: 'account', accountId: scene.accountId }, type: 'income', partnerId, dueDate: '2026-10-14', ...overrides },
    );
    return created.id;
}

/**
 * Transfere da conta pessoal para a conta da empresa — o aporte que sai do bolso do sócio.
 *
 * @param scene Cenário.
 * @param partnerId Sócio da empresa que aportou, ou `null`.
 * @param overrides Valor, encargos e datas.
 * @return O id da transferência, uma linha do perfil pessoal.
 */
async function transferIn(scene: Scenario, partnerId: string | null, overrides: Partial<CoreInput<'transactions.create'>> = {}): Promise<string> {
    const created = await scene.world.create(
        { profileId: scene.personalId, subCategoryId: scene.personalSubCategoryId },
        { source: { kind: 'account', accountId: scene.personalAccountId }, type: 'transference', destinationAccountId: scene.accountId, partnerId, dueDate: '2026-10-14', ...overrides },
    );
    return created.id;
}

/**
 * @param scene Cenário.
 * @param period Mês de referência.
 * @return O relatório pela rota real.
 */
async function report(scene: Scenario, period = '2026-10'): Promise<PartnerReportResponse> {
    return scene.world.ok('reports.byPartner', { profileId: scene.profileId, period });
}

/**
 * @param result Relatório.
 * @param partnerId Sócio procurado.
 * @return A linha do sócio.
 * @throws {Error} Quando o sócio não está no relatório — todo sócio vivo deveria estar.
 */
function line(result: PartnerReportResponse, partnerId: string): PartnerLineResponse {
    const found = result.partners.find((candidate) => candidate.partnerId === partnerId);
    if (found === undefined) {
        throw new Error(`sócio ${partnerId} fora do relatório`);
    }
    return found;
}

describe('Por sócio — aportes (reports-design §8)', () => {
    it('Matheus (60%) e Gustavo (40%) aportaram R$ 1.000,00 cada: Matheus deveria R$ 1.200,00, Gustavo R$ 800,00', async () => {
        const scene = scenario();
        await launch(scene, scene.matheus, { value: 1000 });
        await transferIn(scene, scene.gustavo, { value: 1000 });

        const result = await report(scene);

        expect(result.contributions).toEqualMoney('2000');
        expect(result.partners.map((partner) => partner.name)).toEqual(['Matheus', 'Gustavo']);
        expect(line(result, scene.matheus)).toMatchObject({ share: 0.6, count: 1 });
        expect(line(result, scene.matheus).contributed).toEqualMoney('1000');
        expect(line(result, scene.matheus).expected).toEqualMoney('1200');
        expect(line(result, scene.matheus).difference).toEqualMoney('-200');
        expect(line(result, scene.gustavo).expected).toEqualMoney('800');
        expect(line(result, scene.gustavo).difference).toEqualMoney('200');
        expect(result.settlements).toHaveLength(1);
        expect(result.settlements[0]).toMatchObject({ fromPartnerId: scene.matheus, toPartnerId: scene.gustavo });
        expect(result.settlements[0]?.amount).toEqualMoney('200');
    });

    it('Regra de negócio (P1): os aportes de todos os períodos somam, e o mês só recorta os números do mês', async () => {
        const scene = scenario();
        await launch(scene, scene.matheus, { value: 500, dueDate: '2025-02-10' });
        await launch(scene, scene.matheus, { value: 700, dueDate: '2026-10-05' });
        await launch(scene, scene.gustavo, { value: 800, dueDate: '2027-01-05' });

        for (const period of ['2025-02', '2026-10', '2027-01']) {
            const result = await report(scene, period);
            expect(result.contributions).toEqualMoney('2000');
            expect(line(result, scene.matheus).contributed).toEqualMoney('1200');
        }
        const october = await report(scene, '2026-10');
        expect(october.monthContributions).toEqualMoney('700');
        expect(october.monthContributionCount).toBe(1);
    });

    it('Regra de negócio (P2): receita de serviço sem sócio é lucro e fica fora da divisão; despesas e transferências internas não entram', async () => {
        const scene = scenario();
        const savings = scene.world.account(scene.profileId, { name: 'Reserva' });
        await launch(scene, scene.matheus, { value: 1000 });
        await launch(scene, null, { value: 4000, name: 'Projeto do cliente' });
        await launch(scene, null, { type: 'expense', value: 300 });
        await launch(scene, null, { type: 'transference', destinationAccountId: savings, value: 700 });

        const result = await report(scene);

        expect(result.contributions).toEqualMoney('1000');
        expect(result.unassigned).toEqualMoney('4000');
        expect(result.unassignedCount).toBe(1);
    });

    it('a receita vale o que entrou no saldo (sem os encargos); a transferência, o valor que chega', async () => {
        const scene = scenario();
        await launch(scene, scene.matheus, { value: 1000, charges: 12.5 });
        await transferIn(scene, scene.gustavo, { value: 500, charges: 3 });
        await launch(scene, scene.matheus, { value: -100, name: 'Devolução' });

        const result = await report(scene);

        expect(line(result, scene.matheus).contributed).toEqualMoney('887.5');
        expect(line(result, scene.gustavo).contributed).toEqualMoney('500');
    });

    it('a despesa com sócio gravada antes dos aportes não conta como aporte', async () => {
        const scene = scenario();
        const legacy = await launch(scene, null, { type: 'expense', value: 900 });
        scene.world.database.run('UPDATE transactions SET partner_id = :partnerId WHERE id = :id', { partnerId: scene.matheus, id: legacy });

        const result = await report(scene);

        expect(result.contributions).toEqualMoney('0');
        expect(result.unassignedCount).toBe(0);
    });

    it('sócio sem aporte aparece com zero, e o perfil sem sócio tem tudo fora da divisão', async () => {
        const scene = scenario();
        await launch(scene, scene.matheus, { value: 100 });
        expect(line(await report(scene), scene.gustavo).contributed).toEqualMoney('0');

        const empty = scene.world.profile({ type: 'business' });
        const account = scene.world.account(empty);
        await scene.world.create({ profileId: empty, subCategoryId: scene.world.subCategory(empty) }, { source: { kind: 'account', accountId: account }, type: 'income', value: 80, dueDate: '2026-10-02' });
        const solo = await scene.world.ok('reports.byPartner', { profileId: empty, period: '2026-10' });
        expect(solo.partners).toEqual([]);
        expect(solo.unassigned).toEqualMoney('80');
        expect(solo.settlements).toEqual([]);
    });

    it('aporte de um sócio excluído volta para "sem sócio"', async () => {
        const scene = scenario();
        await launch(scene, scene.gustavo, { value: 300 });
        scene.world.database.run('UPDATE partners SET deleted_at = :now WHERE id = :id', { id: scene.gustavo, now: scene.world.clock.now() });

        const result = await report(scene);

        expect(result.partners.map((partner) => partner.partnerId)).toEqual([scene.matheus]);
        expect(result.contributions).toEqualMoney('0');
        expect(result.unassigned).toEqualMoney('300');
    });
});

describe('Por sócio — divisão e acerto (P3, P4)', () => {
    it('a sobra do arredondamento vai para um sócio, e a divisão soma exatamente a base', async () => {
        const world = new TestWorld('2026-10-03');
        const profileId = world.profile({ type: 'business' });
        const accountId = world.account(profileId);
        const subCategoryId = world.subCategory(profileId);
        const ids = ['Ana', 'Bruno', 'Carla'].map((name) => world.partner(profileId, { name, percentage: 100 / 3 }));
        await world.create({ profileId, subCategoryId }, { source: { kind: 'account', accountId }, type: 'income', partnerId: ids[0] ?? null, value: 100, dueDate: '2026-10-02' });

        const result = await world.ok('reports.byPartner', { profileId, period: '2026-10' });

        expect(result.partners.map((partner) => partner.expected.amount)).toEqual([33.34, 33.33, 33.33]);
        expect(result.settlements.map((settlement) => settlement.amount.amount)).toEqual([33.33, 33.33]);
    });

    it('com três sócios, quem aportou a menos repõe cada um que aportou a mais', async () => {
        const world = new TestWorld('2026-10-03');
        const profileId = world.profile({ type: 'business' });
        const accountId = world.account(profileId);
        const subCategoryId = world.subCategory(profileId);
        const a = world.partner(profileId, { name: 'A', percentage: 50 });
        const b = world.partner(profileId, { name: 'B', percentage: 30 });
        const c = world.partner(profileId, { name: 'C', percentage: 20 });
        const base = { profileId, subCategoryId };
        await world.create(base, { source: { kind: 'account', accountId }, type: 'income', partnerId: b, value: 600, dueDate: '2026-10-02' });
        await world.create(base, { source: { kind: 'account', accountId }, type: 'income', partnerId: c, value: 400, dueDate: '2026-10-02' });

        const result = await world.ok('reports.byPartner', { profileId, period: '2026-10' });

        expect(result.settlements.map((settlement) => [settlement.fromPartnerId, settlement.toPartnerId, settlement.amount.amount])).toEqual([
            [a, b, 300],
            [a, c, 200],
        ]);
    });

    it('participações que não somam 100% não sugerem acerto', async () => {
        const world = new TestWorld('2026-10-03');
        const profileId = world.profile({ type: 'business' });
        const accountId = world.account(profileId);
        const subCategoryId = world.subCategory(profileId);
        const a = world.partner(profileId, { name: 'A', percentage: 50 });
        world.partner(profileId, { name: 'B', percentage: 40 });
        await world.create({ profileId, subCategoryId }, { source: { kind: 'account', accountId }, type: 'income', partnerId: a, value: 1000, dueDate: '2026-10-02' });

        const result = await world.ok('reports.byPartner', { profileId, period: '2026-10' });

        expect(result.sharesTotal).toBeCloseTo(0.9);
        expect(result.partners.map((partner) => partner.expected.amount)).toEqual([500, 400]);
        expect(result.settlements).toEqual([]);
    });

    it('aportes equilibrados não têm acerto', async () => {
        const scene = scenario();
        await launch(scene, scene.matheus, { value: 600 });
        await launch(scene, scene.gustavo, { value: 400 });

        expect((await report(scene)).settlements).toEqual([]);
    });
});

describe('Por sócio — entradas sem sócio (P5)', () => {
    it('a lista traz receitas e transferências vindas de outro perfil do mês, soma o indicador e perde a entrada atribuída', async () => {
        const scene = scenario();
        await launch(scene, scene.matheus, { value: 1000 });
        const service = await launch(scene, null, { value: 4000, name: 'Projeto do cliente' });
        const pix = await transferIn(scene, null, { value: 500, name: 'Pix do Gustavo' });
        await launch(scene, null, { value: 90, dueDate: '2026-09-05' });
        await launch(scene, null, { type: 'expense', value: 60 });
        const input = { profileId: scene.profileId, period: '2026-10' };

        const list = await scene.world.ok('reports.entriesWithoutPartner', input);
        expect(list.transactions.map((transaction) => transaction.id).sort()).toEqual([service, pix].sort());
        expect(list.total).toEqualMoney('4500');
        expect((await report(scene)).unassigned).toEqualMoney('4500');

        const assigned = await scene.world.ok('transactions.setPartner', { id: pix, partnerId: scene.gustavo });
        expect(assigned.partnerId).toBe(scene.gustavo);
        expect((await scene.world.ok('reports.entriesWithoutPartner', input)).total).toEqualMoney('4000');
        expect(line(await report(scene), scene.gustavo).contributed).toEqualMoney('500');
    });

    it('perfil pessoal não tem relatório por sócio', async () => {
        const world = new TestWorld('2026-10-03');
        const profileId = world.profile();

        expect((await world.failure('reports.byPartner', { profileId, period: '2026-10' })).details['rule']).toBe('partner-requires-business-profile');
        expect((await world.failure('reports.entriesWithoutPartner', { profileId, period: '2026-10' })).details['rule']).toBe('partner-requires-business-profile');
    });
});

describe('Onde o sócio pode ser vinculado (TransactionComposer.assertPartner)', () => {
    it('receita do perfil empresarial e transferência de outro perfil para ele aceitam o sócio no lançamento', async () => {
        const scene = scenario();
        await launch(scene, scene.matheus, { value: 10 });
        const transfer = await transferIn(scene, scene.gustavo, { value: 20 });
        expect((await scene.world.ok('transactions.get', { id: transfer })).partnerId).toBe(scene.gustavo);
    });

    it('Regra de negócio (Sócios): despesa, investimento e transferência interna recusam sócio novo', async () => {
        const scene = scenario();
        const savings = scene.world.account(scene.profileId, { name: 'Reserva' });
        const base = { profileId: scene.profileId, subCategoryId: scene.subCategoryId };
        const source = { kind: 'account', accountId: scene.accountId } as const;

        for (const overrides of [{ type: 'expense' }, { type: 'investment', destinationAccountId: savings }, { type: 'transference', destinationAccountId: savings }] as const) {
            const result = await scene.world.core.call('transactions.create', { ...base, source, name: 'X', value: 10, dueDate: '2026-10-02', partnerId: scene.matheus, ...overrides });
            expect(result.ok ? null : result.error.details).toMatchObject({ rule: 'partner-requires-contribution', field: 'partnerId' });
        }
    });

    it('transferência para um perfil pessoal e receita de perfil pessoal recusam sócio', async () => {
        const scene = scenario();
        const otherPersonal = scene.world.profile();
        const otherAccount = scene.world.account(otherPersonal);
        const toPersonal = await scene.world.core.call('transactions.create', {
            profileId: scene.personalId,
            subCategoryId: scene.personalSubCategoryId,
            type: 'transference',
            source: { kind: 'account', accountId: scene.personalAccountId },
            destinationAccountId: otherAccount,
            name: 'X',
            value: 10,
            dueDate: '2026-10-02',
            partnerId: scene.matheus,
        });
        expect(toPersonal.ok ? null : toPersonal.error.details['rule']).toBe('partner-requires-business-profile');

        const income = await scene.world.core.call('transactions.create', {
            profileId: scene.personalId,
            subCategoryId: scene.personalSubCategoryId,
            type: 'income',
            source: { kind: 'account', accountId: scene.personalAccountId },
            name: 'X',
            value: 10,
            dueDate: '2026-10-02',
            partnerId: scene.matheus,
        });
        expect(income.ok ? null : income.error.details['rule']).toBe('partner-requires-business-profile');
    });

    it('na transferência entre perfis o sócio é do perfil de destino: sócio de outra empresa é recusado', async () => {
        const scene = scenario();
        const other = scene.world.profile({ type: 'business' });
        const stranger = scene.world.partner(other);
        const result = await scene.world.core.call('transactions.create', {
            profileId: scene.personalId,
            subCategoryId: scene.personalSubCategoryId,
            type: 'transference',
            source: { kind: 'account', accountId: scene.personalAccountId },
            destinationAccountId: scene.accountId,
            name: 'X',
            value: 10,
            dueDate: '2026-10-02',
            partnerId: stranger,
        });
        expect(result.ok ? null : result.error.details['rule']).toBe('reference-outside-profile');
    });

    it('a despesa antiga com sócio continua editável sem perder o sócio, mas não ganha outro', async () => {
        const scene = scenario();
        const legacy = await launch(scene, null, { type: 'expense', value: 900 });
        scene.world.database.run('UPDATE transactions SET partner_id = :partnerId WHERE id = :id', { partnerId: scene.matheus, id: legacy });

        const edited = await scene.world.ok('transactions.update', { ...(await scene.world.editInput(legacy)), value: 950 });
        expect(edited.partnerId).toBe(scene.matheus);

        const swapped = await scene.world.failure('transactions.update', { ...(await scene.world.editInput(legacy)), partnerId: scene.gustavo });
        expect(swapped.details['rule']).toBe('partner-requires-contribution');
        expect((await scene.world.failure('transactions.setPartner', { id: legacy, partnerId: scene.gustavo })).details['rule']).toBe('partner-requires-contribution');
        expect((await scene.world.ok('transactions.setPartner', { id: legacy, partnerId: null })).partnerId).toBeNull();
    });
});

describe('Atribuir o sócio (transactions.setPartner)', () => {
    it('vale só para a ocorrência escolhida de uma série, e `null` tira a atribuição', async () => {
        const scene = scenario();
        const first = await scene.world.ok('transactions.create', {
            profileId: scene.profileId,
            subCategoryId: scene.subCategoryId,
            type: 'income',
            source: { kind: 'account', accountId: scene.accountId },
            name: 'Pró-labore investido',
            value: 1500,
            dueDate: '2026-10-05',
            repeat: { kind: 'fixed', frequency: 'monthly', endAt: null },
        });
        await scene.world.ok('transactions.setPartner', { id: first.id, partnerId: scene.gustavo });

        const occurrences = await scene.world.ok('recurrences.occurrences', { recurrenceId: first.recurrenceId ?? '' });
        expect(occurrences.filter((occurrence) => occurrence.partnerId !== null).map((occurrence) => occurrence.id)).toEqual([first.id]);

        expect((await scene.world.ok('transactions.setPartner', { id: first.id, partnerId: null })).partnerId).toBeNull();
        expect((await report(scene)).unassigned).toEqualMoney('1500');
    });

    it('recusa o sócio de outro perfil', async () => {
        const scene = scenario();
        const income = await launch(scene, null, { value: 10 });
        const other = scene.world.profile({ type: 'business' });
        const stranger = scene.world.partner(other);

        expect((await scene.world.failure('transactions.setPartner', { id: income, partnerId: stranger })).details['rule']).toBe('reference-outside-profile');
    });
});
