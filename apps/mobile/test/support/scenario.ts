import type { Core, CoreInput, CoreOutput, CoreRoute } from '@finance/core';

/** "Hoje" do cenário: meados de outubro, com atrasados e coisas a vencer no mês. */
export const SCENARIO_TODAY = '2026-10-15';

/** Mês de referência do cenário. */
export const SCENARIO_PERIOD = '2026-10';

/** Ids do cenário, para os testes montarem as entradas das rotas e conferirem o que mudou. */
export interface Scenario {
    readonly profileId: string;
    readonly checkingId: string;
    readonly savingsId: string;
    readonly creditCardId: string;
    readonly categoryId: string;
    readonly subCategoryId: string;
    readonly otherSubCategoryId: string;
    readonly incomeId: string;
    readonly expenseId: string;
    readonly purchaseId: string;
    readonly transferId: string;
    readonly tagId: string;
    readonly noteId: string;
    readonly goalId: string;
}

/**
 * Chama uma rota e devolve o dado, para o cenário não repetir a checagem de `ok`.
 *
 * @param core Núcleo do teste.
 * @param route Rota.
 * @param input Entrada.
 * @return O dado da rota.
 * @throws {Error} Quando a rota recusa: erro de montagem do cenário, que o teste deve mostrar.
 */
export async function ok<R extends CoreRoute>(core: Core, route: R, input: CoreInput<R>): Promise<CoreOutput<R>> {
    const result = await core.call(route, input);
    if (!result.ok) {
        throw new Error(`${route}: ${result.error.message}`);
    }
    return result.data;
}

/**
 * O cenário dos testes de tela, o mesmo do `ClientWorld` do `client`: perfil com conta corrente
 * (saldo inicial de R$ 1.000) e investimento, cartão Roxinho pago pela corrente (fecha dia 3,
 * vence dia 10), salário pago e vinculado a uma meta, aluguel pendente vencido em 05/10, compra no
 * cartão em aberto (com tag), fatura de setembro paga em 02/10, aporte pendente para o
 * investimento e uma anotação. Telas do celular e do desktop testadas sobre o mesmo cenário
 * mostram os mesmos números.
 *
 * @param core Núcleo do teste, de preferência com "hoje" em `SCENARIO_TODAY`.
 * @return Os ids do cenário.
 */
export async function seedScenario(core: Core): Promise<Scenario> {
    const { profile, account } = await ok(core, 'onboarding.start', {
        profile: { name: 'Pessoal', type: 'personal', currency: 'BRL' },
        account: { name: 'Nubank', type: 'checking', openingBalance: 1000 },
        suggestedCategories: false,
    });
    const savings = await ok(core, 'accounts.create', { profileId: profile.id, name: 'Tesouro', type: 'investment' });
    const category = await ok(core, 'categories.create', { profileId: profile.id, name: 'Alimentação' });
    const sub = await ok(core, 'subCategories.create', { categoryId: category.id, name: 'Mercado' });
    const other = await ok(core, 'subCategories.create', { categoryId: category.id, name: 'Restaurantes' });
    const tag = await ok(core, 'tags.create', { profileId: profile.id, name: 'viagem' });
    const note = await ok(core, 'notes.create', { profileId: profile.id, text: 'IPTU 2027' });
    const goal = await ok(core, 'goals.create', { profileId: profile.id, name: 'Reserva', value: 30000, targetDate: '2027-12-31' });
    const card = await ok(core, 'creditCards.create', { profileId: profile.id, accountId: account.id, name: 'Roxinho', limit: 5000, closingDay: 3, dueDay: 10 });
    const base = { profileId: profile.id, subCategoryId: sub.id } as const;
    const income = await ok(core, 'transactions.create', { ...base, type: 'income', source: { kind: 'account', accountId: account.id }, name: 'Salário', value: 9500, dueDate: '2026-10-01', paymentDate: '2026-10-01', goalId: goal.id });
    const expense = await ok(core, 'transactions.create', { ...base, type: 'expense', source: { kind: 'account', accountId: account.id }, name: 'Aluguel', value: 2300, dueDate: '2026-10-05' });
    const september = await ok(core, 'transactions.create', { ...base, type: 'expense', source: { kind: 'creditCard', creditCardId: card.id }, name: 'Feira', value: 120, dueDate: '2026-08-20' });
    const purchase = await ok(core, 'transactions.create', { ...base, type: 'expense', source: { kind: 'creditCard', creditCardId: card.id }, name: 'Supermercado', value: 487.32, dueDate: '2026-10-06', tagIds: [tag.id] });
    const transfer = await ok(core, 'transactions.create', { ...base, type: 'transference', source: { kind: 'account', accountId: account.id }, destinationAccountId: savings.id, name: 'Aporte', value: 500, dueDate: '2026-10-10' });
    if (september.container.kind !== 'invoice') {
        throw new Error('a compra de setembro não caiu numa fatura');
    }
    await ok(core, 'invoices.pay', { invoiceId: september.container.invoiceId, paymentDate: '2026-10-02' });
    return {
        profileId: profile.id,
        checkingId: account.id,
        savingsId: savings.id,
        creditCardId: card.id,
        categoryId: category.id,
        subCategoryId: sub.id,
        otherSubCategoryId: other.id,
        incomeId: income.id,
        expenseId: expense.id,
        purchaseId: purchase.id,
        transferId: transfer.id,
        tagId: tag.id,
        noteId: note.id,
        goalId: goal.id,
    };
}
