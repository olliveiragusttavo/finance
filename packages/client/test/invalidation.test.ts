import type { CoreInput, CoreOutput, CoreResult, CoreRoute } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { allRoutes, invalidatedBy, isReadRoute, type ReadRoute, type WriteRoute } from '../src/index.ts';
import { ClientWorld, type Scenario } from './support/ClientWorld.ts';

const PERIOD = '2026-10';

/** Uma leitura concreta: rota e entrada, executada antes e depois de cada escrita. */
type Probe = { readonly [R in ReadRoute]: { readonly route: R; readonly input: CoreInput<R> } }[ReadRoute];

/**
 * Leituras do cenário, várias por rota quando o mês importa: a escrita de outubro também
 * precisa invalidar novembro (saldo de abertura) e o mês seguinte da evolução.
 *
 * @param s Ids do cenário.
 * @return As sondas, cobrindo toda rota de leitura.
 */
function probes(s: Scenario): readonly Probe[] {
    return [
        { route: 'profiles.list', input: {} },
        ...['2026-09', PERIOD, '2026-11'].flatMap((period): Probe[] => [
            { route: 'accounts.list', input: { profileId: s.profileId, period } },
            { route: 'creditCards.list', input: { profileId: s.profileId, period } },
            { route: 'transactions.listByPeriod', input: { profileId: s.profileId, period } },
            { route: 'statements.get', input: { accountId: s.checkingId, period } },
            { route: 'statements.get', input: { accountId: s.savingsId, period } },
            { route: 'reports.monthSummary', input: { profileId: s.profileId, period } },
            { route: 'reports.byCategory', input: { profileId: s.profileId, period } },
            { route: 'reports.categoryTransactions', input: { profileId: s.profileId, period, subCategoryId: s.subCategoryId } },
            { route: 'reports.cardImpact', input: { profileId: s.profileId, period } },
        ]),
        { route: 'accounts.deletionImpact', input: { id: s.savingsId } },
        { route: 'creditCards.deletionImpact', input: { id: s.creditCardId } },
        { route: 'categories.tree', input: { profileId: s.profileId } },
        { route: 'transactions.get', input: { id: s.purchaseId } },
        { route: 'transactions.get', input: { id: s.expenseId } },
        { route: 'balances.ofProfile', input: { profileId: s.profileId } },
        { route: 'invoices.suggest', input: { creditCardId: s.creditCardId, purchaseDate: '2026-10-20' } },
        { route: 'invoices.get', input: { invoiceId: s.openInvoiceId } },
        { route: 'invoices.get', input: { invoiceId: s.paidInvoiceId } },
        { route: 'invoices.listByCard', input: { creditCardId: s.creditCardId, from: PERIOD } },
        { route: 'integrity.verifyBalances', input: {} },
        { route: 'reports.balanceEvolution', input: { profileId: s.profileId, period: '2026-12', months: 6 } },
    ];
}

/**
 * Uma escrita válida no cenário. `prepare` põe o cenário no estado em que a escrita faz
 * sentido (reativar exige estar desativado); `unchanged` marca a única escrita que, num banco
 * íntegro, não muda nenhuma leitura — o reparo de saldo só tem efeito com cache divergente.
 */
type Write = {
    readonly [W in WriteRoute]: {
        readonly route: W;
        readonly input: (s: Scenario) => CoreInput<W>;
        readonly prepare?: (world: ClientWorld, s: Scenario) => Promise<unknown>;
        readonly unchanged?: true;
    }
}[WriteRoute];

const ACCOUNT_UPDATE = { name: 'Tesouro Selic', type: 'investment', currencyLabel: null, considerBalance: false, openingBalance: 250 } as const;
const CARD_CONTENT = { name: 'Roxinho Black', limit: 9000, closingDay: 8, dueDay: 15 } as const;

/**
 * Uma escrita de cada rota, com entrada que o núcleo aceita no cenário e que muda algo de
 * fato — uma escrita inócua passaria no teste sem provar nada.
 */
