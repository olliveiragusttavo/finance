import { describe, expect, it } from 'vitest';
import type { CoreInput, CoreOutput } from '../../src/index.ts';
import { TestWorld } from '../support/TestWorld.ts';

type PreviewInput = CoreInput<'reports.preview'>;
type Filter = PreviewInput['filter'];
type Layout = PreviewInput['layout'];
type Result = CoreOutput<'reports.preview'>;

/** Ids do cenário de outubro de 2026. */
interface Scene {
    readonly world: TestWorld;
    readonly profileId: string;
    readonly accountId: string;
    readonly creditCardId: string;
    readonly housing: string;
    readonly rent: string;
    readonly groceries: string;
    readonly supermarket: string;
    readonly bakery: string;
    readonly salary: string;
    readonly rentId: string;
}

/**
 * Cenário de outubro de 2026, com uma transação para cada caso de data:
 * - aluguel de R$ 1.500,00, vence e é pago em 05/10;
 * - supermercado de R$ 300,00 que vence em 28/09 e é pago em 02/10;
 * - padaria de R$ 40,00 que vence em 20/10, em aberto;
 * - salário de R$ 5.000,00, recebido em 01/10;
 * - supermercado de R$ 200,00 no cartão, comprado em 10/10 (fatura em aberto);
 * - estorno de R$ 50,00 no supermercado, pago em 12/10.
 * Todas entram no app em 03/10, menos o aluguel, digitado em 30/09 às 23h30 (UTC).
 *
 * @return O cenário com os ids.
 */
async function scene(): Promise<Scene> {
    const world = new TestWorld('2026-10-15');
    const profileId = world.profile();
    const accountId = world.account(profileId, { name: 'Nubank', openingBalance: 10000 });
    const creditCardId = world.creditCard(profileId, accountId, 25, 5);
    const { categoryId: housing, subCategoryId: rent } = world.namedSubCategory(profileId, 'Moradia', 'Aluguel');
    const { categoryId: groceries, subCategoryId: supermarket } = world.namedSubCategory(profileId, 'Mercado', 'Supermercado');
    const { subCategoryId: bakery } = world.namedSubCategory(profileId, 'Mercado', 'Padaria');
    const { subCategoryId: salary } = world.namedSubCategory(profileId, 'Receitas', 'Salário');
    const base = { profileId, subCategoryId: rent };
    const account = { kind: 'account', accountId } as const;
    const rentId = (await world.create(base, { source: account, name: 'Aluguel', value: 1500, dueDate: '2026-10-05', paymentDate: '2026-10-05' })).id;
    await world.create(base, { source: account, subCategoryId: supermarket, value: 300, dueDate: '2026-09-28', paymentDate: '2026-10-02' });
    await world.create(base, { source: account, subCategoryId: bakery, value: 40, dueDate: '2026-10-20' });
    await world.create(base, { source: account, subCategoryId: salary, type: 'income', value: 5000, dueDate: '2026-10-01', paymentDate: '2026-10-01' });
    await world.create(base, { source: { kind: 'creditCard', creditCardId }, subCategoryId: supermarket, value: 200, dueDate: '2026-10-10' });
    await world.create(base, { source: account, subCategoryId: supermarket, value: -50, dueDate: '2026-10-12', paymentDate: '2026-10-12' });
    world.database.run("UPDATE transactions SET created_at = '2026-10-03 10:00:00'");
    world.database.run("UPDATE transactions SET created_at = '2026-09-30 23:30:00' WHERE id = :id", { id: rentId });
    return { world, profileId, accountId, creditCardId, housing, rent, groceries, supermarket, bakery, salary, rentId };
}

/**
 * @param basis Data que decide o mês.
 * @param extra Filtros além do período.
 * @return Um filtro de outubro (o mês de referência), só ele.
 */
function october(basis: 'payment' | 'due' | 'created', extra: Omit<Filter, 'period'> = {}): Filter {
    return { period: { anchor: { kind: 'reference' }, basis }, ...extra };
}

/**
 * @param world Mundo do teste.
 * @param profileId Perfil consultado.
 * @param filter Filtro do relatório.
 * @param layout Formato do relatório.
 * @param period Mês de referência da tela.
 * @return O resultado do editor (`reports.preview`).
 */
