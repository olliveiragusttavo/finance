import { describe, expect, it } from 'vitest';
import type { AccountFlowMonthResponse, AccountFlowResponse, BalancePairResponse, CoreInput } from '../../src/index.ts';
import { TestWorld } from '../support/TestWorld.ts';

/** O cenário do mockup `DesktopRelFluxo`: uma conta corrente que paga um cartão. */
interface Scenario {
    readonly world: TestWorld;
    readonly profileId: string;
    readonly nubank: string;
    /** Fecha no dia 28 e vence no dia 10: a fatura de setembro vence em 10/10. */
    readonly card: string;
    readonly base: { readonly profileId: string; readonly subCategoryId: string };
}

/**
 * Hoje é 03/10/2026: julho a setembro são passados, outubro é o mês corrente e novembro, futuro.
 *
 * @return O mundo e os ids semeados.
 */
function scenario(): Scenario {
    const world = new TestWorld('2026-10-03');
    const profileId = world.profile();
    const nubank = world.account(profileId, { openingBalance: 3100, name: 'Nubank' });
    return {
        world,
        profileId,
        nubank,
        card: world.creditCard(profileId, nubank, 28, 10),
        base: { profileId, subCategoryId: world.subCategory(profileId) },
    };
}

/**
 * @param scene Cenário.
 * @param accountId Conta da movimentação.
 * @param overrides Tipo, valor e datas; sem `paymentDate`, fica em aberto.
 * @return void
 */
async function move(scene: Scenario, accountId: string, overrides: Partial<CoreInput<'transactions.create'>>): Promise<void> {
    await scene.world.create(scene.base, { source: { kind: 'account', accountId }, ...overrides });
}

/**
 * @param scene Cenário.
 * @param accountId Conta pedida; ausente soma as contas do total.
 * @param period Mês de referência.
 * @return O relatório pela rota real.
 */
async function flow(scene: Scenario, accountId?: string, period = '2026-10'): Promise<AccountFlowResponse> {
    return scene.world.ok('reports.accountFlow', { profileId: scene.profileId, period, ...(accountId === undefined ? {} : { accountId }) });
}

/**
 * @param result Relatório.
 * @param period Mês da coluna.
 * @return O mês pedido.
 * @throws {Error} Quando o mês está fora da janela — o teste pediu a coluna errada.
 */
function month(result: AccountFlowResponse, period: string): AccountFlowMonthResponse {
    const found = result.months.find((candidate) => candidate.period === period);
    if (found === undefined) {
        throw new Error(`o mês ${period} não está na janela`);
    }
    return found;
}

/**
 * Soma em centavos, para conferir a cadeia sem o ruído do ponto flutuante.
 *
 * @param pairs Pares somados.
 * @param side Consolidado ou previsto.
 * @return A soma em centavos.
 */
function cents(pairs: readonly BalancePairResponse[], side: keyof BalancePairResponse): number {
    return pairs.reduce((total, pair) => total + Math.round(pair[side].amount * 100), 0);
}

