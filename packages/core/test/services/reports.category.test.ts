import { describe, expect, it } from 'vitest';
import type { CategoryReportResponse, CoreInput, SubCategoryReportRowResponse } from '../../src/index.ts';
import { TestWorld } from '../support/TestWorld.ts';

type Comparison = NonNullable<CoreInput<'reports.byCategory'>['comparison']>;

/** O cenário-base dos relatórios: uma conta, um cartão e uma árvore de categorias. */
interface Scenario {
    readonly world: TestWorld;
    readonly profileId: string;
    readonly accountId: string;
    /** Fecha no dia 25 e vence no dia 5: a fatura de setembro vence em 05/10. */
    readonly cardId: string;
    readonly market: { readonly categoryId: string; readonly subCategoryId: string };
    readonly restaurants: { readonly categoryId: string; readonly subCategoryId: string };
    readonly rent: { readonly categoryId: string; readonly subCategoryId: string };
}

/**
 * Monta o perfil usado em todos os cenários, para que cada teste declare só os lançamentos
 * que importam para ele.
 *
 * @return O mundo e os ids semeados.
 */
function scenario(): Scenario {
    const world = new TestWorld('2026-10-15');
    const profileId = world.profile();
    const accountId = world.account(profileId, { openingBalance: 10000, name: 'Nubank' });
    return {
        world,
        profileId,
        accountId,
        cardId: world.creditCard(profileId, accountId, 25, 5),
        market: world.namedSubCategory(profileId, 'Alimentação', 'Mercado'),
        restaurants: world.namedSubCategory(profileId, 'Alimentação', 'Restaurantes'),
        rent: world.namedSubCategory(profileId, 'Moradia', 'Aluguel'),
    };
}

/**
 * @param scene Cenário.
 * @param subCategory Subcategoria do lançamento.
 * @param overrides Campos do lançamento.
 * @return A transação criada pela rota real.
 */
async function expense(
    scene: Scenario,
    subCategory: { readonly subCategoryId: string },
    overrides: Partial<CoreInput<'transactions.create'>> & Pick<CoreInput<'transactions.create'>, 'source'>,
): ReturnType<TestWorld['create']> {
    return scene.world.create({ profileId: scene.profileId, subCategoryId: subCategory.subCategoryId }, overrides);
}

/**
 * @param scene Cenário.
 * @param period Mês de referência.
 * @param comparison Base de comparação.
 * @return O relatório pela rota real.
 */
async function report(scene: Scenario, period: string, comparison: Comparison = 'previousMonth'): Promise<CategoryReportResponse> {
    return scene.world.ok('reports.byCategory', { profileId: scene.profileId, period, comparison });
}

/**
 * @param result Relatório.
 * @param category Nome da categoria.
 * @param subCategory Nome da subcategoria.
 * @return A linha da subcategoria, ou `undefined` quando não aparece no relatório.
 */
function row(result: CategoryReportResponse, category: string, subCategory: string): SubCategoryReportRowResponse | undefined {
    return result.categories.find((candidate) => candidate.name === category)?.subCategories.find((candidate) => candidate.name === subCategory);
}