async function preview(world: TestWorld, profileId: string, filter: Filter, layout: Layout, period = '2026-10'): Promise<Result> {
    return world.ok('reports.preview', { profileId, period, filter, layout });
}

/**
 * @param result Resultado do relatório.
 * @return Cada linha como `[chave, rótulo, total, quantidade]`, para comparar a grade inteira.
 */
function lines(result: Result): readonly (readonly [string | null, string | null, number, number])[] {
    return result.rows.map((row) => [row.group.key, row.group.label, row.total.total.amount, row.total.count] as const);
}

const BY_SUBCATEGORY: Layout = { format: 'table', primary: 'subCategory' };

describe('execução do relatório — base de data (reports-design F3)', () => {
    it('Regra de negócio (Relatórios, F3): pelo pagamento, a transação em aberto fica fora e a paga conta no mês do pagamento', async () => {
        const s = await scene();
        const result = await preview(s.world, s.profileId, october('payment', { types: ['expense'] }), BY_SUBCATEGORY);
        // O supermercado venceu em setembro, mas foi pago em outubro; o estorno abate R$ 50,00; padaria e cartão estão em aberto.
        expect(lines(result)).toEqual([
            [s.rent, 'Aluguel', 1500, 1],
            [s.supermarket, 'Supermercado', 250, 2],
        ]);
        expect(result.total).toEqual({ total: { amount: 1750, currency: 'BRL' }, count: 3 });
    });

    it('pelo vencimento, conta o em aberto e a compra no cartão pela data da compra', async () => {
        const s = await scene();
        const result = await preview(s.world, s.profileId, october('due', { types: ['expense'] }), BY_SUBCATEGORY);
        expect(lines(result)).toEqual([
            [s.rent, 'Aluguel', 1500, 1],
            [s.supermarket, 'Supermercado', 150, 2],
            [s.bakery, 'Padaria', 40, 1],
        ]);
    });

    it('pelo lançamento, vale o dia UTC do created_at', async () => {
        const s = await scene();
        const result = await preview(s.world, s.profileId, october('created', { types: ['expense'] }), BY_SUBCATEGORY);
        // O aluguel entrou no app em 30/09: fica em setembro.
        expect(lines(result).map(([key]) => key)).toEqual([s.supermarket, s.bakery]);
        expect(result.total.total.amount).toBe(490);
    });
});

