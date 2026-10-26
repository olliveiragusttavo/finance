import type { AccountResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import {
    closingDayWarning,
    CREDIT_CARD_FIELDS,
    creditCardFormFrom,
    emptyCreditCardForm,
    payingAccountOptions,
    readCreditCardForm,
    type CreditCardFormResult,
    type CreditCardFormValues,
} from '../src/renderer/src/cards/creditCardForm.ts';

/** Id de conta válido no formato do núcleo. */
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

/**
 * @param result Resultado da leitura.
 * @return Os erros por campo; vazio quando o formulário é válido, para o teste comparar direto.
 */
function errorsOf(result: CreditCardFormResult): Readonly<Record<string, string>> {
    return result.ok ? {} : result.errors;
}

/**
 * @param changes Campos que o teste muda.
 * @return Uma conta como `accounts.list` a devolve.
 */
function account(changes: Partial<AccountResponse> = {}): AccountResponse {
    return {
        id: ACCOUNT_ID,
        profileId: 'p',
        name: 'Nubank',
        type: 'checking',
        currency: 'BRL',
        considerBalance: true,
        disabled: false,
        openingBalance: { amount: 1234.5, currency: 'BRL' },
        ...changes,
    };
}

/**
 * @param changes Campos que o teste preenche.
 * @return Um cartão válido no formulário, mais as mudanças.
 */
function card(changes: Partial<CreditCardFormValues> = {}): CreditCardFormValues {
    return { ...emptyCreditCardForm(ACCOUNT_ID), name: 'Roxinho', limit: '5.000,00', closingDay: '3', dueDay: '10', ...changes };
}

describe('formulário de cartão (desktop-mvp-plan Fase 6)', () => {
    it('monta o conteúdo de creditCards.create/update', () => {
        expect(readCreditCardForm(card(), 'BRL')).toEqual({ ok: true, content: { accountId: ACCOUNT_ID, name: 'Roxinho', limit: 5000, closingDay: 3, dueDay: 10 } });
    });

    it('editar sem mexer em nada devolve o mesmo cadastro', () => {
        const form = creditCardFormFrom({ id: 'c', profileId: 'p', accountId: ACCOUNT_ID, name: 'Roxinho', limit: { amount: 5000, currency: 'BRL' }, closingDay: 31, dueDay: 8, disabled: false });
        expect(readCreditCardForm(form, 'BRL')).toEqual({ ok: true, content: { accountId: ACCOUNT_ID, name: 'Roxinho', limit: 5000, closingDay: 31, dueDay: 8 } });
    });

    it('sem conta, limite e dias, aponta cada campo de uma vez', () => {
        expect(errorsOf(readCreditCardForm({ name: '', accountId: '', limit: '', closingDay: '', dueDay: '' }, 'BRL'))).toEqual({
            name: 'Informe o nome do cartão.',
            accountId: 'Escolha a conta que paga as faturas.',
            limit: 'Informe o limite do cartão.',
            closingDay: 'Informe o dia de fechamento.',
            dueDay: 'Informe o dia de vencimento.',
        });
    });

    it('Regra de negócio (Cartão): limite negativo é recusado; zero é aceito', () => {
        expect(errorsOf(readCreditCardForm(card({ limit: '-1,00' }), 'BRL'))).toEqual({ limit: 'Use zero ou um valor positivo para o limite.' });
        expect(readCreditCardForm(card({ limit: '0' }), 'BRL').ok).toBe(true);
    });

    it('o teto do limite não sugere valor negativo, que o campo recusaria', () => {
        expect(errorsOf(readCreditCardForm(card({ limit: '1.000.000.000.000,01' }), 'BRL'))).toEqual({ limit: 'Use um valor de até 1.000.000.000.000,00.' });
    });

    it('Regra de negócio (Cartão): dias fora de 1–31 ou que não são número inteiro são recusados', () => {
        expect(errorsOf(readCreditCardForm(card({ closingDay: '0', dueDay: '32' }), 'BRL'))).toEqual({ closingDay: 'Use um dia de 1 a 31.', dueDay: 'Use um dia de 1 a 31.' });
        expect(errorsOf(readCreditCardForm(card({ closingDay: '1.5', dueDay: '10a' }), 'BRL'))).toEqual({ closingDay: 'Use um dia de 1 a 31.', dueDay: 'Use um dia de 1 a 31.' });
        expect(readCreditCardForm(card({ closingDay: ' 31 ', dueDay: '1' }), 'BRL').ok).toBe(true);
    });

    it('Regra de negócio (Cartão, database-design §4.5): fechamento em 29–31 avisa que vira o último dia nos meses curtos', () => {
        expect(closingDayWarning('28')).toBeNull();
        expect(closingDayWarning('29')).toBe('Nos meses sem o dia 29, a fatura fecha no último dia do mês.');
        expect(closingDayWarning('31')).toBe('Nos meses sem o dia 31, a fatura fecha no último dia do mês.');
        expect(closingDayWarning('32')).toBeNull();
        expect(closingDayWarning('')).toBeNull();
        expect(closingDayWarning('abc')).toBeNull();
    });

    it('Regra de negócio (Contas, §5.1): conta desativada não paga cartão novo, mas continua na edição do cartão que já paga', () => {
        const active = account({ id: 'a', name: 'Ativa' });
        const disabled = account({ id: 'd', name: 'Desativada', disabled: true });
        expect(payingAccountOptions([active, disabled], null).map((option) => option.name)).toEqual(['Ativa']);
        expect(payingAccountOptions([active, disabled], 'd').map((option) => option.name)).toEqual(['Ativa', 'Desativada']);
    });

    it('a lista de campos cobre todo o formulário', () => {
        expect([...CREDIT_CARD_FIELDS].sort()).toEqual(Object.keys(emptyCreditCardForm('')).sort());
    });
});