describe('Relatório por categoria — regra-mestra: mês do pagamento (§3.1)', () => {
    it('compra de setembro em fatura paga em outubro conta em outubro', async () => {
        const scene = scenario();
        await expense(scene, scene.restaurants, { source: { kind: 'creditCard', creditCardId: scene.cardId }, value: 200, dueDate: '2026-09-10' });
        await scene.world.payInvoice(scene.cardId, '2026-09', '2026-10-05');

        expect(row(await report(scene, '2026-10'), 'Alimentação', 'Restaurantes')?.amount).toEqualMoney('200');
        expect(row(await report(scene, '2026-09', 'sameMonthLastYear'), 'Alimentação', 'Restaurantes')).toBeUndefined();
    });

    it('fatura paga com atraso conta no mês do pagamento; reaberta, volta para o mês do vencimento', async () => {
        const scene = scenario();
        await expense(scene, scene.restaurants, { source: { kind: 'creditCard', creditCardId: scene.cardId }, value: 200, dueDate: '2026-09-10' });
        await scene.world.payInvoice(scene.cardId, '2026-09', '2026-11-02');

        expect(row(await report(scene, '2026-11'), 'Alimentação', 'Restaurantes')?.amount).toEqualMoney('200');
        expect(row(await report(scene, '2026-10', 'sameMonthLastYear'), 'Alimentação', 'Restaurantes')).toBeUndefined();

        await scene.world.ok('invoices.reopen', { invoiceId: scene.world.invoiceId(scene.cardId, '2026-09') });

        // Em aberto, a fatura de setembro pesa no vencimento: 05/10.
        expect(row(await report(scene, '2026-10', 'sameMonthLastYear'), 'Alimentação', 'Restaurantes')?.amount).toEqualMoney('200');
        expect(row(await report(scene, '2026-11', 'sameMonthLastYear'), 'Alimentação', 'Restaurantes')).toBeUndefined();
    });

    it('transação de conta paga em mês diferente do vencimento conta no mês do pagamento, como no extrato', async () => {
        const scene = scenario();
        await expense(scene, scene.rent, { source: { kind: 'account', accountId: scene.accountId }, value: 2300, dueDate: '2026-09-28', paymentDate: '2026-10-02' });

        expect(scene.world.statementRow(scene.accountId, '2026-09')).toBeUndefined();
        expect(scene.world.statementRow(scene.accountId, '2026-10')?.closing).toEqualMoney('7700');

        expect(row(await report(scene, '2026-10', 'sameMonthLastYear'), 'Moradia', 'Aluguel')?.amount).toEqualMoney('2300');
        expect(row(await report(scene, '2026-09', 'sameMonthLastYear'), 'Moradia', 'Aluguel')).toBeUndefined();
    });

    it('transação de conta em aberto conta no mês do vencimento', async () => {
        const scene = scenario();
        await expense(scene, scene.rent, { source: { kind: 'account', accountId: scene.accountId }, value: 2300, dueDate: '2026-10-20' });

        expect(row(await report(scene, '2026-10'), 'Moradia', 'Aluguel')?.amount).toEqualMoney('2300');
    });
});

describe('Relatório por categoria — o que entra (R2–R4)', () => {
    it('estorno abate a mesma subcategoria (R2)', async () => {
        const scene = scenario();
        const card = { kind: 'creditCard', creditCardId: scene.cardId } as const;
        await expense(scene, scene.market, { source: card, value: 300, dueDate: '2026-10-03' });
        await expense(scene, scene.market, { source: card, value: -100, dueDate: '2026-10-08' });

        // Fatura de outubro (fecha 25/10) vence em 05/11: as duas pesam em novembro.
        expect(row(await report(scene, '2026-11'), 'Alimentação', 'Mercado')?.amount).toEqualMoney('200');
    });

    it('receitas, transferências e investimentos ficam fora (R2)', async () => {
        const scene = scenario();
        const savings = scene.world.account(scene.profileId, { name: 'Poupança' });
        const source = { kind: 'account', accountId: scene.accountId } as const;
        const paid = { dueDate: '2026-10-05', paymentDate: '2026-10-05' };
        await expense(scene, scene.market, { source, ...paid, type: 'income', value: 9500 });
        await expense(scene, scene.market, { source, ...paid, type: 'transference', destinationAccountId: savings, value: 1000 });
        await expense(scene, scene.market, { source, ...paid, type: 'investment', destinationAccountId: savings, value: 500 });

        const result = await report(scene, '2026-10');
        expect(result.categories).toEqual([]);
        expect(result.total.amount).toEqualMoney('0');
    });

    it('encargos entram pelo efeito no saldo (R3)', async () => {
        const scene = scenario();
        await expense(scene, scene.rent, { source: { kind: 'account', accountId: scene.accountId }, value: 100, charges: 2, dueDate: '2026-10-10' });

        expect(row(await report(scene, '2026-10'), 'Moradia', 'Aluguel')?.amount).toEqualMoney('102');
    });

    it('conta fora do total entra (R4); conta desativada continua', async () => {
        const scene = scenario();
        const wise = scene.world.account(scene.profileId, { considerBalance: false, name: 'Wise' });
        await expense(scene, scene.market, { source: { kind: 'account', accountId: wise }, value: 40, dueDate: '2026-10-10' });
        await expense(scene, scene.market, { source: { kind: 'account', accountId: scene.accountId }, value: 60, dueDate: '2026-10-11' });
        await scene.world.ok('accounts.disable', { id: scene.accountId });

        expect(row(await report(scene, '2026-10'), 'Alimentação', 'Mercado')?.amount).toEqualMoney('100');
    });

    it('transação excluída e conta excluída ficam fora', async () => {
        const scene = scenario();
        const other = scene.world.account(scene.profileId, { name: 'Itaú' });
        const deleted = await expense(scene, scene.market, { source: { kind: 'account', accountId: scene.accountId }, value: 70, dueDate: '2026-10-10' });
        await expense(scene, scene.market, { source: { kind: 'account', accountId: scene.accountId }, value: 30, dueDate: '2026-10-11' });
        await expense(scene, scene.market, { source: { kind: 'account', accountId: other }, value: 500, dueDate: '2026-10-12' });

        await scene.world.ok('transactions.delete', { id: deleted.id });
        await scene.world.ok('accounts.delete', { id: other });

        expect(row(await report(scene, '2026-10'), 'Alimentação', 'Mercado')?.amount).toEqualMoney('30');
    });
});