describe('execução do relatório — filtros (reports-design §2.2)', () => {
    it('sem tipo escolhido entram todos, e o tipo como dimensão separa entradas e saídas', async () => {
        const s = await scene();
        const result = await preview(s.world, s.profileId, october('payment'), { format: 'bar', primary: 'type' });
        expect(lines(result)).toEqual([
            ['income', null, 5000, 1],
            ['expense', null, 1750, 3],
        ]);
    });

    it('Regra de negócio (Relatórios, A2): categoria e subcategoria escolhidas se somam (OU)', async () => {
        const s = await scene();
        const result = await preview(s.world, s.profileId, october('due', { categoryIds: [s.housing], subCategoryIds: [s.bakery] }), { format: 'table', primary: 'category' });
        expect(lines(result)).toEqual([
            [s.housing, 'Moradia', 1500, 1],
            [s.groceries, 'Mercado', 40, 1],
        ]);
    });

    it('Regra de negócio (Relatórios, A3): a origem é a conta do extrato ou o cartão da fatura', async () => {
        const s = await scene();
        const bySource = await preview(s.world, s.profileId, october('due', { types: ['expense'] }), { format: 'table', primary: 'source' });
        expect(lines(bySource)).toEqual([
            [s.accountId, 'Nubank', 1490, 3],
            [s.creditCardId, 'Cartão', 200, 1],
        ]);
        const cardOnly = await preview(s.world, s.profileId, october('due', { creditCardIds: [s.creditCardId] }), BY_SUBCATEGORY);
        expect(cardOnly.total.total.amount).toBe(200);
        const both = await preview(s.world, s.profileId, october('due', { types: ['expense'], accountIds: [s.accountId], creditCardIds: [s.creditCardId] }), BY_SUBCATEGORY);
        expect(both.total.total.amount).toBe(1690);
    });

    it('Regra de negócio (Relatórios, A7): só pagas ou só em aberto, e a situação como dimensão', async () => {
        const s = await scene();
        const open = await preview(s.world, s.profileId, october('due', { types: ['expense'], status: 'open' }), BY_SUBCATEGORY);
        expect(open.total.total.amount).toBe(240);
        const byStatus = await preview(s.world, s.profileId, october('due', { types: ['expense'] }), { format: 'table', primary: 'status' });
        expect(lines(byStatus)).toEqual([
            ['paid', null, 1450, 2],
            ['open', null, 240, 2],
        ]);
    });

    it('Regra de negócio (Relatórios, L6): agrupa em fixas, parceladas e avulsas pelo tipo da série', async () => {
        const s = await scene();
        const base = { profileId: s.profileId, subCategoryId: s.rent };
        const account = { kind: 'account', accountId: s.accountId } as const;
        await s.world.create(base, { source: account, name: 'Streaming', value: 40, dueDate: '2026-10-08', repeat: { kind: 'fixed', frequency: 'monthly', endAt: null } });
        await s.world.create(base, { source: account, name: 'Geladeira', value: 900, dueDate: '2026-10-15', repeat: { kind: 'installments', frequency: 'monthly', installments: 3, valueType: 'total' } });
        const byRecurrence = await preview(s.world, s.profileId, october('due', { types: ['expense'] }), { format: 'table', primary: 'recurrence', secondary: 'month' });
        expect(lines(byRecurrence)).toEqual([
            ['fixed', null, 40, 1],
            ['installments', null, 300, 1],
            ['single', null, 1690, 4],
        ]);
        expect(byRecurrence.total.total.amount).toBe(2030);
    });

    it('Regra de negócio (Relatórios, A8): o valor mínimo e o máximo são inclusivos e valem sobre o valor com sinal', async () => {
        const s = await scene();
        const noRefund = await preview(s.world, s.profileId, october('due', { types: ['expense'], minValue: 0, maxValue: 200 }), BY_SUBCATEGORY);
        expect(lines(noRefund)).toEqual([
            [s.supermarket, 'Supermercado', 200, 1],
            [s.bakery, 'Padaria', 40, 1],
        ]);
    });

    it('a transação excluída e a de outro perfil ficam fora', async () => {
        const s = await scene();
        await s.world.ok('transactions.delete', { id: s.rentId });
        const other = s.world.profile();
        const otherAccount = s.world.account(other);
        await s.world.create({ profileId: other, subCategoryId: s.world.subCategory(other) }, { source: { kind: 'account', accountId: otherAccount }, value: 999, dueDate: '2026-10-05' });
        const result = await preview(s.world, s.profileId, october('due', { types: ['expense'] }), BY_SUBCATEGORY);
        expect(result.total.total.amount).toBe(190);
    });
});

describe('execução do relatório — tags (reports-design A4 e §3)', () => {
    /**
     * @return O cenário com três despesas de outubro: R$ 300,00 com "viagem" e "trabalho",
     * R$ 100,00 só com "viagem" e R$ 50,00 sem tag.
     */
    async function tagged(): Promise<{ readonly world: TestWorld; readonly profileId: string; readonly trip: string; readonly work: string }> {
        const world = new TestWorld('2026-10-15');
        const profileId = world.profile();
        const accountId = world.account(profileId);
        const base = { profileId, subCategoryId: world.subCategory(profileId) };
        const trip = (await world.ok('tags.create', { profileId, name: 'viagem' })).id;
        const work = (await world.ok('tags.create', { profileId, name: 'trabalho' })).id;
        const source = { kind: 'account', accountId } as const;
        await world.create(base, { source, value: 300, dueDate: '2026-10-05', tagIds: [trip, work] });
        await world.create(base, { source, value: 100, dueDate: '2026-10-06', tagIds: [trip] });
        await world.create(base, { source, value: 50, dueDate: '2026-10-07' });
        return { world, profileId, trip, work };
    }

    it('Regra de negócio (Relatórios, A4): "qualquer uma" pede uma das tags; "todas", cada uma delas', async () => {
        const { world, profileId, trip, work } = await tagged();
        const any = await preview(world, profileId, october('due', { tagIds: [trip, work] }), BY_SUBCATEGORY);
        expect(any.total).toMatchObject({ total: { amount: 400 }, count: 2 });
        const all = await preview(world, profileId, october('due', { tagIds: [trip, work], tagMatch: 'all' }), BY_SUBCATEGORY);
        expect(all.total).toMatchObject({ total: { amount: 300 }, count: 1 });
    });

    it('Regra de negócio (Relatórios, §3): com a tag como dimensão a transação conta em cada tag, o total conta cada uma vez e a sem tag cai em "Sem tag"', async () => {
        const { world, profileId, trip, work } = await tagged();
        const result = await preview(world, profileId, october('due'), { format: 'table', primary: 'tag' });
        expect(lines(result)).toEqual([
            [trip, 'viagem', 400, 2],
            [work, 'trabalho', 300, 1],
            [null, null, 50, 1],
        ]);
        expect(result.total).toMatchObject({ total: { amount: 450 }, count: 3 });
        expect(result.overlapping).toBe(true);
    });

    it('a tag excluída sai do filtro e da dimensão; o vínculo dela não conta', async () => {
        const { world, profileId, trip, work } = await tagged();
        await world.ok('tags.delete', { id: work });
        const result = await preview(world, profileId, october('due'), { format: 'table', primary: 'tag' });
        expect(lines(result)).toEqual([
            [trip, 'viagem', 400, 2],
            [null, null, 50, 1],
        ]);
    });
});

