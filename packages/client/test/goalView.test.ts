import type { GoalProgressResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { buildGoalContributionRows, describeGoalDeletion, describeGoalListItem, goalFigures, goalPendingNote, goalProjectionNote } from '../src/index.ts';
import { ClientWorld } from './support/ClientWorld.ts';

/**
 * @param amount Valor em reais.
 * @return O dinheiro como o núcleo o devolve.
 */
function brl(amount: number): { readonly amount: number; readonly currency: string } {
    return { amount, currency: 'BRL' };
}

/**
 * @param overrides Campos que o teste fixa.
 * @return A meta "Viagem Floripa" do mockup: 1.400 de 4.000 até 15/01/2027, em outubro.
 */
function trip(overrides: Partial<GoalProgressResponse> = {}): GoalProgressResponse {
    return {
        id: 'g1',
        profileId: 'p1',
        name: 'Viagem Floripa',
        value: brl(4000),
        targetDate: '2027-01-15',
        saved: brl(1400),
        remaining: brl(2600),
        ratio: 0.35,
        reached: false,
        linkedCount: 2,
        pending: { count: 0, total: brl(0) },
        monthsLeft: 2.497,
        paceBase: { period: '2026-10', saved: brl(1400), kind: 'current' },
        requiredPerMonth: brl(1041.26),
        averagePerMonth: brl(700),
        projectedGap: brl(-852.12),
        ...overrides,
    };
}

describe('lista e detalhe de Metas (mockup DesktopMetas)', () => {
    it('item da lista: percentual, barra limitada e "quanto de quanto · prazo"', () => {
        expect(describeGoalListItem(trip())).toEqual({ percentText: '35%', barRatio: 0.35, summary: 'R$ 1.400,00 de R$ 4.000,00 · até 15/01/2027' });
        expect(describeGoalListItem(trip({ targetDate: null, ratio: 1.2 }))).toMatchObject({ percentText: '120%', barRatio: 1, summary: 'R$ 1.400,00 de R$ 4.000,00 · sem data-alvo' });
        expect(describeGoalListItem(trip({ ratio: -0.05, saved: brl(-200) })).barRatio).toBe(0);
    });

    it('os três números: falta, data-alvo com os meses e ritmo com a média atual', () => {
        expect(goalFigures(trip())).toEqual([
            { label: 'Falta', value: 'R$ 2.600,00', note: 'para o valor-alvo' },
            { label: 'Data-alvo', value: '15/01/2027', note: 'cerca de 2,5 meses' },
            { label: 'Ritmo necessário', value: '≈ R$ 1.041,26/mês', note: 'média atual: R$ 700,00/mês' },
        ]);
        expect(goalFigures(trip({ monthsLeft: 3 }))[1].note).toBe('cerca de 3 meses');
        expect(goalFigures(trip({ monthsLeft: 1.04 }))[1].note).toBe('cerca de 1 mês');
        expect(goalFigures(trip({ monthsLeft: 0.4 }))[1].note).toBe('menos de 1 mês');
        expect(goalFigures(trip({ averagePerMonth: null }))[2].note).toBe('nenhum aporte até este mês');
    });

    it('sem ritmo: meta sem prazo, prazo encerrado e meta atingida dizem por quê', () => {
        expect(goalFigures(trip({ targetDate: null, monthsLeft: null, requiredPerMonth: null, projectedGap: null }))).toEqual([
            { label: 'Falta', value: 'R$ 2.600,00', note: 'para o valor-alvo' },
            { label: 'Data-alvo', value: 'Sem data-alvo', note: 'meta sem prazo' },
            { label: 'Ritmo necessário', value: '—', note: 'sem data-alvo não há ritmo a seguir' },
        ]);
        const ended = goalFigures(trip({ monthsLeft: 0, requiredPerMonth: null, projectedGap: null }));
        expect([ended[1].note, ended[2]]).toEqual(['prazo encerrado', { label: 'Ritmo necessário', value: '—', note: 'o prazo terminou' }]);
        const reached = goalFigures(trip({ reached: true, remaining: brl(0), requiredPerMonth: null, projectedGap: null }));
        expect([reached[0].note, reached[2].note]).toEqual(['meta atingida', 'a meta já foi atingida']);
    });

    it('projeção: abaixo, acima, exata, atingida e sem o que projetar', () => {
        expect(goalProjectionNote(trip())).toBe('No ritmo atual a meta fica R$ 852,12 abaixo na data-alvo.');
        expect(goalProjectionNote(trip({ projectedGap: brl(150) }))).toBe('No ritmo atual a meta passa R$ 150,00 do valor-alvo na data-alvo.');
        expect(goalProjectionNote(trip({ projectedGap: brl(0) }))).toBe('No ritmo atual a meta é atingida exatamente na data-alvo.');
        expect(goalProjectionNote(trip({ reached: true, saved: brl(4100) }))).toBe('Meta atingida: R$ 4.100,00 guardados de R$ 4.000,00.');
        expect(goalProjectionNote(trip({ projectedGap: null }))).toBeNull();
    });

    it('fora do mês atual o ritmo diz de quanto parte: guardado no fim de um mês passado ou previsto para um futuro', () => {
        const january = trip({ paceBase: { period: '2026-01', saved: brl(500), kind: 'past' }, averagePerMonth: brl(500), requiredPerMonth: brl(318.18), projectedGap: brl(2000) });
        expect(goalProjectionNote(january)).toBe('No fim de jan/2026 havia R$ 500,00 guardados. No ritmo até jan/2026 a meta passa R$ 2.000,00 do valor-alvo na data-alvo.');
        expect(goalFigures(january)[2].note).toBe('média até jan/2026: R$ 500,00/mês');
        // Sem aporte até aquele mês não há projeção, mas a base continua sendo dita.
        expect(goalProjectionNote(trip({ paceBase: { period: '2026-01', saved: brl(0), kind: 'past' }, averagePerMonth: null, projectedGap: null }))).toBe('No fim de jan/2026 havia R$ 0,00 guardados.');

        const december = trip({ paceBase: { period: '2026-12', saved: brl(2800), kind: 'estimated' }, projectedGap: brl(-500) });
        expect(goalProjectionNote(december)).toBe('A previsão para o fim de dez/2026 é de R$ 2.800,00 guardados. No ritmo atual a meta fica R$ 500,00 abaixo na data-alvo.');
        expect(goalFigures(december)[2].note).toBe('média atual: R$ 700,00/mês');

        // O alvo alcançado na base, mas não hoje, não tem ritmo a seguir, e a nota diz por quê.
        expect(goalFigures(trip({ paceBase: { period: '2027-01', saved: brl(4200), kind: 'estimated' }, requiredPerMonth: null, projectedGap: null }))[2]).toEqual({
            label: 'Ritmo necessário',
            value: '—',
            note: 'pela média, alcança o alvo até jan/2027',
        });
        expect(goalFigures(trip({ paceBase: { period: '2026-08', saved: brl(4000), kind: 'past' }, requiredPerMonth: null, projectedGap: null }))[2].note).toBe('alvo alcançado em ago/2026');
        // Sem prazo, a base não é dita: não há ritmo que parta dela.
        expect(goalProjectionNote(trip({ paceBase: { period: '2026-01', saved: brl(500), kind: 'past' }, targetDate: null, monthsLeft: null, requiredPerMonth: null, projectedGap: null }))).toBeNull();
    });

    it('pendentes e exclusão: singular, plural e nenhum', () => {
        expect(goalPendingNote(trip())).toBeNull();
        expect(goalPendingNote(trip({ pending: { count: 1, total: brl(700) } }))).toBe('1 lançamento vinculado ainda não conta (R$ 700,00): entra no progresso quando for pago.');
        expect(goalPendingNote(trip({ pending: { count: 3, total: brl(2100) } }))).toBe('3 lançamentos vinculados ainda não contam (R$ 2.100,00): entram no progresso quando forem pagos.');
        expect(describeGoalDeletion({ name: 'Viagem', linkedCount: 0 })).toBe('Nenhum lançamento está vinculado a Viagem; excluir só apaga a meta.');
        expect(describeGoalDeletion({ name: 'Viagem', linkedCount: 1 })).toBe('O lançamento vinculado perde o vínculo com Viagem e continua existindo, com os mesmos valores e saldos.');
        expect(describeGoalDeletion({ name: 'Viagem', linkedCount: 4 })).toBe('Os 4 lançamentos vinculados perdem o vínculo com Viagem e continuam existindo, com os mesmos valores e saldos.');
    });

    it('tabela das vinculadas: dia do pagamento, conta → destino e o valor que soma à meta', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        await world.ok('transactions.create', {
            profileId: s.profileId,
            subCategoryId: s.subCategoryId,
            type: 'transference',
            source: { kind: 'account', accountId: s.checkingId },
            destinationAccountId: s.savingsId,
            name: 'Reserva',
            value: 700,
            charges: 3.5,
            dueDate: '2026-10-03',
            paymentDate: '2026-10-04',
            goalId: s.goalId,
        });
        await world.ok('transactions.create', {
            profileId: s.profileId,
            subCategoryId: s.subCategoryId,
            type: 'income',
            source: { kind: 'account', accountId: s.checkingId },
            name: 'Devolução',
            value: -50,
            dueDate: '2026-10-06',
            paymentDate: '2026-10-06',
            goalId: s.goalId,
        });
        const [contributions, accounts, creditCards, categories] = await Promise.all([
            world.ok('goals.contributions', { id: s.goalId }),
            world.ok('accounts.list', { profileId: s.profileId, period: '2026-10' }),
            world.ok('creditCards.list', { profileId: s.profileId, period: '2026-10' }),
            world.ok('categories.tree', { profileId: s.profileId }),
        ]);
        const rows = buildGoalContributionRows({ contributions, accounts: accounts.accounts, creditCards: creditCards.creditCards, categories });
        expect(rows.map(({ date, name, category, account, amountText, refund }) => [date, name, category, account, amountText, refund])).toEqual([
            ['01/10', 'Salário', 'Alimentação › Mercado', 'Nubank', 'R$ 9.500,00', false],
            // Os encargos ficam fora: são custo da transferência, não dinheiro guardado.
            ['04/10', 'Reserva', 'Alimentação › Mercado', 'Nubank → Tesouro', 'R$ 700,00', false],
            ['06/10', 'Devolução', 'Alimentação › Mercado', 'Nubank', '−R$ 50,00', true],
        ]);
        const [goal] = await world.ok('goals.list', { profileId: s.profileId, period: '2026-10' });
        expect(goal?.saved.amount).toBe(10150);
    });
});
