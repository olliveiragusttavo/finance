import type { GoalProgressResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { emptyGoalForm, GOAL_FIELDS, goalFormFrom, readGoalForm } from '../src/renderer/src/goals/goalForm.ts';
import { openGoal, parseGoalsSearch } from '../src/renderer/src/goals/goalsSearch.ts';

const TRIP = '11111111-1111-4111-8111-111111111111';
const RESERVE = '22222222-2222-4222-8222-222222222222';

/**
 * @param id Id da meta.
 * @param name Nome da meta.
 * @return Uma meta como `goals.list` a devolve, com o progresso zerado.
 */
function goal(id: string, name: string): GoalProgressResponse {
    const zero = { amount: 0, currency: 'BRL' };
    return {
        id,
        profileId: '77777777-7777-4777-8777-777777777777',
        name,
        value: { amount: 4000, currency: 'BRL' },
        targetDate: '2027-01-15',
        saved: zero,
        remaining: { amount: 4000, currency: 'BRL' },
        ratio: 0,
        reached: false,
        linkedCount: 0,
        pending: { count: 0, total: zero },
        monthsLeft: 2.5,
        paceBase: { period: '2026-10', saved: zero, kind: 'current' },
        requiredPerMonth: { amount: 1600, currency: 'BRL' },
        averagePerMonth: null,
        projectedGap: null,
    };
}

describe('formulário de meta (desktop-mvp-plan Fase 9.3)', () => {
    it('lê nome aparado, valor em pt-BR e data-alvo opcional', () => {
        expect(readGoalForm({ name: '  Viagem Floripa ', value: '4.000,00', targetDate: '2027-01-15' }, 'BRL')).toEqual({
            ok: true,
            content: { name: 'Viagem Floripa', value: 4000, targetDate: '2027-01-15' },
        });
        expect(readGoalForm({ name: 'Reserva', value: '30000', targetDate: '' }, 'BRL')).toEqual({ ok: true, content: { name: 'Reserva', value: 30000, targetDate: null } });
    });

    it('Regra de negócio (Metas): valor-alvo maior que zero; aponta todos os campos no mesmo envio', () => {
        expect(readGoalForm(emptyGoalForm(), 'BRL')).toEqual({ ok: false, errors: { name: 'Informe o nome da meta.', value: 'Informe o valor-alvo.' } });
        expect(readGoalForm({ name: 'Carro', value: '0,00', targetDate: '' }, 'BRL')).toEqual({ ok: false, errors: { value: 'Use um valor-alvo maior que zero.' } });
        expect(readGoalForm({ name: 'Carro', value: '-5', targetDate: '' }, 'BRL')).toEqual({ ok: false, errors: { value: 'Use um valor-alvo maior que zero.' } });
        expect(readGoalForm({ name: 'x'.repeat(46), value: '1.5', targetDate: '' }, 'BRL')).toEqual({ ok: false, errors: { name: 'Use no máximo 45 caracteres.', value: 'Digite um valor como 1.234,56.' } });
    });

    it('a edição parte da meta gravada, e todo campo do formulário é conhecido', () => {
        expect(goalFormFrom(goal(TRIP, 'Viagem'))).toEqual({ name: 'Viagem', value: '4.000,00', targetDate: '2027-01-15' });
        expect(goalFormFrom({ ...goal(TRIP, 'Viagem'), targetDate: null }).targetDate).toBe('');
        expect([...GOAL_FIELDS].sort()).toEqual(Object.keys(emptyGoalForm()).sort());
    });
});

describe('meta aberta na URL', () => {
    it('descarta id malformado e cai na primeira meta quando a da URL não existe mais', () => {
        expect(parseGoalsSearch({ goal: TRIP, period: '2026-10' })).toEqual({ goal: TRIP });
        expect(parseGoalsSearch({ goal: 'viagem' })).toEqual({});
        const list = [goal(RESERVE, 'Reserva'), goal(TRIP, 'Viagem')];
        expect(openGoal(list, { goal: TRIP })?.name).toBe('Viagem');
        expect(openGoal(list, { goal: '33333333-3333-4333-8333-333333333333' })?.name).toBe('Reserva');
        expect(openGoal([], {})).toBeNull();
    });
});
