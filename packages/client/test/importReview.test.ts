import { analyzeImport, LocalDate, type AccountResponse, type CategoryBranchResponse, type CreditCardResponse, type ProfileResponse } from '@finance/core';
import { importRowSchema } from '@finance/core/requests';
import { describe, expect, it } from 'vitest';
import {
    cardProfileId,
    carryOverReview,
    DEFAULT_IMPORT_OPTIONS,
    importRunInput,
    initialReview,
    profileCategories,
    profileShares,
    reviewPending,
    withAccountProfile,
    type ExistingRegistries,
    type ImportRowInput,
} from '../src/index.ts';

const PERSONAL: ProfileResponse = { id: 'p1', name: 'Gustavo', type: 'personal', currency: 'BRL' };
const BUSINESS: ProfileResponse = { id: 'p2', name: 'Estúdio', type: 'business', currency: 'BRL' };

/**
 * @param id Id da conta.
 * @param profileId Perfil dono.
 * @param name Nome.
 * @return Uma conta ativa existente.
 */
function account(id: string, profileId: string, name: string): AccountResponse {
    return { id, profileId, name, type: 'checking', currency: 'BRL', considerBalance: true, disabled: false, openingBalance: { amount: 0, currency: 'BRL' } };
}

/**
 * @param id Id do cartão.
 * @param profileId Perfil dono.
 * @param name Nome.
 * @return Um cartão ativo existente.
 */
function card(id: string, profileId: string, name: string): CreditCardResponse {
    return { id, profileId, accountId: 'a1', name, limit: { amount: 0, currency: 'BRL' }, closingDay: 8, dueDay: 15, disabled: false };
}

const ROWS: readonly ImportRowInput[] = [
    { line: 1, type: 'expense', name: 'Mercado', value: 10, dueDate: '2026-03-10', account: 'Banco Inter', category: 'Moradia', subCategory: 'Mercado' },
    { line: 2, type: 'expense', name: 'Livro', value: 20, dueDate: '2026-03-15', account: 'Banco Inter', creditCard: 'Inter', purchaseDate: '2026-03-01', category: 'Compras', subCategory: 'Livros' },
    { line: 3, type: 'expense', name: 'Simples', value: 30, dueDate: '2026-03-15', account: 'Empresa', category: 'Impostos', subCategory: 'DAS' },
    { line: 4, type: 'transference', name: 'Lucros', value: 40, dueDate: '2026-03-20', account: 'Empresa', destination: 'Banco Inter' },
];

const ANALYSIS = analyzeImport(ROWS.map((row) => importRowSchema.parse(row)), DEFAULT_IMPORT_OPTIONS, LocalDate.parse('2026-10-15'));

const EXISTING: ExistingRegistries = {
    accounts: [account('a1', 'p1', 'banco inter'), account('a2', 'p2', 'Empresa')],
    creditCards: [card('c1', 'p2', 'Inter')],
};