describe('execução do relatório — sócio e meta', () => {
    it('agrupa pelo sócio, com "Sem sócio" para a entrada sem sócio, e filtra pelo sócio', async () => {
        const world = new TestWorld('2026-10-15');
        const profileId = world.profile({ type: 'business' });
        const accountId = world.account(profileId);
        const ana = world.partner(profileId, { name: 'Ana' });
        const base = { profileId, subCategoryId: world.subCategory(profileId) };
        const source = { kind: 'account', accountId } as const;
        await world.create(base, { source, type: 'income', value: 1000, dueDate: '2026-10-05', partnerId: ana });
        await world.create(base, { source, type: 'income', value: 500, dueDate: '2026-10-06' });

        const byPartner = await preview(world, profileId, october('due'), { format: 'table', primary: 'partner' });
        expect(lines(byPartner)).toEqual([
            [ana, 'Ana', 1000, 1],
            [null, null, 500, 1],
        ]);
        expect((await preview(world, profileId, october('due', { partnerIds: [ana] }), BY_SUBCATEGORY)).total.total.amount).toBe(1000);
    });

    it('filtra pela meta vinculada', async () => {
        const world = new TestWorld('2026-10-15');
        const profileId = world.profile();
        const accountId = world.account(profileId);
        const goal = await world.ok('goals.create', { profileId, name: 'Reserva', value: 10000 });
        const base = { profileId, subCategoryId: world.subCategory(profileId) };
        const source = { kind: 'account', accountId } as const;
        await world.create(base, { source, type: 'income', value: 700, dueDate: '2026-10-05', goalId: goal.id });
        await world.create(base, { source, type: 'income', value: 300, dueDate: '2026-10-05' });
        expect((await preview(world, profileId, october('due', { goalIds: [goal.id] }), BY_SUBCATEGORY)).total.total.amount).toBe(700);
    });
});

