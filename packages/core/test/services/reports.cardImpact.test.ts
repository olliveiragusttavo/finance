import { describe, expect, it } from 'vitest';
import type { CardImpactInvoiceResponse, CardImpactResponse, CoreInput } from '../../src/index.ts';
import { TestWorld } from '../support/TestWorld.ts';

/** O cenário do mockup `DesktopRelCartao`: dois cartões pagos pela mesma conta. */
interface Scenario {
    readonly world: TestWorld;
    readonly profileId: string;
    readonly accountId: string;
    /** Fecha no dia 28 e vence no dia 10: a fatura de setembro vence em 10/10. */
    readonly roxinho: string;
    /** Fecha no dia 1 e vence no dia 7: a fatura de outubro vence em 07/10. */
    readonly click: string;
    readonly base: { readonly profileId: string; readonly subCategoryId: string };
}

/**
 * Hoje é 03/10/2026: a fatura de setembro do Roxinho já fechou (28/09) e a de outubro ainda
 * recebe compras.
 *
 * @return O mundo e os ids semeados.
 */
function scenario(): Scenario {
    const world = new TestWorld('2026-10-03');
    const profileId = world.profile();
    const accountId = world.account(profileId, { openingBalance: 20000 });
    return {
        world,
        profileId,
        accountId,
        roxinho: world.creditCard(profileId, accountId, 28, 10),
        click: world.creditCard(profileId, accountId, 1, 7),
        base: { profileId, subCategoryId: world.subCategory(profileId) },
    };
}

/**
 * @param scene Cenário.
 * @param creditCardId Cartão da compra.
 * @param value Valor.
 * @param dueDate Data da compra.
 * @param extra Outros campos (fatura escolhida, encargos).
 * @return void
 */
async function purchase(scene: Scenario, creditCardId: string, value: number, dueDate: string, extra: Partial<CoreInput<'transactions.create'>> = {}): Promise<void> {
    await scene.world.create(scene.base, { source: { kind: 'creditCard', creditCardId }, value, dueDate, ...extra });
}

/**
 * @param scene Cenário.
 * @param value Valor da receita, paga no dia 5 do mês.
 * @param period Mês `YYYY-MM`.
 * @return void
 */
async function income(scene: Scenario, value: number, period: string): Promise<void> {
    const date = `${period}-05`;
    await scene.world.create(scene.base, { source: { kind: 'account', accountId: scene.accountId }, type: 'income', value, dueDate: date, paymentDate: date });
}

/**
 * @param scene Cenário.
 * @param period Mês de referência.
 * @return O relatório pela rota real.
 */
async function impact(scene: Scenario, period = '2026-10'): Promise<CardImpactResponse> {
    return scene.world.ok('reports.cardImpact', { profileId: scene.profileId, period });
}

/**
 * @param result Relatório.
 * @param period Mês da linha.
 * @param creditCardId Cartão da coluna.
 * @return As faturas da célula; vazio quando o cartão não tem fatura no mês.
 */
function cell(result: CardImpactResponse, period: string, creditCardId: string): readonly CardImpactInvoiceResponse[] {
    return result.months.find((month) => month.period === period)?.cells.find((candidate) => candidate.creditCardId === creditCardId)?.invoices ?? [];
}

