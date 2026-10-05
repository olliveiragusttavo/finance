import type { AccountResponse, CreditCardListResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { openCreditCard, openInvoicePeriod, parseCardsSearch, shouldDropInvoice } from '../src/renderer/src/cards/cardsSearch.ts';
import {
    defaultPartialPaymentAccount,
    PARTIAL_PAYMENT_FIELDS,
    PARTIAL_PAYMENT_NAME,
    partialPaymentAccountOptions,
    periodOfDate,
    readPartialPaymentForm,
    readPayInvoiceForm,
    type PartialPaymentFormValues,
    type PartialPaymentTarget,
} from '../src/renderer/src/cards/invoiceForms.ts';
import { currentDate } from '../src/renderer/src/shell/referenceMonth.ts';

const ROXINHO = '33333333-3333-4333-8333-333333333333';
const CLICK = '44444444-4444-4444-8444-444444444444';
const NUBANK = '11111111-1111-4111-8111-111111111111';
const ITAU = '22222222-2222-4222-8222-222222222222';
const SUB_CATEGORY = '55555555-5555-4555-8555-555555555555';
const INVOICE = '66666666-6666-4666-8666-666666666666';
const PROFILE = '77777777-7777-4777-8777-777777777777';

/**
 * Lista de cartões mínima para escolher o cartão aberto; faturas e totais não entram na escolha.
 *
 * @param ids Cartões da lista, na ordem do núcleo.
 * @return A lista no formato do `creditCards.list`.
 */
function listOf(ids: readonly string[]): CreditCardListResponse {
    const zero = { amount: 0, currency: 'BRL' };
    return {
        profileId: PROFILE,
        period: '2026-10',
        creditCards: ids.map((id) => ({
            id,
            profileId: PROFILE,
            accountId: NUBANK,
            name: id === ROXINHO ? 'Roxinho' : 'Click',
            limit: zero,
            closingDay: 3,
            dueDay: 10,
            disabled: false,
            invoiceOfMonth: { period: '2026-10', closingDate: '2026-10-03', dueDate: '2026-10-10', invoice: null },
            limitUsed: zero,
        })),
        openTotal: zero,
        total: zero,
    };
}

/**
 * @param id Id da conta.
 * @param disabled Se a conta está desativada.
 * @return Uma conta como `accounts.list` a devolve.
 */
function account(id: string, disabled = false): AccountResponse {
    const zero = { amount: 0, currency: 'BRL' };
    return { id, profileId: PROFILE, name: id === NUBANK ? 'Nubank' : 'Itaú', type: 'checking', currency: 'BRL', considerBalance: true, openingBalance: zero, disabled };
}

/** Fatura de outubro com R$ 1.000,00 a pagar. */
const TARGET: PartialPaymentTarget = { profileId: PROFILE, creditCardId: ROXINHO, invoicePeriod: '2026-10', amountDue: { amount: 1000, currency: 'BRL' } };

/**
 * @param changes Campos que o teste muda.
 * @return Um pagamento parcial válido de R$ 300,00 em 08/10, com as mudanças.
 */
function partial(changes: Partial<PartialPaymentFormValues> = {}): PartialPaymentFormValues {
    return { amount: '300,00', paymentDate: '2026-10-08', accountId: NUBANK, subCategoryId: SUB_CATEGORY, ...changes };
}

describe('cartão e fatura abertos na tela Cartões', () => {
    it('cada parâmetro inválido da URL é descartado sozinho', () => {
        expect(parseCardsSearch({ card: ROXINHO, invoice: '2026-09' })).toEqual({ card: ROXINHO, invoice: '2026-09' });
        expect(parseCardsSearch({ card: ROXINHO, invoice: '2026-13' })).toEqual({ card: ROXINHO });
        expect(parseCardsSearch({ card: 'roxinho', invoice: '2026-09' })).toEqual({ invoice: '2026-09' });
        expect(parseCardsSearch({})).toEqual({});
    });

    it('o cartão vem da URL; sem ele, ou com um que não existe mais, abre o primeiro', () => {
        const list = listOf([ROXINHO, CLICK]);
        expect(openCreditCard(list, { card: CLICK })?.name).toBe('Click');
        expect(openCreditCard(list, {})?.name).toBe('Roxinho');
        expect(openCreditCard(list, { card: SUB_CATEGORY })?.name).toBe('Roxinho');
        expect(openCreditCard(listOf([]), {})).toBeNull();
    });

    it('sem fatura na URL vale a do mês de referência; com ela ("ver fatura"), a pedida', () => {
        expect(openInvoicePeriod({}, '2026-10')).toBe('2026-10');
        expect(openInvoicePeriod({ invoice: '2026-09' }, '2026-10')).toBe('2026-09');
    });

    it('trocar só o mês tira a fatura da URL; voltar no histórico ou seguir um link não', () => {
        const fromStatement = { period: '2026-10', invoice: '2026-09' };
        // `‹ ›` na barra: o mês muda e a fatura fica — o detalhe volta para a do mês.
        expect(shouldDropInvoice(fromStatement, { period: '2026-11', invoice: '2026-09' })).toBe(true);
        // Mesmo mês (outro render, outro cartão): nada a fazer.
        expect(shouldDropInvoice(fromStatement, fromStatement)).toBe(false);
        // Os dois mudam juntos: histórico ou link, a URL é a escolha explícita.
        expect(shouldDropInvoice({ period: '2026-11', invoice: undefined }, fromStatement)).toBe(false);
        // Sem fatura na URL não há o que tirar.
        expect(shouldDropInvoice({ period: '2026-10', invoice: undefined }, { period: '2026-11', invoice: undefined })).toBe(false);
    });
});

describe('pagar a fatura', () => {
    it('a data é obrigatória e precisa existir no calendário', () => {
        expect(readPayInvoiceForm({ paymentDate: '2026-10-07' }, INVOICE)).toEqual({ ok: true, input: { invoiceId: INVOICE, paymentDate: '2026-10-07' } });
        expect(readPayInvoiceForm({ paymentDate: '' }, INVOICE)).toEqual({ ok: false, errors: { paymentDate: 'Informe a data do pagamento.' } });
        expect(readPayInvoiceForm({ paymentDate: '2026-02-30' }, INVOICE)).toEqual({ ok: false, errors: { paymentDate: 'Confira a data do pagamento.' } });
    });

    it('a prévia do saldo só consulta o extrato com uma data completa', () => {
        expect(periodOfDate('2026-10-07')).toBe('2026-10');
        expect(periodOfDate('')).toBeNull();
        expect(periodOfDate('2026-10')).toBeNull();
    });

    it('a data sugerida é a de hoje no calendário local', () => {
        expect(currentDate(new Date(2026, 9, 31, 23, 59))).toBe('2026-10-31');
        expect(currentDate(new Date(2027, 0, 1, 0, 0))).toBe('2027-01-01');
    });
});

describe('pagamento parcial', () => {
    it('vira uma transferência negativa, já paga, na fatura, com a conta que pagou como destino (database-design §4.7)', () => {
        expect(readPartialPaymentForm(partial(), TARGET)).toEqual({
            ok: true,
            input: {
                profileId: PROFILE,
                type: 'transference',
                source: { kind: 'creditCard', creditCardId: ROXINHO, invoicePeriod: '2026-10' },
                destinationAccountId: NUBANK,
                subCategoryId: SUB_CATEGORY,
                name: PARTIAL_PAYMENT_NAME,
                value: -300,
                dueDate: '2026-10-08',
                paymentDate: '2026-10-08',
            },
        });
    });

    it('o valor é positivo e menor que o valor a pagar; quitar tudo é "Pagar fatura"', () => {
        /**
         * @param amount Valor digitado.
         * @return A mensagem do campo de valor, ou `undefined` quando ele passa.
         */
        const amountError = (amount: string): string | undefined => {
            const result = readPartialPaymentForm(partial({ amount }), TARGET);
            return result.ok ? undefined : result.errors.amount;
        };
        expect(amountError('')).toBe('Informe o valor pago.');
        expect(amountError('abc')).toBe('Digite um valor como 1.234,56.');
        expect(amountError('0')).toBe('Use um valor maior que zero.');
        expect(amountError('-10')).toBe('Use um valor maior que zero.');
        expect(amountError('1.000,00')).toBe('A fatura tem R$ 1.000,00 a pagar; para quitar tudo, use "Pagar fatura".');
        expect(amountError('999,99')).toBeUndefined();
    });

    it('todos os campos vazios aparecem no mesmo envio', () => {
        const result = readPartialPaymentForm({ amount: '', paymentDate: '', accountId: '', subCategoryId: '' }, TARGET);
        expect(result).toEqual({
            ok: false,
            errors: {
                amount: 'Informe o valor pago.',
                paymentDate: 'Informe a data do pagamento.',
                accountId: 'Escolha a conta que pagou.',
                subCategoryId: 'Escolha a subcategoria do lançamento.',
            },
        });
        expect(Object.keys(result.ok ? {} : result.errors).sort()).toEqual([...PARTIAL_PAYMENT_FIELDS].sort());
    });

    it('a data inválida é recusada pelo schema de transactions.create', () => {
        const result = readPartialPaymentForm(partial({ paymentDate: '2026-02-30' }), TARGET);
        expect(result.ok ? {} : result.errors).toEqual({ paymentDate: 'Confira a data do pagamento.' });
    });

    it('só contas ativas pagam; a sugerida é a pagadora do cartão, ou a primeira ativa', () => {
        const options = partialPaymentAccountOptions([account(NUBANK, true), account(ITAU)]);
        expect(options.map((option) => option.id)).toEqual([ITAU]);
        expect(defaultPartialPaymentAccount(options, NUBANK)).toBe(ITAU);
        expect(defaultPartialPaymentAccount([account(NUBANK), account(ITAU)], ITAU)).toBe(ITAU);
        expect(defaultPartialPaymentAccount([], NUBANK)).toBe('');
    });
});
