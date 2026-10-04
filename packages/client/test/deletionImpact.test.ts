import type { AccountDeletionImpactResponse, CreditCardDeletionImpactResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { describeAccountDeletion, describeCreditCardDeletion } from '../src/index.ts';
import { ClientWorld } from './support/ClientWorld.ts';

/** Alerta de conta sem nada além do cadastro, para cada teste mudar só o que examina. */
const NOTHING_FROM_ACCOUNT: AccountDeletionImpactResponse = {
    accountId: 'a',
    statements: 0,
    transactions: 0,
    creditCards: 0,
    invoices: 0,
    cardTransactions: 0,
    incomingTransfers: 0,
    affectedAccounts: [],
};

/** Alerta de cartão sem faturas, pelo mesmo motivo. */
const NOTHING_FROM_CARD: CreditCardDeletionImpactResponse = { creditCardId: 'c', invoices: 0, transactions: 0, partialPayments: 0, affectedAccounts: [] };

describe('alerta de exclusão em cadeia (desktop-mvp-plan §5.1)', () => {
    it('conta: cada item com a contagem no número certo, e as outras contas pelo nome', () => {
        const warning = describeAccountDeletion({
            ...NOTHING_FROM_ACCOUNT,
            statements: 3,
            transactions: 1,
            creditCards: 2,
            invoices: 4,
            cardTransactions: 12,
            incomingTransfers: 2,
            affectedAccounts: [{ id: 'b', name: 'Tesouro' }],
        });
        expect(warning).toEqual({
            items: [
                '3 extratos mensais',
                '1 lançamento da conta',
                '2 cartões pagos por ela',
                '4 faturas desses cartões',
                '12 lançamentos nas faturas',
                '2 transferências e investimentos recebidos de outras contas',
            ],
            affectedAccounts: ['Tesouro'],
        });
    });

    it('conta: singular em todos os itens, com "desse cartão" quando há um só cartão', () => {
        const warning = describeAccountDeletion({ ...NOTHING_FROM_ACCOUNT, statements: 1, creditCards: 1, invoices: 1, cardTransactions: 1, incomingTransfers: 1 });
        expect(warning.items).toEqual([
            '1 extrato mensal',
            '1 cartão pago por ela',
            '1 fatura desse cartão',
            '1 lançamento nas faturas',
            '1 transferência ou investimento recebido de outra conta',
        ]);
    });

    it('contagem zero não vira frase', () => {
        expect(describeAccountDeletion(NOTHING_FROM_ACCOUNT)).toEqual({ items: [], affectedAccounts: [] });
        expect(describeCreditCardDeletion(NOTHING_FROM_CARD)).toEqual({ items: [], affectedAccounts: [] });
    });

    it('cartão: os pagamentos parciais aparecem dentro dos lançamentos, porque são eles que devolvem dinheiro à conta', () => {
        const warning = describeCreditCardDeletion({ ...NOTHING_FROM_CARD, invoices: 2, transactions: 5, partialPayments: 1, affectedAccounts: [{ id: 'a', name: 'Nubank' }] });
        expect(warning).toEqual({ items: ['2 faturas', '5 lançamentos nas faturas, incluindo 1 pagamento parcial'], affectedAccounts: ['Nubank'] });
        expect(describeCreditCardDeletion({ ...NOTHING_FROM_CARD, invoices: 1, transactions: 1 }).items).toEqual(['1 fatura', '1 lançamento nas faturas']);
    });

    it('contra o núcleo: excluir a conta que paga o cartão e transfere para outra nomeia a outra conta', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const warning = describeAccountDeletion(await world.ok('accounts.deletionImpact', { id: s.checkingId }));
        expect(warning.affectedAccounts).toEqual(['Tesouro']);
        expect(warning.items).toContain('1 cartão pago por ela');
        expect(warning.items.some((item) => item.endsWith('lançamentos nas faturas'))).toBe(true);
    });
});