describe('Impacto do cartão — mês das faturas (C1, C4, C5)', () => {
    it('janela com os 3 meses anteriores, o de referência e o seguinte; colunas na ordem dos cartões', async () => {
        const scene = scenario();
        const result = await impact(scene);
        expect(result.months.map((month) => month.period)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
        expect(result.months[0]?.cells.map((candidate) => candidate.creditCardId)).toEqual(result.creditCards.map((card) => card.id));
    });

    it('fatura de setembro paga em outubro conta em outubro, com o extrato do pagamento', async () => {
        const scene = scenario();
        await purchase(scene, scene.roxinho, 2449.75, '2026-09-05');
        await scene.world.payInvoice(scene.roxinho, '2026-09', '2026-10-08');

        const result = await impact(scene);
        expect(cell(result, '2026-09', scene.roxinho)).toEqual([]);
        const [october] = cell(result, '2026-10', scene.roxinho);
        expect(october?.invoicePeriod).toBe('2026-09');
        expect(october?.total).toEqualMoney('2449.75');
        expect(october?.situation).toEqual({ kind: 'paid', paidIn: '2026-10' });
    });

    it('em aberto, a fatura pesa no mês do vencimento; ainda recebendo compras, é futura', async () => {
        const scene = scenario();
        await purchase(scene, scene.roxinho, 2449.75, '2026-09-05');
        await purchase(scene, scene.roxinho, 863.42, '2026-10-02');

        const result = await impact(scene);
        expect(cell(result, '2026-10', scene.roxinho)[0]?.situation).toEqual({ kind: 'open', dueDate: '2026-10-10' });
        // Fatura de outubro: fecha em 28/10 (depois de hoje) e vence em 10/11.
        const [november] = cell(result, '2026-11', scene.roxinho);
        expect(november?.total).toEqualMoney('863.42');
        expect(november?.situation).toEqual({ kind: 'future', dueDate: '2026-11-10' });
    });

    it('reabrir uma fatura paga com atraso a devolve para o mês do vencimento', async () => {
        const scene = scenario();
        await purchase(scene, scene.roxinho, 500, '2026-08-05');
        await scene.world.payInvoice(scene.roxinho, '2026-08', '2026-10-01');
        expect(cell(await impact(scene), '2026-10', scene.roxinho)[0]?.situation).toEqual({ kind: 'paid', paidIn: '2026-10' });

        await scene.world.ok('invoices.reopen', { invoiceId: scene.world.invoiceId(scene.roxinho, '2026-08') });

        const result = await impact(scene);
        expect(cell(result, '2026-10', scene.roxinho)).toEqual([]);
        expect(cell(result, '2026-09', scene.roxinho)[0]?.situation).toEqual({ kind: 'open', dueDate: '2026-09-10' });
    });

    it('duas faturas do mesmo cartão no mesmo mês ficam na mesma célula', async () => {
        const scene = scenario();
        // Setembro (fecha 01/09, vence 07/09) paga com atraso em outubro, e outubro vencendo em 07/10.
        await purchase(scene, scene.click, 100, '2026-08-20');
        await scene.world.payInvoice(scene.click, '2026-09', '2026-10-02');
        await purchase(scene, scene.click, 612.3, '2026-09-15');

        const invoices = cell(await impact(scene), '2026-10', scene.click);
        expect(invoices.map((invoice) => invoice.invoicePeriod)).toEqual(['2026-09', '2026-10']);
        const month = (await impact(scene)).months.find((candidate) => candidate.period === '2026-10');
        expect(month?.total).toEqualMoney('712.30');
    });

    it('cartão sem fatura no mês tem célula vazia; cartão desativado continua', async () => {
        const scene = scenario();
        await purchase(scene, scene.roxinho, 300, '2026-09-05');
        await scene.world.ok('creditCards.disable', { id: scene.roxinho });

        const result = await impact(scene);
        expect(result.creditCards.find((card) => card.id === scene.roxinho)?.disabled).toBe(true);
        expect(cell(result, '2026-10', scene.roxinho)[0]?.total).toEqualMoney('300');
        const click = result.months.find((month) => month.period === '2026-10')?.cells.find((candidate) => candidate.creditCardId === scene.click);
        expect(click?.invoices).toEqual([]);
        expect(click?.total).toEqualMoney('0');
    });
});

describe('Impacto do cartão — total, peso e média (C2, C3)', () => {
    it('pagamento parcial não desconta o total da fatura (C2)', async () => {
        const scene = scenario();
        await purchase(scene, scene.roxinho, 1000, '2026-09-05');
        await purchase(scene, scene.roxinho, -100, '2026-09-06');
        await purchase(scene, scene.roxinho, 10, '2026-09-07', { charges: 5 });
        await scene.world.create(scene.base, {
            source: { kind: 'creditCard', creditCardId: scene.roxinho, invoicePeriod: '2026-09' },
            type: 'transference',
            destinationAccountId: scene.accountId,
            value: -300,
            dueDate: '2026-09-20',
            paymentDate: '2026-09-20',
        });

        // Despesas líquidas de estornos, com encargos: 1000 − 100 + 10 + 5 = 915.
        expect(cell(await impact(scene), '2026-10', scene.roxinho)[0]?.total).toEqualMoney('915');
        // O valor a pagar, esse sim, já desconta o pagamento parcial: 915 − 300 = 615.
        const summary = await scene.world.ok('reports.monthSummary', { profileId: scene.profileId, period: '2026-10' });
        expect(summary.openInvoices.amountDue).toEqualMoney('615');
    });

    it('peso = total ÷ receitas do mês; mês sem receita tem peso indefinido', async () => {
        const scene = scenario();
        await purchase(scene, scene.roxinho, 2449.75, '2026-09-05');
        await purchase(scene, scene.click, 612.3, '2026-09-15');
        await income(scene, 9500, '2026-10');

        const result = await impact(scene);
        const october = result.months.find((month) => month.period === '2026-10');
        expect(october?.total).toEqualMoney('3062.05');
        expect(october?.income).toEqualMoney('9500');
        expect(october?.weight).toBeCloseTo(0.3223, 4);
        expect(result.reference.creditCards).toBe(2);
        expect(result.reference.unpaid).toBe(2);
        expect(result.months.find((month) => month.period === '2026-09')?.weight).toBeNull();
    });

    it('transferência entre contas não é receita (C3)', async () => {
        const scene = scenario();
        const savings = scene.world.account(scene.profileId);
        await purchase(scene, scene.roxinho, 100, '2026-09-05');
        await scene.world.create(scene.base, {
            source: { kind: 'account', accountId: savings },
            type: 'transference',
            destinationAccountId: scene.accountId,
            value: 5000,
            dueDate: '2026-10-05',
            paymentDate: '2026-10-05',
        });

        const october = (await impact(scene)).months.find((month) => month.period === '2026-10');
        expect(october?.income).toEqualMoney('0');
        expect(october?.weight).toBeNull();
    });

    it('média dos 3 meses anteriores conta mês sem fatura como zero', async () => {
        const scene = scenario();
        // Faturas do Roxinho de jun e jul vencem em 10/07 e 10/08.
        await purchase(scene, scene.roxinho, 600, '2026-06-05');
        await purchase(scene, scene.roxinho, 300, '2026-07-05');
        await income(scene, 1000, '2026-07');
        await income(scene, 2000, '2026-08');

        const result = await impact(scene);
        // (600 + 300 + 0) / 3 = 300; peso = 900 / 3000.
        expect(result.previousAverage.total).toEqualMoney('300');
        expect(result.previousAverage.weight).toBeCloseTo(0.3, 6);
    });
});
