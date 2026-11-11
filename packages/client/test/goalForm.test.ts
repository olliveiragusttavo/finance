import type { GoalProgressResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { emptyGoalForm, GOAL_FIELDS, goalFormFrom, readGoalForm } from '../src/forms/goalForm.ts';

const TRIP = '11111111-1111-4111-8111-111111111111';
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

describe('formulário de meta (desktop-mvp-plan Fase 9.3)', () => {
    it('lê nome aparado, valor em pt-BR e data-alvo opcional', () => {
        expect(readGoalForm({ ...emptyGoalForm(), name: '  Viagem Floripa ', value: '4.000,00', targetDate: '2027-01-15' }, 'BRL')).toEqual({
            ok: true,
            content: { name: 'Viagem Floripa', funding: { kind: 'transactions' }, value: 4000, targetDate: '2027-01-15' },
        });
        expect(readGoalForm({ ...emptyGoalForm(), name: 'Reserva', value: '30000', targetDate: '' }, 'BRL')).toEqual({ ok: true, content: { name: 'Reserva', funding: { kind: 'transactions' }, value: 30000, targetDate: null } });
    });

    it('Regra de negócio (Metas): valor-alvo maior que zero; aponta todos os campos no mesmo envio', () => {
        expect(readGoalForm(emptyGoalForm(), 'BRL')).toEqual({ ok: false, errors: { name: 'Informe o nome da meta.', value: 'Informe o valor-alvo.' } });
        expect(readGoalForm({ ...emptyGoalForm(), name: 'Carro', value: '0,00', targetDate: '' }, 'BRL')).toEqual({ ok: false, errors: { value: 'Use um valor-alvo maior que zero.' } });
        expect(readGoalForm({ ...emptyGoalForm(), name: 'Carro', value: '-5', targetDate: '' }, 'BRL')).toEqual({ ok: false, errors: { value: 'Use um valor-alvo maior que zero.' } });
        expect(readGoalForm({ ...emptyGoalForm(), name: 'x'.repeat(46), value: '1.5', targetDate: '' }, 'BRL')).toEqual({ ok: false, errors: { name: 'Use no máximo 45 caracteres.', value: 'Digite um valor como 1.234,56.' } });
    });

    it('a edição parte da meta gravada, e todo campo do formulário é conhecido', () => {
        expect(goalFormFrom(goal(TRIP, 'Viagem'))).toEqual({ name: 'Viagem', fundingKind: 'transactions', accountId: '', value: '4.000,00', targetDate: '2027-01-15' });
        expect(goalFormFrom({ ...goal(TRIP, 'Casa'), funding: { kind: 'account', accountId: ACCOUNT } })).toMatchObject({ fundingKind: 'account', accountId: ACCOUNT });
        expect(goalFormFrom({ ...goal(TRIP, 'Viagem'), targetDate: null }).targetDate).toBe('');
        expect([...GOAL_FIELDS].sort()).toEqual(Object.keys(emptyGoalForm()).sort());
    });
});

describe('meta vinculada a conta no formulário (desktop-mvp-plan Fase 13.3)', () => {
    it('pede a conta de investimento e grava o tipo; a por lançamentos não leva conta', () => {
        expect(readGoalForm({ ...emptyGoalForm(), name: 'Casa', value: '20.000,00', fundingKind: 'account' }, 'BRL')).toEqual({ ok: false, errors: { accountId: 'Escolha a conta de investimento.' } });
        expect(readGoalForm({ ...emptyGoalForm(), name: 'Casa', value: '20.000,00', fundingKind: 'account', accountId: ACCOUNT }, 'BRL')).toEqual({
            ok: true,
            content: { name: 'Casa', funding: { kind: 'account', accountId: ACCOUNT }, value: 20000, targetDate: null },
        });
        const backToTransactions = readGoalForm({ ...emptyGoalForm(), name: 'Casa', value: '20.000,00', fundingKind: 'transactions', accountId: ACCOUNT }, 'BRL');
        expect(backToTransactions.ok && backToTransactions.content.funding).toEqual({ kind: 'transactions' });
    });
});
