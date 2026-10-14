import { describe, expect, it } from 'vitest';
import type { CoreInput, TagReportRange, TagReportResponse, TagSummaryResponse } from '../../src/index.ts';
import { TestWorld } from '../support/TestWorld.ts';

/** O cenário do mockup `DesktopRelTag`: uma conta, um cartão e as categorias de uma viagem. */
interface Scenario {
    readonly world: TestWorld;
    readonly profileId: string;
    readonly accountId: string;
    /** Fecha no dia 28 e vence no dia 10: a compra de 05/09 pesa em outubro. */
    readonly card: string;
    readonly transport: { readonly categoryId: string; readonly subCategoryId: string };
    readonly shopping: { readonly categoryId: string; readonly subCategoryId: string };
    readonly refunds: { readonly categoryId: string; readonly subCategoryId: string };
    readonly trip: string;
    readonly refundable: string;
}

/**
 * Hoje é 03/10/2026.
 *
 * @return O mundo e os ids semeados.
 */
async function scenario(): Promise<Scenario> {
    const world = new TestWorld('2026-10-03');
    const profileId = world.profile();
    const accountId = world.account(profileId, { openingBalance: 10000 });
    return {
        world,
        profileId,
        accountId,
        card: world.creditCard(profileId, accountId, 28, 10),
        transport: world.namedSubCategory(profileId, 'Transporte', 'Aplicativo'),
        shopping: world.namedSubCategory(profileId, 'Compras', 'Roupas'),
        refunds: world.namedSubCategory(profileId, 'Reembolsos', 'Empresa'),
        trip: (await world.ok('tags.create', { profileId, name: 'viagem-floripa' })).id,
        refundable: (await world.ok('tags.create', { profileId, name: 'reembolsável' })).id,
    };
}

/**
 * @param scene Cenário.
 * @param subCategoryId Subcategoria do lançamento.
 * @param tagIds Tags do lançamento.
 * @param overrides Origem, tipo, valor e datas; sem origem, a conta; sem `paymentDate`, em aberto.
 * @return void
 */
async function launch(scene: Scenario, subCategoryId: string, tagIds: readonly string[], overrides: Partial<CoreInput<'transactions.create'>>): Promise<void> {
    await scene.world.create(
        { profileId: scene.profileId, subCategoryId },
        { source: { kind: 'account', accountId: scene.accountId }, tagIds: [...tagIds], ...overrides },
    );
}

/**
 * @param scene Cenário.
 * @param range Período pedido.
 * @param period Mês de referência.
 * @return O relatório pela rota real.
 */
async function report(scene: Scenario, range: TagReportRange = 'all', period = '2026-10'): Promise<TagReportResponse> {
    return scene.world.ok('reports.byTag', { profileId: scene.profileId, period, range });
}

/**
 * @param result Relatório.
 * @param tagId Tag procurada.
 * @return A linha da tag, ou `undefined` quando ela não tem lançamento no período.
 */
function tag(result: TagReportResponse, tagId: string): TagSummaryResponse | undefined {
    return result.tags.find((candidate) => candidate.tagId === tagId);
}

describe('Por tag — período (T1)', () => {
    it('compra no cartão conta no mês do pagamento da fatura, e não no da compra', async () => {
        const scene = await scenario();
        await launch(scene, scene.transport.subCategoryId, [scene.trip], { source: { kind: 'creditCard', creditCardId: scene.card }, value: 620, dueDate: '2026-09-05' });

        expect(tag(await report(scene, 'month', '2026-09'), scene.trip)).toBeUndefined();
        expect(tag(await report(scene, 'month', '2026-10'), scene.trip)?.net).toEqualMoney('620');
    });

    it('"todo o período" inclui o futuro, e o intervalo vai do primeiro ao último mês', async () => {
        const scene = await scenario();
        await launch(scene, scene.transport.subCategoryId, [scene.trip], { value: 620, dueDate: '2026-09-15', paymentDate: '2026-09-15' });
        await launch(scene, scene.shopping.subCategoryId, [scene.trip], { value: 400, dueDate: '2026-12-15' });

        const month = tag(await report(scene, 'month'), scene.trip);
        expect(month).toBeUndefined();
        const all = tag(await report(scene, 'all'), scene.trip);
        expect(all?.net).toEqualMoney('1020');
        expect(all?.count).toBe(2);
        expect(all?.firstPeriod).toBe('2026-09');
        expect(all?.lastPeriod).toBe('2026-12');
    });
});

