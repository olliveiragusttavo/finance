import type { BalanceProjectionResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { buildBalanceProjectionView } from '../src/index.ts';

/**
 * @param amount Valor em reais.
 * @return O valor como o núcleo o devolve.
 */
function brl(amount: number): { readonly amount: number; readonly currency: string } {
    return { amount, currency: 'BRL' };
}

/**
 * @param overrides Campos que o teste quer fixar.
 * @return Uma projeção de 15/10/2026 com três meses de histórico, avulsos de −R$ 100,00 por mês e
 * desvio de R$ 50,00.
 */
function projection(overrides: Partial<BalanceProjectionResponse> = {}): BalanceProjectionResponse {
    return {
        basis: 12,
        today: '2026-10-15',
        history: [
            { period: '2026-07', result: brl(150), nonRecurring: brl(-50), recurring: brl(200) },
            { period: '2026-08', result: brl(-300), nonRecurring: brl(-100), recurring: brl(-200) },
            { period: '2026-09', result: brl(-350), nonRecurring: brl(-150), recurring: brl(-200) },
        ],
        average: brl(-100),
        deviation: brl(50),
        start: brl(1000),
        points: [
            { period: '2026-10', scheduled: brl(-200), estimated: brl(-50), balance: brl(750), low: brl(715), high: brl(785) },
            { period: '2026-11', scheduled: brl(-900), estimated: brl(-100), balance: brl(-250), low: brl(-311), high: brl(-189) },
        ],
        ...overrides,
    };
}

describe('projeção de saldo (reports-design §9)', () => {
    it('monta os indicadores, as três linhas a partir de hoje e as tabelas com o lançado e o estimado', () => {
        const view = buildBalanceProjectionView(projection());
        expect(view.kpis.map((kpi) => [kpi.label, kpi.value, kpi.sub, kpi.tone])).toEqual([
            ['Saldo hoje', 'R$ 1.000,00', 'Consolidado das contas do total', 'neutral'],
            ['Avulsos por mês', '−R$ 100,00', 'Estimativa: média de 3 meses, fora as séries', 'out'],
            ['Em nov/2026', '−R$ 250,00', 'Entre −R$ 311,00 e −R$ 189,00', 'neutral'],
        ]);
        expect(view.chart.series.map((series) => series.label)).toEqual(['Saldo projetado', 'Cenário pessimista', 'Cenário otimista']);
        expect(view.chart.data).toEqual([
            { group: 'today', label: 'Hoje', s0: 1000, s1: 1000, s2: 1000 },
            { group: '2026-10', label: 'out/2026', s0: 750, s1: 715, s2: 785 },
            { group: '2026-11', label: 'nov/2026', s0: -250, s1: -311, s2: -189 },
        ]);
        expect(view.chart.hasNegative).toBe(true);
        expect(view.projection[0]).toEqual({
            period: '2026-10',
            label: 'out/2026 (fim do mês)',
            scheduled: '−R$ 200,00',
            estimated: '−R$ 50,00',
            balance: 'R$ 750,00',
            range: 'R$ 715,00 a R$ 785,00',
            negative: false,
        });
        expect(view.projection[1]?.negative).toBe(true);
        expect(view.history[0]).toEqual({ period: '2026-07', label: 'jul/2026', result: '+R$ 150,00', recurring: '+R$ 200,00', nonRecurring: '−R$ 50,00' });
        expect(view.rangeNote).toBeNull();
    });

    it('Regra de negócio (Relatórios, §9): avisa do histórico curto e da falta de faixa', () => {
        expect(buildBalanceProjectionView(projection()).historyNote).toBe('O histórico tem só 3 meses fechados; a estimativa usa esses, e não 12 meses.');
        expect(buildBalanceProjectionView(projection({ basis: 3 })).historyNote).toBeNull();
        const single = buildBalanceProjectionView(projection({ basis: 6, deviation: brl(0), history: [{ period: '2026-09', result: brl(1), nonRecurring: brl(1), recurring: brl(0) }] }));
        expect(single.historyNote).toBe('O histórico tem só 1 mês fechado; a estimativa usa ele, e não 6 meses.');
        expect(single.rangeNote).toMatch(/sem faixa/);
        expect(single.chart.series).toHaveLength(1);
        expect(single.projection[0]?.range).toBe('—');
        const empty = buildBalanceProjectionView(projection({ history: [], average: brl(0), deviation: brl(0) }));
        expect(empty.historyNote).toMatch(/usa só o que já está lançado/);
        expect(empty.rangeNote).toBeNull();
        expect(empty.kpis[1]).toMatchObject({ tone: 'neutral', sub: 'Sem mês fechado no histórico' });
    });

    it('Regra de negócio (Relatórios, §9, B5): com vários meses de avulsos iguais, o aviso diz que não variaram, e não que há um mês', () => {
        const flat = [
            { period: '2026-07', result: brl(-200), nonRecurring: brl(0), recurring: brl(-200) },
            { period: '2026-08', result: brl(-200), nonRecurring: brl(0), recurring: brl(-200) },
            { period: '2026-09', result: brl(-200), nonRecurring: brl(0), recurring: brl(-200) },
        ];
        const view = buildBalanceProjectionView(projection({ basis: 3, history: flat, average: brl(0), deviation: brl(0) }));
        expect(view.historyNote).toBeNull();
        expect(view.rangeNote).toMatch(/não variaram/);
        expect(view.rangeNote).not.toMatch(/um mês/);
    });
});