describe('execução do relatório — janela e formato', () => {
    it('Regra de negócio (Relatórios, F2): o mês como dimensão traz cada mês da janela, inclusive o sem lançamento', async () => {
        const s = await scene();
        const result = await preview(s.world, s.profileId, { period: { anchor: { kind: 'reference' }, previousMonths: 2, basis: 'due' }, types: ['expense'] }, { format: 'line', primary: 'month' });
        expect(result.from).toBe('2026-08');
        expect(lines(result)).toEqual([
            ['2026-08', null, 0, 0],
            ['2026-09', null, 300, 1],
            ['2026-10', null, 1690, 4],
        ]);
    });

    it('Regra de negócio (Relatórios, F1): o mês fixo ignora o mês de referência da tela', async () => {
        const s = await scene();
        const result = await preview(s.world, s.profileId, { period: { anchor: { kind: 'fixed', month: '2026-09' }, basis: 'due' } }, BY_SUBCATEGORY, '2027-03');
        expect([result.from, result.to]).toEqual(['2026-09', '2026-09']);
        expect(lines(result)).toEqual([[s.supermarket, 'Supermercado', 300, 1]]);
    });

    it('com secundária, a grade tem uma célula por coluna e os totais de linha e de coluna', async () => {
        const s = await scene();
        const result = await preview(
            s.world,
            s.profileId,
            { period: { anchor: { kind: 'reference' }, previousMonths: 1, basis: 'due' }, types: ['expense'] },
            { format: 'bar', primary: 'category', secondary: 'month' },
        );
        expect(result.secondary?.groups.map((group) => group.key)).toEqual(['2026-09', '2026-10']);
        expect(result.rows.map((row) => [row.group.label, row.cells.map((cell) => cell.total.amount), row.total.total.amount])).toEqual([
            ['Moradia', [0, 1500], 1500],
            ['Mercado', [300, 190], 490],
        ]);
        expect(result.columnTotals.map((cell) => cell.total.amount)).toEqual([300, 1690]);
        expect(result.total.total.amount).toBe(1990);
        expect(result.overlapping).toBe(false);
    });

    it('o relatório salvo dá o mesmo resultado do editor, e acompanha o mês de referência', async () => {
        const s = await scene();
        const filter = october('due', { types: ['expense'] });
        const saved = await s.world.ok('reports.create', { profileId: s.profileId, name: 'Despesas', filter, layout: BY_SUBCATEGORY });
        expect(await s.world.ok('reports.run', { id: saved.id, period: '2026-10' })).toEqual(await preview(s.world, s.profileId, filter, BY_SUBCATEGORY));
        expect((await s.world.ok('reports.run', { id: saved.id, period: '2026-09' })).total.total.amount).toBe(300);
    });

    it('sem nenhuma transação no filtro, a grade vem vazia e o total zerado', async () => {
        const s = await scene();
        const result = await preview(s.world, s.profileId, october('due', { types: ['investment'] }), BY_SUBCATEGORY);
        expect(result.rows).toEqual([]);
        expect(result.total).toEqual({ total: { amount: 0, currency: 'BRL' }, count: 0 });
    });
});