describe('revisão da importação (import-design §5)', () => {
    it('começa no perfil padrão, ligando a conta de mesmo nome e pedindo o fechamento do cartão novo', () => {
        const state = initialReview(ANALYSIS, 'p1', EXISTING);
        expect(state.accounts.map((item) => [item.name, item.profileId, item.linkTo])).toEqual([
            ['Banco Inter', 'p1', 'a1'],
            ['Empresa', 'p1', null],
        ]);
        // O "Inter" existente é de outro perfil: não liga.
        expect(state.cards).toEqual([{ name: 'Inter', rows: 1, payingAccount: 'Banco Inter', linkTo: null, dueDay: 15, closingDay: null, closingSuggestion: null, limit: 0 }]);
        expect(reviewPending(state)).toEqual(['fechamento de 1 cartão']);
        expect(reviewPending({ ...state, cards: state.cards.map((item) => ({ ...item, closingDay: 8 })) })).toEqual([]);
    });

    it('troca o perfil da conta, liga a de mesmo nome lá e leva o cartão junto com a pagadora', () => {
        const state = withAccountProfile(initialReview(ANALYSIS, 'p1', EXISTING), 'Empresa', 'p2', EXISTING);
        expect(state.accounts.find((item) => item.name === 'Empresa')).toMatchObject({ profileId: 'p2', linkTo: 'a2' });
        const all = withAccountProfile(state, null, 'p2', EXISTING);
        expect(all.accounts.map((item) => [item.profileId, item.linkTo])).toEqual([['p2', null], ['p2', 'a2']]);
        const [only] = all.cards;
        expect(only === undefined ? null : cardProfileId(all, only, EXISTING)).toBe('p2');
    });

    it('mantém o cartão ligado no perfil dele quando a conta do arquivo muda de perfil', () => {
        const linked = withAccountProfile(initialReview(ANALYSIS, 'p2', EXISTING), null, 'p2', EXISTING);
        const withCard = { ...linked, cards: linked.cards.map((item) => ({ ...item, linkTo: 'c1' })) };
        const moved = withAccountProfile(withCard, 'Banco Inter', 'p1', EXISTING);
        const [only] = moved.cards;
        expect(only?.linkTo).toBe('c1');
        expect(only === undefined ? null : cardProfileId(moved, only, EXISTING)).toBe('p2');
    });

    it('divide as linhas e as categorias por perfil, com as transferências na categoria padrão', () => {
        const state = withAccountProfile(initialReview(ANALYSIS, 'p1', EXISTING), 'Empresa', 'p2', EXISTING);
        expect(profileShares(ANALYSIS, state, [PERSONAL, BUSINESS], EXISTING).map((share) => [share.profile.id, share.rows, share.accounts])).toEqual([
            ['p1', 2, ['Banco Inter']],
            ['p2', 2, ['Empresa']],
        ]);
        const trees = new Map<string, readonly CategoryBranchResponse[]>([
            ['p1', [{ id: 'k1', profileId: 'p1', name: 'moradia', subCategories: [{ id: 's1', categoryId: 'k1', name: 'Mercado', transactionCount: 0 }] }]],
        ]);
        expect(profileCategories(ANALYSIS, state, [PERSONAL, BUSINESS], EXISTING, trees)).toEqual([
            { profile: PERSONAL, existing: ['Moradia › Mercado'], created: ['Compras › Livros'] },
            { profile: BUSINESS, existing: [], created: ['Impostos › DAS', 'Transferências › Entre contas'] },
        ]);
    });

    it('mantém as decisões ao refazer a revisão, e só para o que continua no arquivo', () => {
        const decided = withAccountProfile(initialReview(ANALYSIS, 'p1', EXISTING), 'Empresa', 'p2', EXISTING);
        const closed = { ...decided, cards: decided.cards.map((item) => ({ ...item, closingDay: 9 })) };
        const smaller = analyzeImport(ROWS.slice(2).map((row) => importRowSchema.parse(row)), DEFAULT_IMPORT_OPTIONS, LocalDate.parse('2026-10-15'));
        const carried = carryOverReview(closed, initialReview(smaller, 'p1', EXISTING));
        expect(carried.accounts.map((item) => [item.name, item.profileId])).toEqual([['Empresa', 'p2'], ['Banco Inter', 'p1']]);
        expect(carried.cards).toEqual([]);
        expect(carryOverReview(closed, initialReview(ANALYSIS, 'p1', EXISTING)).cards[0]?.closingDay).toBe(9);
    });

    it('monta a entrada da rota com as decisões', () => {
        const initial = initialReview(ANALYSIS, 'p1', EXISTING);
        const state = { ...initial, cards: initial.cards.map((item) => ({ ...item, closingDay: 8, limit: 5000 })) };
        const input = importRunInput(ROWS, state);
        expect(input.accounts).toEqual([
            { name: 'Banco Inter', profileId: 'p1', target: { kind: 'link', accountId: 'a1' } },
            { name: 'Empresa', profileId: 'p1', target: { kind: 'create', type: 'checking', considerBalance: true } },
        ]);
        expect(input.creditCards).toEqual([{ name: 'Inter', target: { kind: 'create', payingAccount: 'Banco Inter', closingDay: 8, dueDay: 15, limit: 5000 } }]);
        expect(input.rows).toHaveLength(4);
    });
});
