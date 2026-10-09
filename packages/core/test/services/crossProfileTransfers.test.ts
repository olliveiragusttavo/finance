import { describe, expect, it } from 'vitest';
import { TestWorld } from '../support/TestWorld.ts';

/**
 * Dois perfis na mesma moeda, cada um com uma conta: o pessoal com 1000 e a empresa com 200.
 * Hoje é 15/10/2026.
 *
 * @return O mundo, os perfis, as contas e a base de lançamento do perfil pessoal.
 */
function setup(): {
    world: TestWorld;
    personal: string;
    business: string;
    personalAccount: string;
    businessAccount: string;
    base: { profileId: string; subCategoryId: string };
} {
    const world = new TestWorld('2026-10-15');
    const personal = world.profile();
    const business = world.profile({ type: 'business' });
    const personalAccount = world.account(personal, { openingBalance: 1000 });
    const businessAccount = world.account(business, { openingBalance: 200 });
    return { world, personal, business, personalAccount, businessAccount, base: { profileId: personal, subCategoryId: world.subCategory(personal) } };
}

describe('Regra de negócio (Transferência entre perfis): transferência para a conta de outro perfil', () => {
    it('sai da conta de origem com os encargos e entra na conta do outro perfil só com o valor', async () => {
        const { world, personalAccount, businessAccount, base } = setup();
        await world.create(base, {
            source: { kind: 'account', accountId: personalAccount },
            type: 'transference',
            value: 500,
            charges: 8,
            dueDate: '2026-10-05',
            paymentDate: '2026-10-05',
            destinationAccountId: businessAccount,
        });

        expect(world.accountRow(personalAccount).balance).toEqualMoney('492');
        expect(world.accountRow(businessAccount).balance).toEqualMoney('700');
    });

    it('investimento continua preso ao perfil', async () => {
        const { world, personalAccount, businessAccount, base } = setup();
        const error = await world.failure('transactions.create', {
            ...base,
            source: { kind: 'account', accountId: personalAccount },
            type: 'investment',
            name: 'Aplicação',
            value: 100,
            dueDate: '2026-10-05',
            destinationAccountId: businessAccount,
        });
        expect(error.details['rule']).toBe('reference-outside-profile');
        expect(error.details['field']).toBe('destinationAccountId');
    });

    it('recusa transferência para outro perfil que sai de um cartão', async () => {
        const { world, personal, personalAccount, businessAccount, base } = setup();
        const creditCardId = world.creditCard(personal, personalAccount, 28, 10);
        const error = await world.failure('transactions.create', {
            ...base,
            source: { kind: 'creditCard', creditCardId },
            type: 'transference',
            name: 'Pagamento parcial',
            value: -100,
            dueDate: '2026-10-05',
            destinationAccountId: businessAccount,
        });
        expect(error.details['rule']).toBe('cross-profile-transfer-requires-account');
    });

    it('recusa transferência para um perfil de outra moeda', async () => {
        const { world, business, personalAccount, businessAccount, base } = setup();
        await world.ok('profiles.update', { id: business, name: 'Empresa', currency: 'USD' });
        const error = await world.failure('transactions.create', {
            ...base,
            source: { kind: 'account', accountId: personalAccount },
            type: 'transference',
            name: 'TED',
            value: 100,
            dueDate: '2026-10-05',
            destinationAccountId: businessAccount,
        });
        expect(error.details['rule']).toBe('cross-profile-transfer-currency-mismatch');
    });

    it('aparece na lista do mês dos dois perfis, com o perfil de origem como dono', async () => {
        const { world, personal, business, personalAccount, businessAccount, base } = setup();
        const created = await world.create(base, {
            source: { kind: 'account', accountId: personalAccount },
            type: 'transference',
            value: 500,
            dueDate: '2026-10-05',
            destinationAccountId: businessAccount,
        });

        const personalList = await world.ok('transactions.listByPeriod', { profileId: personal, period: '2026-10' });
        const businessList = await world.ok('transactions.listByPeriod', { profileId: business, period: '2026-10' });
        expect(personalList.map((transaction) => transaction.id)).toEqual([created.id]);
        expect(businessList.map((transaction) => transaction.id)).toEqual([created.id]);
        expect(businessList[0]?.profileId).toBe(personal);
    });

    it('Regra de negócio (Relatórios): conta como despesa na origem e receita no destino; a interna continua fora', async () => {
        const { world, personal, business, personalAccount, businessAccount, base } = setup();
        const internal = world.account(personal);
        const account = { kind: 'account', accountId: personalAccount } as const;
        await world.create(base, { source: account, type: 'transference', value: 500, charges: 8, dueDate: '2026-10-05', paymentDate: '2026-10-05', destinationAccountId: businessAccount });
        await world.create(base, { source: account, type: 'transference', value: 300, dueDate: '2026-10-06', paymentDate: '2026-10-06', destinationAccountId: internal });

        const personalSummary = await world.ok('reports.monthSummary', { profileId: personal, period: '2026-10' });
        expect(personalSummary.expenses).toEqualMoney('508');
        expect(personalSummary.expenseCount).toBe(1);
        expect(personalSummary.income).toEqualMoney('0');

        const businessSummary = await world.ok('reports.monthSummary', { profileId: business, period: '2026-10' });
        expect(businessSummary.income).toEqualMoney('500');
        expect(businessSummary.incomeCount).toBe(1);
        expect(businessSummary.expenses).toEqualMoney('0');

        // O relatório por categoria continua só com despesas (reports-design R2).
        const byCategory = await world.ok('reports.byCategory', { profileId: personal, period: '2026-10' });
        expect(byCategory.total.amount).toEqualMoney('0');
    });

    it('trava a moeda do perfil que só recebe transferências', async () => {
        const { world, business, personalAccount, businessAccount, base } = setup();
        await world.create(base, {
            source: { kind: 'account', accountId: personalAccount },
            type: 'transference',
            value: 500,
            dueDate: '2026-10-05',
            destinationAccountId: businessAccount,
        });
        const error = await world.failure('profiles.update', { id: business, name: 'Empresa', currency: 'USD' });
        expect(error.details['rule']).toBe('profile-currency-locked');
    });

    it('excluir a conta de destino apaga a transferência e devolve o saldo da origem', async () => {
        const { world, personalAccount, businessAccount, base } = setup();
        await world.create(base, {
            source: { kind: 'account', accountId: personalAccount },
            type: 'transference',
            value: 500,
            dueDate: '2026-10-05',
            paymentDate: '2026-10-05',
            destinationAccountId: businessAccount,
        });
        await world.ok('accounts.delete', { id: businessAccount });
        expect(world.accountRow(personalAccount).balance).toEqualMoney('1000');
    });
});

describe('contas de outros perfis como destino (accounts.transferTargets)', () => {
    it('lista as contas dos outros perfis com a mesma moeda, com o nome do perfil', async () => {
        const { world, personal, business, businessAccount } = setup();
        const foreign = world.profile();
        world.account(foreign);
        await world.ok('profiles.update', { id: foreign, name: 'Exterior', currency: 'USD' });
        await world.ok('profiles.update', { id: business, name: 'Empresa', currency: 'BRL' });

        const targets = await world.ok('accounts.transferTargets', { profileId: personal });
        expect(targets).toEqual([{ id: businessAccount, name: 'Conta', disabled: false, profileId: business, profileName: 'Empresa' }]);
    });
});