const WRITES: readonly Write[] = [
    { route: 'profiles.create', input: () => ({ name: 'Empresa', type: 'business', currency: 'BRL' }) },
    { route: 'profiles.update', input: (s) => ({ id: s.profileId, name: 'Casa', currency: 'BRL' }) },
    {
        route: 'onboarding.start',
        input: () => ({ profile: { name: 'Outro', type: 'personal', currency: 'USD' }, account: { name: 'Wise', type: 'checking' } }),
    },
    { route: 'accounts.create', input: (s) => ({ profileId: s.profileId, name: 'Itaú', type: 'checking', openingBalance: 300 }) },
    { route: 'accounts.update', input: (s) => ({ id: s.savingsId, ...ACCOUNT_UPDATE }) },
    { route: 'accounts.disable', input: (s) => ({ id: s.savingsId }) },
    { route: 'accounts.enable', input: (s) => ({ id: s.savingsId }), prepare: (world, s) => world.ok('accounts.disable', { id: s.savingsId }) },
    { route: 'accounts.delete', input: (s) => ({ id: s.savingsId }) },
    { route: 'creditCards.create', input: (s) => ({ profileId: s.profileId, accountId: s.checkingId, name: 'Itaú Click', limit: 2000, closingDay: 1, dueDay: 7 }) },
    { route: 'creditCards.update', input: (s) => ({ id: s.creditCardId, accountId: s.savingsId, ...CARD_CONTENT }) },
    { route: 'creditCards.disable', input: (s) => ({ id: s.creditCardId }) },
    { route: 'creditCards.enable', input: (s) => ({ id: s.creditCardId }), prepare: (world, s) => world.ok('creditCards.disable', { id: s.creditCardId }) },
    { route: 'creditCards.delete', input: (s) => ({ id: s.creditCardId }) },
    { route: 'categories.create', input: (s) => ({ profileId: s.profileId, name: 'Saúde' }) },
    { route: 'categories.update', input: (s) => ({ id: s.categoryId, name: 'Comida' }) },
    { route: 'categories.delete', input: (s) => ({ id: s.categoryId, moveTo: s.housingSubCategoryId }) },
    { route: 'subCategories.create', input: (s) => ({ categoryId: s.categoryId, name: 'Delivery' }) },
    { route: 'subCategories.update', input: (s) => ({ id: s.subCategoryId, name: 'Supermercado' }) },
    { route: 'subCategories.delete', input: (s) => ({ id: s.subCategoryId, moveTo: s.otherSubCategoryId }) },
    {
        route: 'transactions.create',
        input: (s) => ({ profileId: s.profileId, subCategoryId: s.subCategoryId, type: 'expense', source: { kind: 'creditCard', creditCardId: s.creditCardId }, name: 'Padaria', value: 30, dueDate: '2026-10-12' }),
    },
    {
        route: 'transactions.update',
        input: (s) => ({
            id: s.expenseId,
            type: 'expense',
            source: { kind: 'account', accountId: s.checkingId },
            subCategoryId: s.otherSubCategoryId,
            destinationAccountId: null,
            partnerId: null,
            goalId: null,
            name: 'Aluguel reajustado',
            description: null,
            value: 2400,
            charges: 0,
            originCurrency: null,
            conversionRate: 1,
            dueDate: '2026-11-05',
            paymentDate: null,
        }),
    },
    { route: 'transactions.delete', input: (s) => ({ id: s.purchaseId }) },
    { route: 'transactions.setPaid', input: (s) => ({ id: s.expenseId, paid: true }) },
    { route: 'balances.rebuildAccount', input: (s) => ({ accountId: s.checkingId }), unchanged: true },
    { route: 'invoices.pay', input: (s) => ({ invoiceId: s.openInvoiceId, paymentDate: '2026-10-09' }) },
    { route: 'invoices.reopen', input: (s) => ({ invoiceId: s.paidInvoiceId }) },
];

/**
 * Chama uma rota de uma união rota/entrada. O genérico correlaciona as duas — com a união
 * direta, o compilador não sabe que a entrada é a daquela rota.
 *
 * @param world Núcleo do teste.
 * @param call Rota e entrada correspondentes.
 * @return O resultado da rota.
 */
function invoke<R extends CoreRoute>(world: ClientWorld, call: { readonly route: R; readonly input: CoreInput<R> }): Promise<CoreResult<CoreOutput<R>>> {
    return world.client.call(call.route, call.input);
}

/**
 * @param world Núcleo do teste.
 * @param list Sondas a executar.
 * @return O resultado serializado de cada sonda, na ordem.
 */
async function snapshot(world: ClientWorld, list: readonly Probe[]): Promise<readonly string[]> {
    return Promise.all(list.map(async (probe) => JSON.stringify(await invoke(world, probe))));
}

describe('mapa de invalidação (desktop-mvp-plan Fase 3.2 e §8)', () => {
    it('toda rota de escrita do núcleo tem uma escrita neste teste, e toda leitura tem sonda', async () => {
        const world = new ClientWorld();
        const covered = new Set([...WRITES.map((write) => write.route), ...probes(await world.seed()).map((probe) => probe.route)]);
        expect(allRoutes().filter((route) => !covered.has(route))).toEqual([]);
    });

    it.each(WRITES.map((write) => [write.route, write] as const))(
        '%s invalida toda leitura cujo resultado muda',
        async (_route, write) => {
            const world = new ClientWorld();
            const scenario = await world.seed();
            await write.prepare?.(world, scenario);
            const list = probes(scenario);
            const before = await snapshot(world, list);
            const result = await invoke(world, { route: write.route, input: write.input(scenario) });
            expect(result.ok, JSON.stringify(result)).toBe(true);
            const after = await snapshot(world, list);

            const changed = new Set(list.filter((_probe, index) => before[index] !== after[index]).map((probe) => probe.route));
            if (write.unchanged !== true) {
                expect(changed.size, 'a escrita do teste não mudou nada; ela não prova o mapa').toBeGreaterThan(0);
            }
            const invalidated = new Set(invalidatedBy(write.route));
            expect([...changed].filter((route) => !invalidated.has(route))).toEqual([]);
        },
    );

    it('só invalida leituras', () => {
        for (const route of allRoutes()) {
            if (!isReadRoute(route)) {
                expect(invalidatedBy(route).every(isReadRoute)).toBe(true);
            }
        }
    });
});
