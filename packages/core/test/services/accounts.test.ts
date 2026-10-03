import { describe, expect, it } from 'vitest';
import type { CoreInput } from '../../src/index.ts';
import { TestWorld } from '../support/TestWorld.ts';

/**
 * @return Um perfil pessoal com subcategoria, num mundo em que "hoje" é 15/03/2026.
 */
function setup(): { world: TestWorld; profileId: string; base: { profileId: string; subCategoryId: string } } {
    const world = new TestWorld('2026-03-15');
    const profileId = world.profile();
    return { world, profileId, base: { profileId, subCategoryId: world.subCategory(profileId) } };
}

/**
 * Edição completa de conta com padrões válidos, para que cada teste declare só o que muda.
 *
 * @param id Conta editada.
 * @param overrides Campos que o teste quer fixar.
 * @return A entrada da rota `accounts.update`.
 */
function edit(id: string, overrides: Partial<CoreInput<'accounts.update'>> = {}): CoreInput<'accounts.update'> {
    return { id, name: 'Conta', type: 'checking', currencyLabel: null, considerBalance: true, openingBalance: 0, ...overrides };
}

describe('cadastro de contas (desktop-mvp-plan Fase 1.2)', () => {
    it('cria com os padrões do schema: moeda do perfil, dentro do total, saldo inicial zero', async () => {
        const { world, profileId } = setup();
        const account = await world.ok('accounts.create', { profileId, name: 'Nubank', type: 'checking' });
        expect(account).toMatchObject({ name: 'Nubank', currency: 'BRL', considerBalance: true, disabled: false });
        expect(account.openingBalance).toEqualMoney('0');
    });

    it('conta de outro perfil não aparece na lista', async () => {
        const { world, profileId } = setup();
        world.account(world.profile(), { name: 'Alheia' });
        await world.ok('accounts.create', { profileId, name: 'Minha', type: 'checking' });
        const list = await world.ok('accounts.list', { profileId, period: '2026-03' });
        expect(list.accounts.map((account) => account.name)).toEqual(['Minha']);
    });
});

describe('testes de mesa do cadastro de contas (desktop-mvp-plan Fase 1.2)', () => {
    it('saldo inicial editado depois de meses lançados recalcula a cadeia inteira (database-design §4.4)', async () => {
        const { world, base, profileId } = setup();
        const accountId = world.account(profileId, { openingBalance: 1000 });
        const source = { kind: 'account', accountId } as const;
        await world.create(base, { source, value: 100, dueDate: '2026-01-10', paymentDate: '2026-01-10' });
        await world.create(base, { source, type: 'income', value: 500, dueDate: '2026-02-05', paymentDate: '2026-02-05' });
        expect(world.statementRow(accountId, '2026-02')?.closing).toEqualMoney('1400');

        const edited = await world.ok('accounts.update', edit(accountId, { openingBalance: 2000 }));

        expect(edited.openingBalance).toEqualMoney('2000');
        expect(world.statementRow(accountId, '2026-01')?.opening).toEqualMoney('2000');
        expect(world.statementRow(accountId, '2026-01')?.closing).toEqualMoney('1900');
        expect(world.statementRow(accountId, '2026-02')?.opening).toEqualMoney('1900');
        expect(world.statementRow(accountId, '2026-02')?.projectedClosing).toEqualMoney('2400');
        expect(world.accountRow(accountId).balance).toEqualMoney('2400');
        expect((await world.ok('integrity.verifyBalances', {})).drifts).toEqual([]);
    });

    it('editar só o nome não recalcula nada: os extratos não são regravados', async () => {
        const { world, base, profileId } = setup();
        const accountId = world.account(profileId, { openingBalance: 1000 });
        await world.create(base, { source: { kind: 'account', accountId }, dueDate: '2026-01-10', paymentDate: '2026-01-10' });
        world.clock.set('2026-03-20');
        await world.ok('accounts.update', edit(accountId, { name: 'Renomeada', openingBalance: 1000 }));
        const touched = world.database.get("SELECT count(*) AS n FROM bank_statements WHERE updated_at LIKE '2026-03-20%'");
        expect(touched).toEqual({ n: 0 });
    });

    it('conta fora do total mantém o próprio saldo e sai da soma do perfil', async () => {
        const { world, profileId } = setup();
        const inside = world.account(profileId, { openingBalance: 300, name: 'A' });
        const outside = world.account(profileId, { openingBalance: 700, name: 'B' });
        await world.ok('accounts.update', edit(outside, { name: 'B', openingBalance: 700, considerBalance: false, currencyLabel: 'USD' }));

        const list = await world.ok('accounts.list', { profileId, period: '2026-03' });
        expect(list.accounts.find((account) => account.id === outside)?.balances.consolidated).toEqualMoney('700');
        expect(list.accounts.find((account) => account.id === outside)?.currency).toBe('USD');
        expect(list.total.consolidated).toEqualMoney('300');
        expect((await world.ok('balances.ofProfile', { profileId })).total.consolidated).toEqualMoney('300');
        expect(list.accounts.find((account) => account.id === inside)?.considerBalance).toBe(true);
    });

    it('a lista mostra o fechamento do mês pedido, herdando o último extrato anterior', async () => {
        const { world, base, profileId } = setup();
        const accountId = world.account(profileId, { openingBalance: 1000 });
        const source = { kind: 'account', accountId } as const;
        await world.create(base, { source, value: 100, dueDate: '2026-01-10', paymentDate: '2026-01-10' });
        await world.create(base, { source, value: 50, dueDate: '2026-04-10' });

        const at = async (period: string): Promise<{ consolidated: unknown; projected: unknown }> => {
            const list = await world.ok('accounts.list', { profileId, period });
            const balances = list.accounts[0]?.balances;
            return { consolidated: balances?.consolidated, projected: balances?.projected };
        };
        expect((await at('2025-12')).consolidated).toEqualMoney('1000');
        expect((await at('2026-02')).consolidated).toEqualMoney('900');
        expect((await at('2026-04')).projected).toEqualMoney('850');
    });

    it('conta desativada mantém saldos, extratos e o lugar no total', async () => {
        const { world, base, profileId } = setup();
        const accountId = world.account(profileId, { openingBalance: 1000 });
        await world.create(base, { source: { kind: 'account', accountId }, value: 100, dueDate: '2026-03-10', paymentDate: '2026-03-10' });
        const before = world.statementRow(accountId, '2026-03');

        const disabled = await world.ok('accounts.disable', { id: accountId });

        expect(disabled.disabled).toBe(true);
        expect(world.statementRow(accountId, '2026-03')).toEqual(before);
        const list = await world.ok('accounts.list', { profileId, period: '2026-03' });
        expect(list.accounts[0]).toMatchObject({ disabled: true });
        expect(list.total.consolidated).toEqualMoney('900');
        expect((await world.ok('accounts.enable', { id: accountId })).disabled).toBe(false);
    });
});

