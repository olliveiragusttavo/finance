import { describe, expect, it } from 'vitest';
import { projectionBasisMonths, type BalanceProjectionBasis } from '../../src/domain/report/BalanceProjection.ts';
import { YearMonth, type CoreOutput } from '../../src/index.ts';
import { TestWorld } from '../support/TestWorld.ts';

/** Saída da rota, para que os helpers leiam os pontos com o mesmo tipo que o client recebe. */
type Projection = CoreOutput<'reports.balanceProjection'>;

/** Ids do cenário da projeção. */
interface Scene {
    readonly world: TestWorld;
    readonly profileId: string;
}

/**
 * Cenário de 15/10/2026 (faltam 16 dos 31 dias de outubro) numa conta do total com saldo inicial
 * de R$ 1.000,00, primeiro movimento em julho:
 * - avulsos pagos: salário de R$ 5.000,00 em julho, despesas de R$ 3.000,00 em agosto e de
 *   R$ 1.000,00 em setembro, despesa de R$ 500,00 em 02/10 — e, numa conta fora do total, uma
 *   receita de R$ 10.000,00 em agosto, que não pesa;
 * - série fixa de R$ 100,00 (streaming) desde 05/09, com setembro pago e outubro vencido em aberto;
 * - série fixa de R$ 1.000,00 (aluguel) a partir de 05/11;
 * - parcelamento de R$ 900,00 em 3× a partir de 10/11;
 * - despesa avulsa de R$ 200,00 em aberto, para 25/10;
 * - transferência de R$ 250,00 para outro perfil, em aberto, para 20/12.
 * O saldo consolidado de hoje é 1.000 + 5.000 − 3.000 − 1.000 − 100 − 500 = R$ 1.400,00.
 *
 * @return O cenário.
 */
async function scene(): Promise<Scene> {
    const world = new TestWorld('2026-10-15');
    const profileId = world.profile();
    const accountId = world.account(profileId, { openingBalance: 1000 });
    const outside = world.account(profileId, { considerBalance: false });
    const other = world.profile();
    const otherAccount = world.account(other);
    const base = { profileId, subCategoryId: world.subCategory(profileId) };
    const source = { kind: 'account', accountId } as const;
    /**
     * Lançamento pago no próprio dia: o avulso só entra na estimativa (B3) quando pago.
     *
     * @param day Data de vencimento e de pagamento.
     * @return As duas datas do lançamento.
     */
    const paid =(day: string): { readonly dueDate: string; readonly paymentDate: string } => ({ dueDate: day, paymentDate: day });
    await world.create(base, { source, type: 'income', value: 5000, ...paid('2026-07-05') });
    await world.create(base, { source, value: 3000, ...paid('2026-08-10') });
    await world.create(base, { source: { kind: 'account', accountId: outside }, type: 'income', value: 10000, ...paid('2026-08-12') });
    await world.create(base, { source, value: 1000, ...paid('2026-09-10') });
    await world.create(base, { source, value: 500, ...paid('2026-10-02') });
    await world.create(base, { source, name: 'Streaming', value: 100, ...paid('2026-09-05'), repeat: { kind: 'fixed', frequency: 'monthly', endAt: null } });
    await world.create(base, { source, name: 'Aluguel', value: 1000, dueDate: '2026-11-05', repeat: { kind: 'fixed', frequency: 'monthly', endAt: null } });
    await world.create(base, { source, name: 'Geladeira', value: 900, dueDate: '2026-11-10', repeat: { kind: 'installments', frequency: 'monthly', installments: 3, valueType: 'total' } });
    await world.create(base, { source, value: 200, dueDate: '2026-10-25' });
    await world.create(base, { source, type: 'transference', value: 250, dueDate: '2026-12-20', destinationAccountId: otherAccount });
    return { world, profileId };
}

/**
 * @param projection Projeção da rota.
 * @param period Mês procurado.
 * @return O ponto do mês.
 * @throws {Error} Quando o mês não está na projeção.
 */
function pointAt(projection: Projection, period: string): Projection['points'][number] {
    const point = projection.points.find((entry) => entry.period === period);
    if (point === undefined) {
        throw new Error(`mês ${period} fora da projeção`);
    }
    return point;
}

