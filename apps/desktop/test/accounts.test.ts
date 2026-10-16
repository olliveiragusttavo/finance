import type { AccountListResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { accountListView, openAccount, parseAccountsSearch } from '../src/renderer/src/accounts/accountsSearch.ts';

const NUBANK = '11111111-1111-4111-8111-111111111111';
const ITAU = '22222222-2222-4222-8222-222222222222';

/**
 * Lista de contas mínima para escolher a conta aberta; os saldos não entram na escolha.
 *
 * @param ids Contas da lista, na ordem do núcleo.
 * @param disabledIds Contas desativadas.
 * @return A lista no formato do `accounts.list`.
 */
function listOf(ids: readonly string[], disabledIds: readonly string[] = []): AccountListResponse {
    const zero = { amount: 0, currency: 'BRL' };
    return {
        profileId: '44444444-4444-4444-8444-444444444444',
        period: '2026-10',
        accounts: ids.map((id) => ({
            id,
            profileId: '44444444-4444-4444-8444-444444444444',
            name: id === NUBANK ? 'Nubank' : 'Itaú',
            type: 'checking',
            currency: 'BRL',
            considerBalance: true,
            openingBalance: zero,
            disabled: disabledIds.includes(id),
            balances: { consolidated: zero, projected: zero },
        })),
        total: { consolidated: zero, projected: zero },
    };
}

describe('conta aberta na tela Contas', () => {
    it('a conta vem da URL; sem ela, ou com uma que não existe mais, abre a primeira', () => {
        const list = listOf([NUBANK, ITAU]);
        expect(openAccount(list, parseAccountsSearch({ account: ITAU }))?.name).toBe('Itaú');
        expect(openAccount(list, parseAccountsSearch({}))?.name).toBe('Nubank');
        expect(openAccount(list, parseAccountsSearch({ account: '55555555-5555-4555-8555-555555555555' }))?.name).toBe('Nubank');
    });

    it('id malformado é descartado, e perfil sem conta não abre nenhuma', () => {
        expect(parseAccountsSearch({ account: 'nubank' })).toEqual({});
        expect(openAccount(listOf([]), {})).toBeNull();
    });

    it('a lista mostra as ativas ou as desativadas; a conta pedida sem visualização abre a lista dela (desktop-mvp-plan Fase 13.4)', () => {
        const list = listOf([NUBANK, ITAU], [ITAU]);
        expect(parseAccountsSearch({ view: 'disabled' })).toEqual({ view: 'disabled' });
        expect(parseAccountsSearch({ view: 'arquivadas' })).toEqual({});
        expect(accountListView(list, {}).accounts.map((account) => account.name)).toEqual(['Nubank']);
        expect(accountListView(list, { view: 'disabled' }).accounts.map((account) => account.name)).toEqual(['Itaú']);
        // O link para a conta desativada abre a lista das desativadas, com ela aberta.
        expect(accountListView(list, { account: ITAU }).view).toBe('disabled');
        expect(openAccount(list, { account: ITAU })?.name).toBe('Itaú');
        // Escolhida a visualização, a conta pedida fora dela dá lugar à primeira da lista.
        expect(openAccount(list, { account: ITAU, view: 'active' })?.name).toBe('Nubank');
        expect(openAccount(listOf([NUBANK]), { view: 'disabled' })).toBeNull();
    });
});
