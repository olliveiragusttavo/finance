import type { CreditCardListResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { creditCardListView, openCreditCard, openInvoicePeriod, parseCardsSearch, shouldDropInvoice } from '../src/renderer/src/cards/cardsSearch.ts';

const ROXINHO = '33333333-3333-4333-8333-333333333333';
const CLICK = '44444444-4444-4444-8444-444444444444';
const NUBANK = '11111111-1111-4111-8111-111111111111';
const SUB_CATEGORY = '55555555-5555-4555-8555-555555555555';
const PROFILE = '77777777-7777-4777-8777-777777777777';

/**
 * Lista de cartões mínima para escolher o cartão aberto; faturas e totais não entram na escolha.
 *
 * @param ids Cartões da lista, na ordem do núcleo.
 * @param disabledIds Cartões desativados.
 * @return A lista no formato do `creditCards.list`.
 */
function listOf(ids: readonly string[], disabledIds: readonly string[] = []): CreditCardListResponse {
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
            disabled: disabledIds.includes(id),
            invoiceOfMonth: { period: '2026-10', closingDate: '2026-10-03', dueDate: '2026-10-10', invoice: null },
            limitUsed: zero,
        })),
        openTotal: zero,
        total: zero,
    };
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

    it('a lista mostra os ativos ou os desativados; o cartão pedido sem visualização abre a lista dele (desktop-mvp-plan Fase 13.4)', () => {
        const list = listOf([ROXINHO, CLICK], [CLICK]);
        expect(parseCardsSearch({ view: 'disabled', card: CLICK })).toEqual({ view: 'disabled', card: CLICK });
        expect(creditCardListView(list, {}).creditCards.map((creditCard) => creditCard.name)).toEqual(['Roxinho']);
        expect(creditCardListView(list, { card: CLICK })).toMatchObject({ view: 'disabled', creditCards: [{ name: 'Click' }] });
        expect(openCreditCard(list, { card: CLICK, view: 'active' })?.name).toBe('Roxinho');
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
