import type { AccountResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_FIELDS, accountFormFrom, emptyAccountForm, readAccountForm, type AccountFormResult } from '../src/renderer/src/accounts/accountForm.ts';

/** Id de conta válido no formato do núcleo. */
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

/**
 * @param result Resultado da leitura.
 * @return Os erros por campo; vazio quando o formulário é válido, para o teste comparar direto.
 */
function errorsOf(result: AccountFormResult): Readonly<Record<string, string>> {
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

describe('formulário de conta (desktop-mvp-plan Fase 6)', () => {
    it('monta o conteúdo de accounts.create/update, com a moeda como rótulo e o nome aparado', () => {
        const result = readAccountForm({ ...emptyAccountForm('BRL'), name: '  Tesouro ', type: 'investment', currency: 'USD', considerBalance: false, openingBalance: '1.234,56' }, 'BRL');
        expect(result).toEqual({ ok: true, content: { name: 'Tesouro', type: 'investment', currencyLabel: 'USD', considerBalance: false, openingBalance: 1234.56 } });
    });

    it('saldo inicial em branco é zero, o padrão do cadastro (database-design §4.4)', () => {
        const result = readAccountForm({ ...emptyAccountForm('BRL'), name: 'Nubank' }, 'BRL');
        expect(result.ok && result.content.openingBalance).toBe(0);
    });

    it('a conta nova nasce na moeda do perfil, somando no total', () => {
        expect(emptyAccountForm('USD')).toMatchObject({ currency: 'USD', considerBalance: true, type: 'checking' });
    });

    it('editar sem mexer em nada devolve o mesmo cadastro, saldo inicial incluído', () => {
        const result = readAccountForm(accountFormFrom(account({ considerBalance: false })), 'BRL');
        expect(result).toEqual({ ok: true, content: { name: 'Nubank', type: 'checking', currencyLabel: 'BRL', considerBalance: false, openingBalance: 1234.5 } });
    });

    it('saldo inválido não esconde o erro do nome', () => {
        expect(errorsOf(readAccountForm({ ...emptyAccountForm('BRL'), name: ' ', openingBalance: '12.5' }, 'BRL'))).toEqual({
            name: 'Informe o nome da conta.',
            openingBalance: 'Digite um valor como 1.234,56.',
        });
    });

    it('o limite do nome é o do núcleo e o teto do saldo vem na mensagem', () => {
        expect(errorsOf(readAccountForm({ ...emptyAccountForm('BRL'), name: 'a'.repeat(46) }, 'BRL'))).toEqual({ name: 'Use no máximo 45 caracteres.' });
        expect(errorsOf(readAccountForm({ ...emptyAccountForm('BRL'), name: 'Nubank', openingBalance: '1.000.000.000.000,01' }, 'BRL'))).toEqual({
            openingBalance: 'Use um valor de até 1.000.000.000.000,00, positivo ou negativo.',
        });
    });

    it('a lista de campos cobre todo o formulário', () => {
        expect([...ACCOUNT_FIELDS].sort()).toEqual(Object.keys(emptyAccountForm('BRL')).sort());
    });
});
