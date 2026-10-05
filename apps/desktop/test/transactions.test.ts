import { NO_TRANSACTION_FILTERS } from '@finance/client';
import type { TransactionResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import {
    cashPeriodOf,
    newTransactionForm,
    parseSourceKey,
    readTransactionForm,
    sourceKey,
    TRANSACTION_FIELDS,
    transactionFormFrom,
    type TransactionFormValues,
} from '../src/renderer/src/transactions/transactionForm.ts';
import {
    categoryFilterValue,
    containerFilterValue,
    filtersFromSearch,
    parseCategoryFilterValue,
    parseContainerFilterValue,
    parseTransactionsSearch,
    searchFromFilters,
    withFilters,
} from '../src/renderer/src/transactions/transactionsSearch.ts';

const PROFILE = '77777777-7777-4777-8777-777777777777';
const NUBANK = '11111111-1111-4111-8111-111111111111';
const TESOURO = '22222222-2222-4222-8222-222222222222';
const ROXINHO = '33333333-3333-4333-8333-333333333333';
const SUB_CATEGORY = '55555555-5555-4555-8555-555555555555';
const TAG = '66666666-6666-4666-8666-666666666666';
const TRANSACTION = '88888888-8888-4888-8888-888888888888';

const CREATE = { mode: 'create', profileId: PROFILE, currency: 'BRL' } as const;

/**
 * @param overrides Campos a trocar.
 * @return Uma despesa válida no Nubank, como o usuário a preenche.
 */
function filled(overrides: Partial<TransactionFormValues> = {}): TransactionFormValues {
    return {
        ...newTransactionForm('2026-10-15', sourceKey({ kind: 'account', id: NUBANK })),
        amount: '487,32',
        name: 'Supermercado',
        subCategoryId: SUB_CATEGORY,
        ...overrides,
    };
}

/**
 * @param overrides Campos a trocar.
 * @return Uma compra no cartão como o núcleo a devolve.
 */
function purchase(overrides: Partial<TransactionResponse> = {}): TransactionResponse {
    const brl = (amount: number): TransactionResponse['value'] => ({ amount, currency: 'BRL' });
    return {
        id: TRANSACTION,
        profileId: PROFILE,
        type: 'expense',
        container: { kind: 'invoice', invoiceId: '99999999-9999-4999-8999-999999999999', creditCardId: ROXINHO, period: '2026-11' },
        subCategoryId: SUB_CATEGORY,
        destinationAccountId: null,
        partnerId: null,
        goalId: null,
        recurrenceId: null,
        name: 'Estorno Uber',
        description: null,
        value: brl(-23.9),
        charges: brl(0),
        originCurrency: 'BRL',
        conversionRate: 1,
        dueDate: '2026-10-09',
        paid: false,
        paymentDate: null,
        originEffect: brl(23.9),
        destinationEffect: null,
        tagIds: [TAG],
        ...overrides,
    };
}

describe('filtros de Transações na URL', () => {
    it('descarta cada parâmetro inválido sozinho', () => {
        expect(parseTransactionsSearch({ q: 'mercado', account: NUBANK, card: 'x', tag: TAG, situation: 'pending', period: '2026-10' })).toEqual({
            q: 'mercado',
            account: NUBANK,
            tag: TAG,
            situation: 'pending',
        });
        expect(parseTransactionsSearch({ q: '   ', situation: 'paga', subCategory: 42 })).toEqual({});
    });

    it('vai e volta entre a URL e os filtros do view-model', () => {
        const filters = { ...NO_TRANSACTION_FILTERS, container: { kind: 'creditCard', creditCardId: ROXINHO }, category: { kind: 'subCategory', subCategoryId: SUB_CATEGORY }, tagId: TAG } as const;
        expect(searchFromFilters(filters)).toEqual({ card: ROXINHO, subCategory: SUB_CATEGORY, tag: TAG });
        expect(filtersFromSearch(searchFromFilters(filters))).toEqual(filters);
        expect(searchFromFilters(NO_TRANSACTION_FILTERS)).toEqual({});
    });

    it('um link com conta e cartão, ou categoria e subcategoria, fica com o mais específico', () => {
        const filters = filtersFromSearch({ account: NUBANK, card: ROXINHO, category: TAG, subCategory: SUB_CATEGORY });
        expect(filters.container).toEqual({ kind: 'account', accountId: NUBANK });
        expect(filters.category).toEqual({ kind: 'subCategory', subCategoryId: SUB_CATEGORY });
    });

    it('trocar os filtros preserva o mês de referência e tira os que ficaram vazios', () => {
        const next = withFilters({ period: '2026-10', q: 'velho', card: ROXINHO }, { ...NO_TRANSACTION_FILTERS, situation: 'paid' });
        expect(next).toEqual({ period: '2026-10', q: undefined, account: undefined, card: undefined, category: undefined, subCategory: undefined, tag: undefined, situation: 'paid' });
    });

    it('os campos de conta ou cartão e de categoria vão e voltam, e "Todos" é vazio', () => {
        const account = { kind: 'account', accountId: NUBANK } as const;
        const category = { kind: 'category', categoryId: SUB_CATEGORY } as const;
        expect(parseContainerFilterValue(containerFilterValue(account))).toEqual(account);
        expect(parseCategoryFilterValue(categoryFilterValue(category))).toEqual(category);
        expect(containerFilterValue(null)).toBe('');
        expect(parseContainerFilterValue('')).toBeNull();
        expect(parseContainerFilterValue('account:')).toBeNull();
        expect(parseCategoryFilterValue('outro:1')).toBeNull();
    });
});

describe('formulário de lançamento (desktop-mvp-plan Fase 9)', () => {
    it('monta a despesa na conta com o valor positivo e sem pagamento', () => {
        const result = readTransactionForm(filled(), CREATE);
        expect(result).toEqual({
            ok: true,
            submission: {
                route: 'transactions.create',
                input: {
                    profileId: PROFILE,
                    type: 'expense',
                    source: { kind: 'account', accountId: NUBANK },
                    subCategoryId: SUB_CATEGORY,
                    destinationAccountId: null,
                    name: 'Supermercado',
                    description: null,
                    value: 487.32,
                    charges: 0,
                    dueDate: '2026-10-15',
                    paymentDate: null,
                    tagIds: [],
                },
            },
        });
    });

    it('o "±" grava o valor negativo (estorno) e "Pago" leva a data do pagamento', () => {
        const result = readTransactionForm(filled({ inverted: true, paid: true, paymentDate: '2026-10-20', charges: '2,50' }), CREATE);
        expect(result.ok && result.submission.input).toMatchObject({ value: -487.32, charges: 2.5, paymentDate: '2026-10-20' });
    });

    it('a compra no cartão aceita a fatura sugerida ou a escolhida, e ignora o "Pago" escondido', () => {
        const card = sourceKey({ kind: 'creditCard', id: ROXINHO });
        const suggested = readTransactionForm(filled({ source: card, paid: true }), CREATE);
        expect(suggested.ok && suggested.submission.input).toMatchObject({ source: { kind: 'creditCard', creditCardId: ROXINHO, invoicePeriod: null }, paymentDate: null });
        const chosen = readTransactionForm(filled({ source: card, invoicePeriod: '2026-12' }), CREATE);
        expect(chosen.ok && chosen.submission.input.source).toEqual({ kind: 'creditCard', creditCardId: ROXINHO, invoicePeriod: '2026-12' });
    });

    it('transferência exige a conta de destino; trocar o tipo de volta descarta o destino', () => {
        const missing = readTransactionForm(filled({ type: 'transference' }), CREATE);
        expect(missing).toEqual({ ok: false, errors: { destinationAccountId: 'Escolha a conta de destino.' } });
        const transfer = readTransactionForm(filled({ type: 'investment', destinationAccountId: TESOURO }), CREATE);
        expect(transfer.ok && transfer.submission.input.destinationAccountId).toBe(TESOURO);
        const expense = readTransactionForm(filled({ type: 'expense', destinationAccountId: TESOURO }), CREATE);
        expect(expense.ok && expense.submission.input.destinationAccountId).toBeNull();
    });

    it('aponta todos os campos com problema no mesmo envio', () => {
        const result = readTransactionForm({ ...newTransactionForm('2026-10-15', ''), dueDate: '', paid: true, paymentDate: '', charges: '-1' }, CREATE);
        expect(result).toEqual({
            ok: false,
            errors: {
                amount: 'Informe o valor.',
                name: 'Informe o nome.',
                subCategoryId: 'Escolha a categoria.',
                source: 'Escolha a conta ou o cartão.',
                dueDate: 'Informe a data.',
                paymentDate: 'Informe a data do pagamento.',
                charges: 'Use zero ou um valor positivo para os encargos.',
            },
        });
        expect(Object.keys(result.ok ? {} : result.errors).every((field) => (TRANSACTION_FIELDS as readonly string[]).includes(field))).toBe(true);
    });

    it('recusa valor zero, com sinal ou mal escrito, e nome longo demais', () => {
        const amount = (text: string): string | undefined => {
            const result = readTransactionForm(filled({ amount: text }), CREATE);
            return result.ok ? undefined : result.errors.amount;
        };
        expect(amount('0,00')).toBe('Use um valor maior que zero.');
        expect(amount('-10')).toBe('Digite o valor sem sinal; para estorno, use o botão ±.');
        expect(amount('1.5')).toBe('Digite um valor como 1.234,56.');
        const long = readTransactionForm(filled({ name: 'x'.repeat(101) }), CREATE);
        expect(long.ok ? undefined : long.errors.name).toBe('Use no máximo 100 caracteres.');
    });

    it('a edição abre o estorno em módulo com o "±" ligado e grava a edição completa', () => {
        const transaction = purchase({ partnerId: null, conversionRate: 1 });
        const values = transactionFormFrom(transaction, '2026-10-15');
        expect(values).toMatchObject({ amount: '23,90', inverted: true, source: sourceKey({ kind: 'creditCard', id: ROXINHO }), invoicePeriod: '2026-11', tagIds: [TAG], charges: '' });

        const result = readTransactionForm({ ...values, name: 'Estorno Uber (corrida)' }, { mode: 'update', transaction });
        expect(result).toEqual({
            ok: true,
            submission: {
                route: 'transactions.update',
                input: {
                    id: TRANSACTION,
                    type: 'expense',
                    source: { kind: 'creditCard', creditCardId: ROXINHO, invoicePeriod: '2026-11' },
                    subCategoryId: SUB_CATEGORY,
                    destinationAccountId: null,
                    partnerId: null,
                    goalId: null,
                    name: 'Estorno Uber (corrida)',
                    description: null,
                    value: -23.9,
                    charges: 0,
                    originCurrency: 'BRL',
                    conversionRate: 1,
                    dueDate: '2026-10-09',
                    paymentDate: null,
                    tagIds: [TAG],
                },
            },
        });
    });

    it('a chave da origem vai e volta, e lixo não vira origem', () => {
        expect(parseSourceKey(sourceKey({ kind: 'account', id: NUBANK }))).toEqual({ kind: 'account', accountId: NUBANK });
        expect(parseSourceKey(sourceKey({ kind: 'creditCard', id: ROXINHO }))).toEqual({ kind: 'creditCard', creditCardId: ROXINHO });
        expect(parseSourceKey('')).toBeNull();
        expect(parseSourceKey('account:')).toBeNull();
    });

    it('o mês em que o lançamento pesa: pagamento, vencimento ou fatura', () => {
        expect(cashPeriodOf(filled({ dueDate: '2026-09-30' }), null)).toBe('2026-09');
        expect(cashPeriodOf(filled({ dueDate: '2026-09-30', paid: true, paymentDate: '2026-10-02' }), null)).toBe('2026-10');
        expect(cashPeriodOf(filled({ dueDate: '' }), null)).toBeNull();
        const card = sourceKey({ kind: 'creditCard', id: ROXINHO });
        expect(cashPeriodOf(filled({ source: card }), '2026-11')).toBe('2026-11');
        expect(cashPeriodOf(filled({ source: card, invoicePeriod: '2026-12' }), '2026-11')).toBe('2026-12');
    });
});
