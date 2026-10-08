import { describe, expect, it } from 'vitest';
import { TestWorld } from '../support/TestWorld.ts';

/**
 * @return Um perfil pessoal com conta e subcategoria.
 */
function setup(): { world: TestWorld; profileId: string; accountId: string; base: { profileId: string; subCategoryId: string } } {
    const world = new TestWorld('2026-03-15');
    const profileId = world.profile();
    const accountId = world.account(profileId);
    return { world, profileId, accountId, base: { profileId, subCategoryId: world.subCategory(profileId) } };
}

describe('ponto de controle das regras de negócio (database-design §3.10)', () => {
    it('recusa sócio pagador num perfil pessoal', async () => {
        const { world, accountId, base } = setup();
        const business = world.profile({ type: 'business' });
        const error = await world.failure('transactions.create', {
            ...base,
            source: { kind: 'account', accountId },
            type: 'expense',
            name: 'Aluguel',
            value: 100,
            dueDate: '2026-03-10',
            partnerId: world.partner(business),
        });
        expect(error.code).toBe('BUSINESS_RULE_VIOLATION');
        expect(error.details['rule']).toBe('partner-requires-business-profile');
    });

    it('aceita sócio pagador do próprio perfil empresarial', async () => {
        const world = new TestWorld();
        const profileId = world.profile({ type: 'business' });
        const accountId = world.account(profileId);
        const created = await world.create(
            { profileId, subCategoryId: world.subCategory(profileId) },
            { source: { kind: 'account', accountId }, partnerId: world.partner(profileId) },
        );
        expect(created.partnerId).not.toBeNull();
    });

    it('recusa referência de outro perfil — pessoal e empresarial ficam separados', async () => {
        const { world, accountId, base } = setup();
        const otherProfile = world.profile();
        const error = await world.failure('transactions.create', {
            ...base,
            subCategoryId: world.subCategory(otherProfile),
            source: { kind: 'account', accountId },
            type: 'expense',
            name: 'Mercado',
            value: 100,
            dueDate: '2026-03-10',
        });
        expect(error.code).toBe('BUSINESS_RULE_VIOLATION');
        expect(error.details['field']).toBe('subCategoryId');
    });

    it('exige conta de destino em transferência e recusa destino igual à origem', async () => {
        const { world, accountId, base } = setup();
        const input = { ...base, source: { kind: 'account', accountId } as const, type: 'transference' as const, name: 'TED', value: 100, dueDate: '2026-03-10' };
        expect((await world.failure('transactions.create', input)).details['rule']).toBe('destination-required');
        expect((await world.failure('transactions.create', { ...input, destinationAccountId: accountId })).details['rule']).toBe('destination-equals-origin');
    });

    it('recusa conta de destino numa despesa', async () => {
        const { world, profileId, accountId, base } = setup();
        const error = await world.failure('transactions.create', {
            ...base,
            source: { kind: 'account', accountId },
            type: 'expense',
            name: 'Mercado',
            value: 100,
            dueDate: '2026-03-10',
            destinationAccountId: world.account(profileId),
        });
        expect(error.details['rule']).toBe('destination-not-allowed');
    });

    it('recusa pagar uma fatura já paga', async () => {
        const { world, profileId, accountId, base } = setup();
        const creditCardId = world.creditCard(profileId, accountId, 10, 17);
        const purchase = await world.create(base, { source: { kind: 'creditCard', creditCardId }, dueDate: '2026-03-05' });
        if (purchase.container.kind !== 'invoice') {
            throw new Error('compra no cartão deveria cair numa fatura');
        }
        await world.ok('invoices.pay', { invoiceId: purchase.container.invoiceId, paymentDate: '2026-03-17' });
        const error = await world.failure('invoices.pay', { invoiceId: purchase.container.invoiceId, paymentDate: '2026-03-18' });
        expect(error.details['rule']).toBe('invoice-already-paid');
    });
});

describe('camada Request e CoreResult (desktop-shell-design §5.3)', () => {
    it('devolve VALIDATION_FAILED apontando o campo de uma data inexistente', async () => {
        const { world, accountId, base } = setup();
        const error = await world.failure('transactions.create', {
            ...base,
            source: { kind: 'account', accountId },
            type: 'expense',
            name: 'Mercado',
            value: 100,
            dueDate: '2026-02-30',
        });
        expect(error.code).toBe('VALIDATION_FAILED');
        expect(error.details['field']).toBe('dueDate');
    });

    it('a edição exige a transação completa: omitir encargos é erro, não apagamento silencioso', async () => {
        const { world, accountId, base } = setup();
        const created = await world.create(base, { source: { kind: 'account', accountId }, charges: 5, description: 'nota' });
        const result = await world.core.dispatch('transactions.update', {
            id: created.id,
            subCategoryId: base.subCategoryId,
            source: { kind: 'account', accountId },
            type: 'expense',
            name: 'Lançamento',
            value: 100,
            dueDate: '2026-03-10',
        });
        expect(result.ok ? null : result.error.code).toBe('VALIDATION_FAILED');
        const unchanged = await world.ok('transactions.get', { id: created.id });
        expect(unchanged.charges).toEqualMoney('5');
        expect(unchanged.description).toBe('nota');
    });

    it('recusa campos desconhecidos em vez de ignorá-los', async () => {
        const { world } = setup();
        const result = await world.core.dispatch('transactions.get', { id: '00000000-0000-4000-8000-000000000001', extra: true });
        expect(result.ok).toBe(false);
    });

    it('devolve NOT_FOUND para transação inexistente e VALIDATION_FAILED para rota desconhecida', async () => {
        const { world } = setup();
        expect((await world.failure('transactions.get', { id: '00000000-0000-4000-8000-0000000fffff' })).code).toBe('NOT_FOUND');
        const unknown = await world.core.dispatch('transactions.explode', {});
        expect(unknown.ok ? null : unknown.error.code).toBe('VALIDATION_FAILED');
    });

    it('todo DTO sobrevive a structuredClone, como no IPC do desktop (mobile-shell-design §4.4)', async () => {
        const { world, profileId, accountId, base } = setup();
        const creditCardId = world.creditCard(profileId, accountId, 10, 17);
        const transaction = await world.create(base, { source: { kind: 'creditCard', creditCardId }, dueDate: '2026-03-05' });
        const outputs = [
            transaction,
            await world.ok('statements.get', { accountId, period: '2026-03' }),
            await world.ok('balances.ofProfile', { profileId }),
            await world.ok('invoices.suggest', { creditCardId, purchaseDate: '2026-03-05' }),
            await world.ok('transactions.listByPeriod', { profileId, period: '2026-03' }),
        ];
        for (const output of outputs) {
            // toStrictEqual compara também o tipo: uma instância de classe vazada no DTO
            // voltaria do clone como objeto simples e falharia aqui.
            expect(structuredClone(output)).toStrictEqual(output);
        }
    });
});