describe('execução do relatório — entrada e saída e transferências entre perfis (reports-design L8 e §2.2)', () => {
    /** Ids do cenário de dois perfis. */
    interface FlowScene {
        readonly world: TestWorld;
        readonly personal: string;
        readonly business: string;
        readonly checking: string;
        readonly brokerage: string;
        readonly companyAccount: string;
        readonly personalCategory: string;
    }

    /**
     * Cenário de outubro de 2026 no perfil pessoal:
     * - salário de R$ 5.000,00 e despesa de R$ 300,00 na conta corrente;
     * - estorno de R$ 50,00 na mesma despesa;
     * - transferência de R$ 500,00 (TED de R$ 8,00) da corrente para a corretora, ambas do perfil;
     * - transferência de R$ 200,00 da corrente para a conta da empresa;
     * - transferência de R$ 1.000,00 da conta da empresa para a corrente, com a subcategoria e a
     *   tag do perfil empresarial.
     *
     * @return O cenário com os ids.
     */
    async function flowScene(): Promise<FlowScene> {
        const world = new TestWorld('2026-10-15');
        const personal = world.profile();
        const business = world.profile({ type: 'business' });
        const checking = world.account(personal, { name: 'Corrente' });
        const brokerage = world.account(personal, { name: 'Corretora' });
        const companyAccount = world.account(business, { name: 'Empresa' });
        const { categoryId: personalCategory, subCategoryId } = world.namedSubCategory(personal, 'Movimentos', 'Geral');
        const base = { profileId: personal, subCategoryId };
        const source = { kind: 'account', accountId: checking } as const;
        await world.create(base, { source, type: 'income', value: 5000, dueDate: '2026-10-01' });
        await world.create(base, { source, value: 300, dueDate: '2026-10-02' });
        await world.create(base, { source, value: -50, dueDate: '2026-10-03' });
        await world.create(base, { source, type: 'transference', value: 500, charges: 8, dueDate: '2026-10-04', destinationAccountId: brokerage });
        await world.create(base, { source, type: 'transference', value: 200, dueDate: '2026-10-05', destinationAccountId: companyAccount });
        const companyTag = (await world.ok('tags.create', { profileId: business, name: 'aporte' })).id;
        await world.create(
            { profileId: business, subCategoryId: world.subCategory(business) },
            { source: { kind: 'account', accountId: companyAccount }, type: 'transference', value: 1000, dueDate: '2026-10-06', destinationAccountId: checking, tagIds: [companyTag] },
        );
        return { world, personal, business, checking, brokerage, companyAccount, personalCategory };
    }

    it('Regra de negócio (Relatórios, L8): entrada e saída pelo efeito no saldo, com a transferência interna nos dois lados', async () => {
        const s = await flowScene();
        const result = await preview(s.world, s.personal, october('due'), { format: 'table', primary: 'flow' });
        // Entra: salário, estorno, a chegada na corretora e a transferência da empresa. Sai: a
        // despesa, a saída da corrente para a corretora e a transferência para a empresa.
        expect(lines(result)).toEqual([
            ['in', null, 6550, 4],
            ['out', null, -1000, 3],
        ]);
        // O total é o líquido, com cada transação contada uma vez.
        expect(result.total.total.amount).toBe(5550);
        expect(result.total.count).toBe(6);
    });

    it('Regra de negócio (Relatórios, L8): com a entrada e saída nas colunas, o total da linha é o líquido', async () => {
        const s = await flowScene();
        const result = await preview(s.world, s.personal, october('due'), { format: 'table', primary: 'source', secondary: 'flow' });
        const checking = result.rows.find((row) => row.group.key === s.checking);
        const brokerage = result.rows.find((row) => row.group.key === s.brokerage);
        // Corrente: +5.000 +50 +1.000 −300 −500 −200; a corretora só recebe os R$ 500,00.
        expect(checking?.cells.map((cell) => cell.total.amount)).toEqual([6050, -1000]);
        expect(checking?.total.total.amount).toBe(5050);
        expect(brokerage?.total.total.amount).toBe(500);
        expect(result.columnTotals.map((cell) => cell.total.amount)).toEqual([6550, -1000]);
    });

    it('Regra de negócio (Relatórios, L8 e A3): com entrada e saída, o filtro de conta vale para cada movimento', async () => {
        const s = await flowScene();
        const checking = await preview(s.world, s.personal, october('due', { accountIds: [s.checking] }), { format: 'table', primary: 'flow' });
        // A chegada na corretora não é da corrente; a saída para ela é.
        expect(lines(checking)).toEqual([
            ['in', null, 6050, 3],
            ['out', null, -1000, 3],
        ]);
        const brokerage = await preview(s.world, s.personal, october('due', { accountIds: [s.brokerage] }), { format: 'table', primary: 'flow' });
        expect(lines(brokerage)).toEqual([['in', null, 500, 1]]);
        // Com a origem nas linhas, só a conta filtrada aparece.
        const bySource = await preview(s.world, s.personal, october('due', { accountIds: [s.checking] }), { format: 'table', primary: 'source', secondary: 'flow' });
        expect(bySource.rows.map((row) => row.group.key)).toEqual([s.checking]);
    });

    it('Regra de negócio (Relatórios, §2.2): a transferência recebida de outro perfil entra no destino, pela conta de destino e sem a classificação de lá', async () => {
        const s = await flowScene();
        const transfers = october('due', { types: ['transference'] });
        const byCategory = await preview(s.world, s.personal, transfers, { format: 'table', primary: 'category' });
        expect(lines(byCategory)).toEqual([
            [s.personalCategory, 'Movimentos', 700, 2],
            [null, null, 1000, 1],
        ]);
        const bySource = await preview(s.world, s.personal, transfers, { format: 'table', primary: 'source' });
        expect(lines(bySource)).toEqual([[s.checking, 'Corrente', 1700, 3]]);
        const byTag = await preview(s.world, s.personal, transfers, { format: 'table', primary: 'tag' });
        expect(lines(byTag)).toEqual([[null, null, 1700, 3]]);
        const byAccount = await preview(s.world, s.personal, october('due', { types: ['transference'], accountIds: [s.checking] }), BY_SUBCATEGORY);
        expect(byAccount.total.total.amount).toBe(1700);
        // A empresa vê a que mandou e a que recebeu do perfil pessoal.
        const company = await preview(s.world, s.business, transfers, { format: 'table', primary: 'source' });
        expect(lines(company)).toEqual([[s.companyAccount, 'Empresa', 1200, 2]]);
    });
});