describe('Relatório por categoria — comparações (R5, R6)', () => {
    /**
     * Lança uma despesa de aluguel paga no dia 10 do mês.
     *
     * @param scene Cenário.
     * @param period Mês `YYYY-MM`.
     * @param value Valor.
     * @return void
     */
    async function rentIn(scene: Scenario, period: string, value: number): Promise<void> {
        const date = `${period}-10`;
        await expense(scene, scene.rent, { source: { kind: 'account', accountId: scene.accountId }, value, dueDate: date, paymentDate: date });
    }

    it('virada de ano nas três comparações', async () => {
        const scene = scenario();
        await rentIn(scene, '2026-01', 120);
        await rentIn(scene, '2025-12', 100);
        await rentIn(scene, '2025-11', 60);
        await rentIn(scene, '2025-10', 30);
        await rentIn(scene, '2025-01', 50);

        const previous = await report(scene, '2026-01', 'previousMonth');
        expect(previous.comparison).toEqual({ mode: 'previousMonth', periods: ['2025-12'] });
        expect(row(previous, 'Moradia', 'Aluguel')?.comparison).toEqualMoney('100');

        const lastYear = await report(scene, '2026-01', 'sameMonthLastYear');
        expect(lastYear.comparison.periods).toEqual(['2025-01']);
        expect(row(lastYear, 'Moradia', 'Aluguel')?.comparison).toEqualMoney('50');

        // (100 + 60 + 30) / 3 = 63,33.
        const average = await report(scene, '2026-01', 'lastThreeMonthsAverage');
        expect(average.comparison.periods).toEqual(['2025-12', '2025-11', '2025-10']);
        expect(row(average, 'Moradia', 'Aluguel')?.comparison).toEqualMoney('63.33');
        expect(row(average, 'Moradia', 'Aluguel')?.variation.absolute).toEqualMoney('56.67');
    });

    it('mês sem lançamento conta como zero na média (R5)', async () => {
        const scene = scenario();
        await rentIn(scene, '2026-10', 200);
        await rentIn(scene, '2026-09', 300);
        await rentIn(scene, '2026-07', 150);

        // (300 + 0 + 150) / 3 = 150.
        expect(row(await report(scene, '2026-10', 'lastThreeMonthsAverage'), 'Moradia', 'Aluguel')?.comparison).toEqualMoney('150');
    });

    it('base zero mostra "novo" (R6)', async () => {
        const scene = scenario();
        await rentIn(scene, '2026-10', 80);

        const line = row(await report(scene, '2026-10'), 'Moradia', 'Aluguel');
        expect(line?.comparison).toEqualMoney('0');
        expect(line?.variation.change).toEqual({ kind: 'new' });
    });

    it('categoria sem lançamento no período, mas com na base, aparece zerada', async () => {
        const scene = scenario();
        await rentIn(scene, '2026-09', 100);

        const line = row(await report(scene, '2026-10'), 'Moradia', 'Aluguel');
        expect(line?.amount).toEqualMoney('0');
        expect(line?.comparison).toEqualMoney('100');
        expect(line?.variation.change).toEqual({ kind: 'ratio', ratio: -1 });
    });
});