describe('Por tag — total líquido (T2, T4)', () => {
    it('despesas menos receitas: o reembolso abate o gasto, e a categoria da receita fica sem participação', async () => {
        const scene = await scenario();
        await launch(scene, scene.transport.subCategoryId, [scene.refundable], { value: 500, dueDate: '2026-10-02', paymentDate: '2026-10-02' });
        await launch(scene, scene.refunds.subCategoryId, [scene.refundable], { type: 'income', value: 200, dueDate: '2026-10-20', paymentDate: '2026-10-20' });

        const summary = tag(await report(scene, 'month'), scene.refundable);
        expect(summary?.expense).toEqualMoney('500');
        expect(summary?.income).toEqualMoney('200');
        expect(summary?.net).toEqualMoney('300');
        expect(summary?.categories.map((category) => [category.name, category.share])).toEqual([
            ['Transporte', 1],
            ['Reembolsos', null],
        ]);
        expect(summary?.categories[1]?.net).toEqualMoney('-200');
    });

    it('estorno abate a despesa e os encargos entram (R2, R3); a tarifa da receita a reduz', async () => {
        const scene = await scenario();
        await launch(scene, scene.shopping.subCategoryId, [scene.trip], { value: 300, charges: 4.5, dueDate: '2026-10-02', paymentDate: '2026-10-02' });
        await launch(scene, scene.shopping.subCategoryId, [scene.trip], { value: -100, dueDate: '2026-10-03', paymentDate: '2026-10-03' });
        await launch(scene, scene.refunds.subCategoryId, [scene.trip], { type: 'income', value: 50, charges: 1, dueDate: '2026-10-04', paymentDate: '2026-10-04' });

        const summary = tag(await report(scene, 'month'), scene.trip);
        expect(summary?.expense).toEqualMoney('204.5');
        expect(summary?.income).toEqualMoney('49');
        expect(summary?.net).toEqualMoney('155.5');
        expect(summary?.count).toBe(3);
    });

    it('transferência com a tag fica fora', async () => {
        const scene = await scenario();
        const savings = scene.world.account(scene.profileId);
        await launch(scene, scene.transport.subCategoryId, [scene.trip], { type: 'transference', destinationAccountId: savings, value: 1000, dueDate: '2026-10-02', paymentDate: '2026-10-02' });

        expect(tag(await report(scene), scene.trip)).toBeUndefined();
    });

    it('participação de cada categoria sobre o gasto líquido da tag, maior primeiro', async () => {
        const scene = await scenario();
        const food = scene.world.namedSubCategory(scene.profileId, 'Alimentação', 'Restaurante');
        await launch(scene, scene.transport.subCategoryId, [scene.trip], { value: 620, dueDate: '2026-10-02', paymentDate: '2026-10-02' });
        await launch(scene, food.subCategoryId, [scene.trip], { value: 380, dueDate: '2026-10-02', paymentDate: '2026-10-02' });
        await launch(scene, scene.shopping.subCategoryId, [scene.trip], { value: 400, dueDate: '2026-10-02', paymentDate: '2026-10-02' });

        const categories = tag(await report(scene), scene.trip)?.categories ?? [];
        expect(categories.map((category) => category.name)).toEqual(['Transporte', 'Compras', 'Alimentação']);
        expect(categories.map((category) => category.share)).toEqual([0.44285714285714284, 0.2857142857142857, 0.2714285714285714]);
    });
});

describe('Por tag — lista de tags (T3)', () => {
    it('só as tags com lançamento no período, pelo total líquido e depois pelo nome', async () => {
        const scene = await scenario();
        const gift = (await scene.world.ok('tags.create', { profileId: scene.profileId, name: 'presente' })).id;
        await scene.world.ok('tags.create', { profileId: scene.profileId, name: 'sem-uso' });
        await launch(scene, scene.shopping.subCategoryId, [scene.trip, scene.refundable], { value: 248, dueDate: '2026-10-02', paymentDate: '2026-10-02' });
        await launch(scene, scene.shopping.subCategoryId, [gift], { value: 248, dueDate: '2026-10-02', paymentDate: '2026-10-02' });
        await launch(scene, scene.transport.subCategoryId, [scene.trip], { value: 100, dueDate: '2026-10-03', paymentDate: '2026-10-03' });

        const result = await report(scene);
        expect(result.tags.map((candidate) => candidate.name)).toEqual(['viagem-floripa', 'presente', 'reembolsável']);
        expect(tag(result, scene.trip)?.categories).toHaveLength(2);
    });

    it('tag excluída sai do relatório', async () => {
        const scene = await scenario();
        await launch(scene, scene.shopping.subCategoryId, [scene.trip], { value: 100, dueDate: '2026-10-02', paymentDate: '2026-10-02' });
        await scene.world.ok('tags.delete', { id: scene.trip });

        expect((await report(scene)).tags).toEqual([]);
    });
});

describe('Por tag — lançamentos (T5)', () => {
    it('a lista traz receitas e despesas da tag no período e soma o total líquido', async () => {
        const scene = await scenario();
        const savings = scene.world.account(scene.profileId);
        await launch(scene, scene.transport.subCategoryId, [scene.refundable], { value: 500, charges: 2, dueDate: '2026-10-02', paymentDate: '2026-10-02' });
        await launch(scene, scene.refunds.subCategoryId, [scene.refundable], { type: 'income', value: 200, dueDate: '2026-10-20', paymentDate: '2026-10-20' });
        await launch(scene, scene.transport.subCategoryId, [scene.refundable], { value: 90, dueDate: '2026-11-02' });
        await launch(scene, scene.transport.subCategoryId, [scene.refundable], { type: 'transference', destinationAccountId: savings, value: 1000, dueDate: '2026-10-02', paymentDate: '2026-10-02' });

        const month = await scene.world.ok('reports.tagTransactions', { profileId: scene.profileId, period: '2026-10', range: 'month', tagId: scene.refundable });
        expect(month.transactions.map((transaction) => transaction.type)).toEqual(['expense', 'income']);
        expect(month.total).toEqualMoney('302');
        expect(month.total).toEqual(tag(await report(scene, 'month'), scene.refundable)?.net);

        const all = await scene.world.ok('reports.tagTransactions', { profileId: scene.profileId, period: '2026-10', tagId: scene.refundable });
        expect(all.range).toBe('all');
        expect(all.transactions).toHaveLength(3);
        expect(all.total).toEqualMoney('392');
    });

    it('recusa tag de outro perfil', async () => {
        const scene = await scenario();
        const otherProfile = scene.world.profile();
        const foreign = (await scene.world.ok('tags.create', { profileId: otherProfile, name: 'viagem' })).id;

        const failure = await scene.world.failure('reports.tagTransactions', { profileId: scene.profileId, period: '2026-10', tagId: foreign });
        expect(failure.code).toBe('NOT_FOUND');
    });
});