describe('conta desativada nas escolhas de lançamentos (desktop-mvp-plan §5.1)', () => {
    it('recusa a conta desativada como origem e como destino de um lançamento novo', async () => {
        const { world, base, profileId } = setup();
        const active = world.account(profileId);
        const disabled = world.account(profileId);
        await world.ok('accounts.disable', { id: disabled });

        const asOrigin = await world.failure('transactions.create', { ...base, source: { kind: 'account', accountId: disabled }, type: 'expense', name: 'X', value: 1, dueDate: '2026-03-10' });
        expect(asOrigin.details).toMatchObject({ rule: 'account-disabled', field: 'accountId' });

        const asDestination = await world.failure('transactions.create', {
            ...base,
            source: { kind: 'account', accountId: active },
            type: 'transference',
            destinationAccountId: disabled,
            name: 'TED',
            value: 1,
            dueDate: '2026-03-10',
        });
        expect(asDestination.details).toMatchObject({ rule: 'account-disabled', field: 'destinationAccountId' });
    });

    it('editar um lançamento antigo da conta desativada continua permitido; mudar para ela, não', async () => {
        const { world, base, profileId } = setup();
        const accountId = world.account(profileId);
        const other = world.account(profileId);
        const old = await world.create(base, { source: { kind: 'account', accountId }, dueDate: '2026-03-10' });
        const elsewhere = await world.create(base, { source: { kind: 'account', accountId: other }, dueDate: '2026-03-10' });
        await world.ok('accounts.disable', { id: accountId });

        const edited = await world.update(base, old.id, { source: { kind: 'account', accountId }, value: 150 });
        expect(edited.value).toEqualMoney('150');

        const moved = await world.core.call('transactions.update', {
            id: elsewhere.id,
            subCategoryId: base.subCategoryId,
            source: { kind: 'account', accountId },
            type: 'expense',
            name: 'Lançamento',
            value: 100,
            charges: 0,
            description: null,
            destinationAccountId: null,
            partnerId: null,
            goalId: null,
            originCurrency: null,
            conversionRate: 1,
            dueDate: '2026-03-10',
            paymentDate: null,
        });
        expect(moved.ok ? null : moved.error.details['rule']).toBe('account-disabled');
    });

    it('recusa conta desativada como pagadora de cartão novo', async () => {
        const { world, profileId } = setup();
        const accountId = world.account(profileId);
        await world.ok('accounts.disable', { id: accountId });
        const error = await world.failure('creditCards.create', { profileId, accountId, name: 'Cartão', limit: 1000, closingDay: 3, dueDay: 10 });
        expect(error.details).toMatchObject({ rule: 'account-disabled', field: 'accountId' });
    });
});

describe('marcar como pago (desktop-mvp-plan Fase 1.5)', () => {
    it('marca com a data de hoje, recalcula o consolidado e desmarca limpando a data', async () => {
        const { world, base, profileId } = setup();
        const accountId = world.account(profileId, { openingBalance: 1000 });
        const created = await world.create(base, { source: { kind: 'account', accountId }, value: 100, dueDate: '2026-03-20' });
        expect(world.statementRow(accountId, '2026-03')?.closing).toEqualMoney('1000');

        const paid = await world.ok('transactions.setPaid', { id: created.id, paid: true });
        expect(paid).toMatchObject({ paid: true, paymentDate: '2026-03-15' });
        expect(world.statementRow(accountId, '2026-03')?.closing).toEqualMoney('900');

        world.clock.set('2026-03-18');
        const again = await world.ok('transactions.setPaid', { id: created.id, paid: true });
        expect(again.paymentDate).toBe('2026-03-15');

        const reopened = await world.ok('transactions.setPaid', { id: created.id, paid: false });
        expect(reopened).toMatchObject({ paid: false, paymentDate: null });
        expect(world.statementRow(accountId, '2026-03')?.closing).toEqualMoney('1000');
        expect(world.statementRow(accountId, '2026-03')?.projectedClosing).toEqualMoney('900');
    });
});
