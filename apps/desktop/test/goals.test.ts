import type { GoalProgressResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { goalListView, openGoal, parseGoalsSearch } from '../src/renderer/src/goals/goalsSearch.ts';

const TRIP = '11111111-1111-4111-8111-111111111111';
const RESERVE = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';

/**
 * @param id Id da meta.
 * @param name Nome da meta.
 * @param states Se a meta foi atingida e se foi arquivada.
 * @return Uma meta como `goals.list` a devolve, com o progresso zerado.
 */
function goal(id: string, name: string, states: { readonly reached?: boolean; readonly archived?: boolean } = {}): GoalProgressResponse {
    const zero = { amount: 0, currency: 'BRL' };
    return {
        id,
        profileId: '77777777-7777-4777-8777-777777777777',
        name,
        funding: { kind: 'transactions' },
        value: { amount: 4000, currency: 'BRL' },
        targetDate: '2027-01-15',
        saved: zero,
        remaining: { amount: 4000, currency: 'BRL' },
        ratio: 0,
        reached: states.reached ?? false,
        linkedCount: 0,
        pending: { count: 0, total: zero },
        monthsLeft: 2.5,
        paceBase: { period: '2026-10', saved: zero, kind: 'current' },
        requiredPerMonth: { amount: 1600, currency: 'BRL' },
        averagePerMonth: null,
        projectedGap: null,
        archived: states.archived ?? false,
    };
}

describe('meta aberta na URL', () => {
    it('descarta id malformado e cai na primeira meta quando a da URL não existe mais', () => {
        expect(parseGoalsSearch({ goal: TRIP, period: '2026-10' })).toEqual({ goal: TRIP });
        expect(parseGoalsSearch({ goal: 'viagem' })).toEqual({});
        const list = [goal(RESERVE, 'Reserva'), goal(TRIP, 'Viagem')];
        expect(openGoal(list, { goal: TRIP })?.name).toBe('Viagem');
        expect(openGoal(list, { goal: '33333333-3333-4333-8333-333333333333' })?.name).toBe('Reserva');
        expect(openGoal([], {})).toBeNull();
    });

    it('a lista mostra por padrão só as ativas; a meta pedida sem visualização abre a lista dela (desktop-mvp-plan Fase 13.4)', () => {
        const list = [goal(ACCOUNT, 'Carro', { reached: true, archived: true }), goal(RESERVE, 'Reserva', { reached: true }), goal(TRIP, 'Viagem')];
        /**
         * Compara só os nomes, porque o teste confere quais metas cada visualização mostra, e não
         * o progresso calculado de cada uma.
         *
         * @param search Busca da URL, com ou sem visualização e meta aberta.
         * @return Os nomes das metas da lista, na ordem exibida.
         */
        const names = (search: Parameters<typeof goalListView>[1]): readonly string[] => goalListView(list, search).goals.map((item) => item.name);
        expect(parseGoalsSearch({ view: 'reached' })).toEqual({ view: 'reached' });
        expect(names({})).toEqual(['Viagem']);
        expect(names({ view: 'reached' })).toEqual(['Carro', 'Reserva']);
        expect(names({ view: 'archived' })).toEqual(['Carro']);
        expect(goalListView(list, { goal: RESERVE }).view).toBe('reached');
        expect(openGoal(list, { goal: ACCOUNT })?.name).toBe('Carro');
        expect(openGoal(list, { goal: ACCOUNT, view: 'active' })?.name).toBe('Viagem');
    });
});