describe('projeção de saldo (reports-design §9)', () => {
    it('Regra de negócio (Relatórios, B1): a estimativa usa só os meses fechados desde o primeiro extrato', () => {
        const october = YearMonth.of(2026, 10);
        /**
         * Os meses da estimativa como texto, para comparar com `toEqual` sem montar `YearMonth`.
         *
         * @param basis Janela pedida.
         * @param first Mês do primeiro extrato; `null` sem movimento.
         * @return Os meses da estimativa, do mais antigo ao mais recente.
         */
        const months = (basis: BalanceProjectionBasis, first: YearMonth | null): readonly string[] => projectionBasisMonths(basis, october, first).map((month) => month.toString());
        expect(months(3, YearMonth.of(2020, 1))).toEqual(['2026-07', '2026-08', '2026-09']);
        expect(months(1, YearMonth.of(2020, 1))).toEqual(['2026-09']);
        // Virada de ano: 12 meses fechados até setembro começam em outubro do ano anterior.
        expect(months(12, YearMonth.of(2020, 1))[0]).toBe('2025-10');
        expect(months(12, YearMonth.of(2026, 7))).toEqual(['2026-07', '2026-08', '2026-09']);
        // O primeiro extrato no mês corrente não deixa mês fechado para a média.
        expect(months(12, october)).toEqual([]);
        expect(months(12, null)).toEqual([]);
    });

    it('Regra de negócio (Relatórios, B3): o histórico separa os avulsos das séries, e só os avulsos formam a estimativa', async () => {
        const s = await scene();
        const projection = await s.world.ok('reports.balanceProjection', { profileId: s.profileId });
        expect(projection.start.amount).toBe(1400);
        // A conta fora do total não pesa; o streaming pago em setembro é série, e não entra na média.
        expect(projection.history.map((month) => [month.period, month.result.amount, month.nonRecurring.amount, month.recurring.amount])).toEqual([
            ['2026-07', 5000, 5000, 0],
            ['2026-08', -3000, -3000, 0],
            ['2026-09', -1100, -1000, -100],
        ]);
        expect(projection.average.amount).toBe(333.33);
        // Desvio-padrão amostral de 5.000, −3.000 e −1.000.
        expect(projection.deviation.amount).toBeCloseTo(4163.33, 2);
    });

    it('Regra de negócio (Relatórios, B2): o comprometido de cada mês é o que já está lançado, e a linha deixa de ser reta', async () => {
        const s = await scene();
        const projection = await s.world.ok('reports.balanceProjection', { profileId: s.profileId });
        const estimate = 1000 / 3;
        const restOfOctober = estimate * 16 / 31;
        // Outubro: o que falta é a conta de R$ 200,00 e o streaming vencido, mais a parte dos avulsos dos 16 dias restantes.
        const october = pointAt(projection, '2026-10');
        expect(october.scheduled.amount).toBe(-300);
        expect(october.estimated.amount).toBeCloseTo(restOfOctober, 2);
        expect(october.balance.amount).toBeCloseTo(1400 - 300 + restOfOctober, 2);
        // Novembro e dezembro: aluguel, parcela e streaming; dezembro ainda tem a transferência para o outro perfil.
        expect(pointAt(projection, '2026-11').scheduled.amount).toBe(-1400);
        expect(pointAt(projection, '2026-12').scheduled.amount).toBe(-1650);
        // Fevereiro: as parcelas acabaram em janeiro.
        expect(pointAt(projection, '2027-01').scheduled.amount).toBe(-1400);
        expect(pointAt(projection, '2027-02').scheduled.amount).toBe(-1100);
        expect(pointAt(projection, '2027-02').balance.amount).toBeCloseTo(1400 - 300 + restOfOctober - 1400 - 1650 - 1400 - 1100 + 4 * estimate, 2);
        expect(projection.points.map((point) => point.period)).toHaveLength(13);
        expect(projection.points.at(-1)?.period).toBe('2027-10');
    });

    it('Regra de negócio (Relatórios, B5): a faixa abre com a raiz do horizonte', async () => {
        const s = await scene();
        const projection = await s.world.ok('reports.balanceProjection', { profileId: s.profileId });
        const deviation = projection.deviation.amount;
        /**
         * Meia largura da faixa: é ela que cresce com a raiz do horizonte (B5).
         *
         * @param period Mês da projeção.
         * @return Otimista menos projetado no mês.
         */
        const spread =(period: string): number => pointAt(projection, period).high.amount - pointAt(projection, period).balance.amount;
        expect(spread('2026-10')).toBeCloseTo(deviation * Math.sqrt(16 / 31), 1);
        expect(spread('2026-11')).toBeCloseTo(deviation * Math.sqrt(1 + 16 / 31), 1);
        expect(spread('2027-10')).toBeCloseTo(deviation * Math.sqrt(12 + 16 / 31), 1);
        expect(pointAt(projection, '2027-10').balance.amount - pointAt(projection, '2027-10').low.amount).toBeCloseTo(spread('2027-10'), 1);
    });

    it('Regra de negócio (Relatórios, B1): a janela escolhida muda a estimativa; com um mês só não há faixa', async () => {
        const s = await scene();
        const lastMonth = await s.world.ok('reports.balanceProjection', { profileId: s.profileId, basis: 1 });
        expect(lastMonth.history.map((month) => month.period)).toEqual(['2026-09']);
        expect(lastMonth.average.amount).toBe(-1000);
        expect(lastMonth.deviation.amount).toBe(0);
        expect(pointAt(lastMonth, '2026-11').low).toEqual(pointAt(lastMonth, '2026-11').balance);
        // Fora da lista de janelas: a entrada chega crua, como da ponte, e a rota recusa.
        const outsideList = { profileId: s.profileId, basis: 5 };
        const refused = await s.world.core.dispatch('reports.balanceProjection', outsideList);
        expect(refused.ok ? null : refused.error.code).toBe('VALIDATION_FAILED');
    });

    it('Regra de negócio (Relatórios, B3): o pagamento parcial de fatura é avulso, no mês em que sai da conta', async () => {
        const world = new TestWorld('2026-10-15');
        const profileId = world.profile();
        const accountId = world.account(profileId, { openingBalance: 1000 });
        const creditCardId = world.creditCard(profileId, accountId, 25, 5);
        const base = { profileId, subCategoryId: world.subCategory(profileId) };
        const source = { kind: 'creditCard', creditCardId, invoicePeriod: '2026-07' } as const;
        await world.create(base, { source, value: 400, dueDate: '2026-07-03' });
        await world.create(base, { source, type: 'transference', destinationAccountId: accountId, value: -150, charges: 3, dueDate: '2026-07-12', paymentDate: '2026-07-12' });
        await world.payInvoice(creditCardId, '2026-07', '2026-08-05');
        const projection = await world.ok('reports.balanceProjection', { profileId, basis: 3 });
        // Sem série nenhuma, todo o resultado é avulso: o parcial sai em julho e a fatura é paga líquida dele em agosto.
        expect(projection.history.map((month) => [month.period, month.result.amount, month.nonRecurring.amount, month.recurring.amount])).toEqual([
            ['2026-07', -150, -150, 0],
            ['2026-08', -253, -253, 0],
            ['2026-09', 0, 0, 0],
        ]);
    });

    it('sem histórico nem lançamento futuro, a projeção repete o saldo de hoje', async () => {
        const world = new TestWorld('2026-10-15');
        const profileId = world.profile();
        world.account(profileId, { openingBalance: 800 });
        const projection = await world.ok('reports.balanceProjection', { profileId });
        expect(projection.history).toEqual([]);
        expect(projection.average.amount).toBe(0);
        expect(projection.points.every((point) => point.balance.amount === 800 && point.high.amount === 800)).toBe(true);
    });

    it('vale para o perfil empresarial e recusa perfil inexistente', async () => {
        const world = new TestWorld('2026-10-15');
        const business = world.profile({ type: 'business' });
        world.account(business, { openingBalance: 50 });
        expect((await world.ok('reports.balanceProjection', { profileId: business })).start.amount).toBe(50);
        expect((await world.failure('reports.balanceProjection', { profileId: '00000000-0000-4000-8000-0000000000ff' })).code).toBe('NOT_FOUND');
    });
});