describe('Fluxo por conta — extratos encadeados (F1, F2)', () => {
    it('janela com os 3 meses anteriores, o de referência e o seguinte, e a situação de cada um pelo dia de hoje', async () => {
        const scene = scenario();
        const result = await flow(scene, scene.nubank);
        expect(result.months.map((candidate) => candidate.period)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
        expect(result.months.map((candidate) => candidate.timing)).toEqual(['past', 'past', 'past', 'current', 'future']);
        expect(result.scope).toEqual({ kind: 'account', accountId: scene.nubank, accountName: 'Nubank' });
        // Referência no passado: o mês seguinte a ela já é o corrente.
        const earlier = await flow(scene, scene.nubank, '2026-09');
        expect(earlier.months.map((candidate) => candidate.timing)).toEqual(['past', 'past', 'past', 'past', 'current']);
    });

    it('o final de um mês é o inicial do seguinte, e inicial + entradas + saídas + faturas = final nos dois saldos', async () => {
        const scene = scenario();
        await move(scene, scene.nubank, { type: 'income', value: 9500, dueDate: '2026-08-05', paymentDate: '2026-08-05' });
        await move(scene, scene.nubank, { value: 4210, dueDate: '2026-08-10', paymentDate: '2026-08-10' });
        await move(scene, scene.nubank, { value: 900, dueDate: '2026-10-20' });
        await scene.world.create(scene.base, { source: { kind: 'creditCard', creditCardId: scene.card }, value: 2449.75, dueDate: '2026-09-05' });

        const result = await flow(scene, scene.nubank);
        for (const [index, current] of result.months.entries()) {
            for (const side of ['consolidated', 'projected'] as const) {
                expect(cents([current.opening, current.inflows, current.outflows, current.invoices], side)).toBe(cents([current.closing], side));
                const previous = result.months[index - 1];
                if (previous !== undefined) {
                    expect(current.opening[side]).toEqual(previous.closing[side]);
                }
            }
        }
        expect(month(result, '2026-07').opening.consolidated).toEqualMoney('3100');
        expect(month(result, '2026-08').closing.consolidated).toEqualMoney('8390');
    });

    it('concorda com o extrato da tela Contas em todos os meses', async () => {
        const scene = scenario();
        await move(scene, scene.nubank, { type: 'income', value: 9500, dueDate: '2026-10-05', paymentDate: '2026-10-05' });
        await move(scene, scene.nubank, { value: 300, dueDate: '2026-10-25' });
        await scene.world.create(scene.base, { source: { kind: 'creditCard', creditCardId: scene.card }, value: 800, dueDate: '2026-09-05' });
        await scene.world.create(scene.base, { source: { kind: 'creditCard', creditCardId: scene.card }, value: 200, dueDate: '2026-10-05' });

        const result = await flow(scene, scene.nubank);
        for (const current of result.months) {
            const statement = await scene.world.ok('statements.get', { accountId: scene.nubank, period: current.period });
            expect(current.opening).toEqual(statement.opening);
            expect(current.closing).toEqual(statement.closing);
            for (const side of ['consolidated', 'projected'] as const) {
                expect(cents([current.inflows, current.outflows, current.invoices], side)).toBe(cents([statement.inflows, statement.outflows], side));
            }
        }
    });
});

describe('Fluxo por conta — linhas do mês (F3, F5)', () => {
    it('fatura em aberto pesa só no previsto do vencimento; paga, nos dois saldos do mês do pagamento', async () => {
        const scene = scenario();
        await scene.world.create(scene.base, { source: { kind: 'creditCard', creditCardId: scene.card }, value: 2449.75, dueDate: '2026-09-05' });

        const open = month(await flow(scene, scene.nubank), '2026-10');
        expect(open.invoices.consolidated).toEqualMoney('0');
        expect(open.invoices.projected).toEqualMoney('-2449.75');
        expect(open.outflows.projected).toEqualMoney('0');

        await scene.world.payInvoice(scene.card, '2026-09', '2026-10-08');
        const paid = month(await flow(scene, scene.nubank), '2026-10');
        expect(paid.invoices.consolidated).toEqualMoney('-2449.75');
        expect(paid.invoices.projected).toEqualMoney('-2449.75');
    });

    it('pagamento parcial de fatura entra na linha das faturas, no mês em que saiu da conta', async () => {
        const scene = scenario();
        await scene.world.create(scene.base, { source: { kind: 'creditCard', creditCardId: scene.card }, value: 1000, dueDate: '2026-09-05' });
        await scene.world.create(scene.base, {
            source: { kind: 'creditCard', creditCardId: scene.card, invoicePeriod: '2026-09' },
            type: 'transference',
            destinationAccountId: scene.nubank,
            value: -300,
            dueDate: '2026-09-20',
            paymentDate: '2026-09-20',
        });

        const result = await flow(scene, scene.nubank);
        expect(month(result, '2026-09').invoices.consolidated).toEqualMoney('-300');
        expect(month(result, '2026-09').outflows.consolidated).toEqualMoney('0');
        // O que falta da fatura vence em outubro, já líquido do parcial.
        expect(month(result, '2026-10').invoices.projected).toEqualMoney('-700');
    });

    it('lançamento em aberto fica só no previsto; o estorno e a receita entram nas entradas', async () => {
        const scene = scenario();
        await move(scene, scene.nubank, { value: 500, dueDate: '2026-10-20' });
        await move(scene, scene.nubank, { value: 200, dueDate: '2026-10-02', paymentDate: '2026-10-02', charges: 2 });
        await move(scene, scene.nubank, { value: -50, dueDate: '2026-10-03', paymentDate: '2026-10-03' });
        await move(scene, scene.nubank, { type: 'income', value: 1000, dueDate: '2026-10-05', paymentDate: '2026-10-05' });

        const october = month(await flow(scene, scene.nubank), '2026-10');
        expect(october.outflows.consolidated).toEqualMoney('-202');
        expect(october.outflows.projected).toEqualMoney('-702');
        expect(october.inflows.consolidated).toEqualMoney('1050');
        expect(october.inflows.projected).toEqualMoney('1050');
        expect(october.invoices.projected).toEqualMoney('0');
    });
});

describe('Fluxo por conta — contas do total (F4, F6)', () => {
    it('soma os extratos das contas do total: a transferência interna aparece nos dois lados e os saldos não mudam', async () => {
        const scene = scenario();
        const savings = scene.world.account(scene.profileId, { openingBalance: 1000, name: 'Poupança' });
        await move(scene, scene.nubank, { type: 'transference', destinationAccountId: savings, value: 500, dueDate: '2026-10-05', paymentDate: '2026-10-05' });

        const result = await flow(scene);
        const october = month(result, '2026-10');
        expect(result.scope.kind === 'total' && [...result.scope.accountIds].sort()).toEqual([scene.nubank, savings].sort());
        expect(october.inflows.consolidated).toEqualMoney('500');
        expect(october.outflows.consolidated).toEqualMoney('-500');
        expect(october.opening.consolidated).toEqualMoney('4100');
        expect(october.closing.consolidated).toEqualMoney('4100');
    });

    it('conta fora do total fica fora da soma, mas pode ser pedida sozinha; desativada continua na soma', async () => {
        const scene = scenario();
        const wise = scene.world.account(scene.profileId, { openingBalance: 800, considerBalance: false, name: 'Wise' });
        const old = scene.world.account(scene.profileId, { openingBalance: 200, name: 'Antiga' });
        await scene.world.ok('accounts.disable', { id: old });
        await move(scene, wise, { value: 100, dueDate: '2026-10-05', paymentDate: '2026-10-05' });

        const total = await flow(scene);
        expect(total.scope.kind === 'total' && total.scope.accountIds).toEqual(expect.arrayContaining([scene.nubank, old]));
        expect(total.scope.kind === 'total' && total.scope.accountIds).not.toContain(wise);
        expect(month(total, '2026-10').opening.consolidated).toEqualMoney('3300');
        expect(month(total, '2026-10').outflows.consolidated).toEqualMoney('0');

        const alone = month(await flow(scene, wise), '2026-10');
        expect(alone.outflows.consolidated).toEqualMoney('-100');
        expect(alone.closing.consolidated).toEqualMoney('700');
    });

    it('recusa conta de outro perfil', async () => {
        const scene = scenario();
        const otherProfile = scene.world.profile();
        const foreign = scene.world.account(otherProfile);

        const failure = await scene.world.failure('reports.accountFlow', { profileId: scene.profileId, period: '2026-10', accountId: foreign });
        expect(failure.code).toBe('NOT_FOUND');
    });
});
