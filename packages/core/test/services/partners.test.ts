import { describe, expect, it } from 'vitest';
import type { CoreInput, PartnerResponse } from '../../src/index.ts';
import { TestWorld } from '../support/TestWorld.ts';

/** O cenário do mockup `DesktopSocios`: o Estúdio GO, com Gustavo (60%) e Ana (40%). */
interface Scenario {
    readonly world: TestWorld;
    readonly profileId: string;
    readonly accountId: string;
    readonly subCategoryId: string;
    readonly gustavo: string;
    readonly ana: string;
}

/**
 * Hoje é 16/10/2026. Os sócios entram pela rota real, como o cadastro os grava.
 *
 * @return O mundo e os ids criados.
 */
async function scenario(): Promise<Scenario> {
    const world = new TestWorld('2026-10-16');
    const profileId = world.profile({ type: 'business' });
    const saved = await world.ok('partners.save', {
        profileId,
        partners: [
            { id: null, name: 'Gustavo', percentage: 60 },
            { id: null, name: 'Ana', percentage: 40 },
        ],
    });
    return {
        world,
        profileId,
        accountId: world.account(profileId, { openingBalance: 10000 }),
        subCategoryId: world.subCategory(profileId),
        gustavo: idOf(saved, 'Gustavo'),
        ana: idOf(saved, 'Ana'),
    };
}

/**
 * @param list Sócios devolvidos pela rota.
 * @param name Nome procurado.
 * @return O id do sócio com o nome; falha o teste quando ele não está na lista.
 */
function idOf(list: readonly PartnerResponse[], name: string): string {
    const found = list.find((partner) => partner.name === name);
    if (found === undefined) {
        throw new Error(`sócio ${name} fora da lista`);
    }
    return found.id;
}

/**
 * @param scene Cenário.
 * @param partnerId Sócio que aportou, ou `null`.
 * @param overrides Valor, datas e repetição; sem eles, uma receita de R$ 100,00 em outubro.
 * @return O id do lançamento criado.
 */
async function launch(scene: Scenario, partnerId: string | null, overrides: Partial<CoreInput<'transactions.create'>> = {}): Promise<string> {
    const created = await scene.world.create(
        { profileId: scene.profileId, subCategoryId: scene.subCategoryId },
        { source: { kind: 'account', accountId: scene.accountId }, type: 'income', partnerId, dueDate: '2026-10-14', ...overrides },
    );
    return created.id;
}