describe('Relatório por categoria — árvore e totais', () => {
    it('categoria soma as subcategorias, o total soma as categorias, maior gasto primeiro', async () => {
        const scene = scenario();
        const source = { kind: 'account', accountId: scene.accountId } as const;
        await expense(scene, scene.market, { source, value: 487.32, dueDate: '2026-10-05' });
        await expense(scene, scene.restaurants, { source, value: 512.18, dueDate: '2026-10-06' });
        await expense(scene, scene.rent, { source, value: 2300, dueDate: '2026-10-07' });
        await expense(scene, scene.market, { source, value: 610, dueDate: '2026-09-05' });

        const result = await report(scene, '2026-10');
        expect(result.categories.map((category) => category.name)).toEqual(['Moradia', 'Alimentação']);
        const food = result.categories[1];
        expect(food?.subCategories.map((subCategory) => subCategory.name)).toEqual(['Restaurantes', 'Mercado']);
        expect(food?.amount).toEqualMoney('999.50');
        expect(food?.comparison).toEqualMoney('610');
        expect(result.total.amount).toEqualMoney('3299.50');
        expect(result.total.comparison).toEqualMoney('610');
    });
});

describe('Drill-down — lançamentos da categoria (§3.1)', () => {
    it('lista pelo mês do pagamento e soma o mesmo valor da linha', async () => {
        const scene = scenario();
        const card = { kind: 'creditCard', creditCardId: scene.cardId } as const;
        await expense(scene, scene.restaurants, { source: card, name: 'Pizzaria', value: 112.5, dueDate: '2026-09-18' });
        await scene.world.payInvoice(scene.cardId, '2026-09', '2026-10-05');
        await expense(scene, scene.restaurants, { source: { kind: 'account', accountId: scene.accountId }, name: 'Café', value: 86.78, charges: 1, dueDate: '2026-10-24' });
        // Vence em outubro, mas foi pago em novembro: fica fora da lista de outubro.
        await expense(scene, scene.restaurants, { source: { kind: 'account', accountId: scene.accountId }, name: 'Jantar', value: 248, dueDate: '2026-10-11', paymentDate: '2026-11-01' });
        await expense(scene, scene.market, { source: { kind: 'account', accountId: scene.accountId }, name: 'Feira', value: 50, dueDate: '2026-10-12' });

        const bySubCategory = await scene.world.ok('reports.categoryTransactions', {
            profileId: scene.profileId,
            period: '2026-10',
            subCategoryId: scene.restaurants.subCategoryId,
        });
        expect(bySubCategory.transactions.map((transaction) => transaction.name)).toEqual(['Pizzaria', 'Café']);
        expect(bySubCategory.total).toEqualMoney('200.28');
        expect(row(await report(scene, '2026-10'), 'Alimentação', 'Restaurantes')?.amount).toEqualMoney('200.28');

        const byCategory = await scene.world.ok('reports.categoryTransactions', {
            profileId: scene.profileId,
            period: '2026-10',
            categoryId: scene.restaurants.categoryId,
        });
        expect(byCategory.transactions.map((transaction) => transaction.name)).toEqual(['Pizzaria', 'Feira', 'Café']);
        expect(byCategory.total).toEqualMoney('250.28');
    });

    it('recusa subcategoria de outro perfil e pedido com os dois ids', async () => {
        const scene = scenario();
        const otherProfile = scene.world.profile();
        const foreign = scene.world.namedSubCategory(otherProfile, 'Lazer', 'Cinema');

        const notFound = await scene.world.failure('reports.categoryTransactions', {
            profileId: scene.profileId,
            period: '2026-10',
            subCategoryId: foreign.subCategoryId,
        });
        expect(notFound.code).toBe('NOT_FOUND');

        const both = await scene.world.failure('reports.categoryTransactions', {
            profileId: scene.profileId,
            period: '2026-10',
            categoryId: scene.market.categoryId,
            subCategoryId: scene.market.subCategoryId,
        });
        expect(both.code).toBe('VALIDATION_FAILED');
    });
});