describe('cadastro de sócios (mockup DesktopSocios)', () => {
    it('lista pela participação, maior primeiro, com os aportes de cada um', async () => {
        const scene = await scenario();
        await launch(scene, scene.ana);
        await launch(scene, scene.ana);
        await launch(scene, null);

        const list = await scene.world.ok('partners.list', { profileId: scene.profileId });
        expect(list.map(({ name, percentage, transactionCount }) => ({ name, percentage, transactionCount }))).toEqual([
            { name: 'Gustavo', percentage: 60, transactionCount: 0 },
            { name: 'Ana', percentage: 40, transactionCount: 2 },
        ]);
    });

    it('perfil empresarial sem sócios devolve a lista vazia', async () => {
        const world = new TestWorld('2026-10-16');
        const profileId = world.profile({ type: 'business' });
        expect(await world.ok('partners.list', { profileId })).toEqual([]);
    });

    it('edita nome e participação e cria um sócio novo na mesma gravação', async () => {
        const scene = await scenario();
        const saved = await scene.world.ok('partners.save', {
            profileId: scene.profileId,
            partners: [
                { id: scene.gustavo, name: ' Gustavo Oliveira ', percentage: 50 },
                { id: scene.ana, name: 'Ana', percentage: 33.33 },
                { id: null, name: 'Bruno', percentage: 16.67 },
            ],
        });
        expect(saved.map(({ id, name, percentage }) => ({ id, name, percentage }))).toEqual([
            { id: scene.gustavo, name: 'Gustavo Oliveira', percentage: 50 },
            { id: scene.ana, name: 'Ana', percentage: 33.33 },
            { id: idOf(saved, 'Bruno'), name: 'Bruno', percentage: 16.67 },
        ]);
    });

    it('Regra de negócio (Sócios): a soma das participações precisa dar 100%, e nada é gravado quando não dá', async () => {
        const scene = await scenario();
        const short = await scene.world.failure('partners.save', {
            profileId: scene.profileId,
            partners: [
                { id: scene.gustavo, name: 'Gustavo', percentage: 60 },
                { id: scene.ana, name: 'Ana', percentage: 30 },
            ],
        });
        expect(short).toMatchObject({ code: 'BUSINESS_RULE_VIOLATION', details: { rule: 'partner-shares-not-100', field: 'percentage', total: 90 } });

        const over = await scene.world.failure('partners.save', {
            profileId: scene.profileId,
            partners: [
                { id: scene.gustavo, name: 'Gustavo', percentage: 60 },
                { id: scene.ana, name: 'Ana', percentage: 40 },
                { id: null, name: 'Bruno', percentage: 0.01 },
            ],
        });
        expect(over.details['total']).toBe(100.01);

        const list = await scene.world.ok('partners.list', { profileId: scene.profileId });
        expect(list.map((partner) => partner.percentage)).toEqual([60, 40]);
    });

    it('confere a soma em centésimos: três terços de 33,33 + 33,33 + 33,34 fecham 100%', async () => {
        const world = new TestWorld('2026-10-16');
        const profileId = world.profile({ type: 'business' });
        const saved = await world.ok('partners.save', {
            profileId,
            partners: [
                { id: null, name: 'A', percentage: 33.33 },
                { id: null, name: 'B', percentage: 33.33 },
                { id: null, name: 'C', percentage: 33.34 },
            ],
        });
        expect(saved).toHaveLength(3);
    });

    it('recusa participação fora de 0 a 100 ou com mais de duas casas decimais, e nome vazio ou com mais de 100 caracteres', async () => {
        const scene = await scenario();
        const save = (partners: CoreInput<'partners.save'>['partners']): ReturnType<TestWorld['failure']> => scene.world.failure('partners.save', { profileId: scene.profileId, partners });

        expect((await save([{ id: null, name: 'Gustavo', percentage: 100.5 }])).code).toBe('VALIDATION_FAILED');
        expect((await save([{ id: null, name: 'Gustavo', percentage: -1 }])).code).toBe('VALIDATION_FAILED');
        expect(await save([{ id: null, name: 'Gustavo', percentage: 33.333 }, { id: null, name: 'Ana', percentage: 66.667 }])).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'percentage' } });
        expect((await save([{ id: null, name: '   ', percentage: 100 }])).code).toBe('VALIDATION_FAILED');
        expect((await save([{ id: null, name: 'x'.repeat(101), percentage: 100 }])).code).toBe('VALIDATION_FAILED');
        expect((await scene.world.ok('partners.save', { profileId: scene.profileId, partners: [{ id: null, name: 'x'.repeat(100), percentage: 100 }] }))[0]?.name).toHaveLength(100);
    });

    it('nomes repetidos são permitidos: duas pessoas podem ter o mesmo nome', async () => {
        const world = new TestWorld('2026-10-16');
        const profileId = world.profile({ type: 'business' });
        const saved = await world.ok('partners.save', {
            profileId,
            partners: [
                { id: null, name: 'Ana', percentage: 50 },
                { id: null, name: 'Ana', percentage: 50 },
            ],
        });
        expect(new Set(saved.map((partner) => partner.id)).size).toBe(2);
    });

    it('Regra de negócio (Sócios): remover o sócio deixa os aportes e a série dele sem sócio, e eles continuam existindo', async () => {
        const scene = await scenario();
        const paid = await launch(scene, scene.ana, { value: 300 });
        const series = await scene.world.ok('transactions.create', {
            profileId: scene.profileId,
            subCategoryId: scene.subCategoryId,
            type: 'income',
            source: { kind: 'account', accountId: scene.accountId },
            partnerId: scene.ana,
            name: 'Aporte mensal',
            value: 1500,
            dueDate: '2026-10-05',
            repeat: { kind: 'fixed', frequency: 'monthly', endAt: null },
        });

        const saved = await scene.world.ok('partners.save', { profileId: scene.profileId, partners: [{ id: scene.gustavo, name: 'Gustavo', percentage: 100 }] });
        expect(saved.map((partner) => partner.id)).toEqual([scene.gustavo]);

        expect((await scene.world.ok('transactions.get', { id: paid })).partnerId).toBeNull();
        const occurrences = await scene.world.ok('recurrences.occurrences', { recurrenceId: series.recurrenceId ?? '' });
        expect(occurrences.length).toBeGreaterThan(1);
        expect(occurrences.every((occurrence) => occurrence.partnerId === null)).toBe(true);
        expect(scene.world.database.get('SELECT partner_id FROM recurrences WHERE id = :id', { id: series.recurrenceId ?? '' })).toEqual({ partner_id: null });

        // O lançamento sem sócio continua editável, e o relatório o mostra como sem sócio.
        await scene.world.ok('transactions.update', { ...(await scene.world.editInput(paid)), value: 310 });
        const report = await scene.world.ok('reports.byPartner', { profileId: scene.profileId, period: '2026-10' });
        expect(report.unassignedCount).toBe(2);
    });

    it('remover todos os sócios é permitido: sem sócio não há o que dividir', async () => {
        const scene = await scenario();
        expect(await scene.world.ok('partners.save', { profileId: scene.profileId, partners: [] })).toEqual([]);
    });

    it('o sócio removido não volta pelo id: mandá-lo de novo é NOT_FOUND', async () => {
        const scene = await scenario();
        await scene.world.ok('partners.save', { profileId: scene.profileId, partners: [{ id: scene.gustavo, name: 'Gustavo', percentage: 100 }] });
        const failure = await scene.world.failure('partners.save', {
            profileId: scene.profileId,
            partners: [
                { id: scene.gustavo, name: 'Gustavo', percentage: 60 },
                { id: scene.ana, name: 'Ana', percentage: 40 },
            ],
        });
        expect(failure).toMatchObject({ code: 'NOT_FOUND', details: { entity: 'Partner' } });
    });

    it('recusa o sócio de outro perfil, o mesmo id duas vezes e o perfil pessoal', async () => {
        const scene = await scenario();
        const other = scene.world.profile({ type: 'business' });
        const stranger = scene.world.partner(other);
        expect((await scene.world.failure('partners.save', { profileId: scene.profileId, partners: [{ id: stranger, name: 'Estranho', percentage: 100 }] })).code).toBe('NOT_FOUND');

        const twice = await scene.world.failure('partners.save', {
            profileId: scene.profileId,
            partners: [
                { id: scene.gustavo, name: 'Gustavo', percentage: 50 },
                { id: scene.gustavo, name: 'Gustavo', percentage: 50 },
            ],
        });
        expect(twice.code).toBe('VALIDATION_FAILED');

        const personal = scene.world.profile();
        expect((await scene.world.failure('partners.list', { profileId: personal })).details['rule']).toBe('partner-requires-business-profile');
        expect((await scene.world.failure('partners.save', { profileId: personal, partners: [] })).details['rule']).toBe('partner-requires-business-profile');
    });

    it('não regrava o sócio que não mudou', async () => {
        const scene = await scenario();
        const before = scene.world.database.get('SELECT updated_at FROM partners WHERE id = :id', { id: scene.gustavo });
        scene.world.clock.set('2026-10-17');
        await scene.world.ok('partners.save', {
            profileId: scene.profileId,
            partners: [
                { id: scene.gustavo, name: 'Gustavo', percentage: 60 },
                { id: scene.ana, name: 'Ana Paula', percentage: 40 },
            ],
        });
        expect(scene.world.database.get('SELECT updated_at FROM partners WHERE id = :id', { id: scene.gustavo })).toEqual(before);
        expect(scene.world.database.get('SELECT updated_at FROM partners WHERE id = :id', { id: scene.ana })).not.toEqual(before);
    });

    it('a nova participação vale para a divisão do relatório por sócio', async () => {
        const scene = await scenario();
        await launch(scene, scene.gustavo, { value: 1000 });
        await scene.world.ok('partners.save', {
            profileId: scene.profileId,
            partners: [
                { id: scene.gustavo, name: 'Gustavo', percentage: 25 },
                { id: scene.ana, name: 'Ana', percentage: 75 },
            ],
        });
        const report = await scene.world.ok('reports.byPartner', { profileId: scene.profileId, period: '2026-10' });
        expect(report.partners.map((line) => [line.name, line.expected.amount])).toEqual([
            ['Ana', 750],
            ['Gustavo', 250],
        ]);
    });
});
