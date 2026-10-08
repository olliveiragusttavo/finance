import { describe, expect, it } from 'vitest';
import { Goal } from '../../src/domain/goal/Goal.ts';
import { measureGoalProgress, type GoalLink } from '../../src/domain/goal/GoalProgress.ts';
import { InvalidValueError } from '../../src/domain/shared/errors.ts';
import { GoalId, ProfileId, TransactionId } from '../../src/domain/shared/ids.ts';
import { Currency, LocalDate, Money, YearMonth } from '../../src/index.ts';

const BRL = Currency.of('BRL');
const goalId = GoalId('00000000-0000-4000-8000-000000000001');
const profileId = ProfileId('00000000-0000-4000-8000-000000000002');

/**
 * @param target Valor-alvo.
 * @param targetDate Data-alvo `YYYY-MM-DD`, ou `null` sem prazo.
 * @return Uma meta válida, para que cada teste declare só o alvo.
 */
function goal(target: number, targetDate: string | null): Goal {
    return Goal.create({ id: goalId, profileId, name: 'Viagem Floripa', target: Money.of(target, BRL), targetDate: targetDate === null ? null : LocalDate.parse(targetDate) });
}

let sequence = 0;

/**
 * @param value Valor com sinal.
 * @param paidOn Dia do pagamento, ou `null` em aberto.
 * @return Uma transação vinculada com id próprio.
 */
function link(value: number, paidOn: string | null): GoalLink {
    sequence++;
    return { transactionId: TransactionId(`00000000-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`), value: Money.of(value, BRL), paidOn: paidOn === null ? null : LocalDate.parse(paidOn) };
}

/**
 * @param target Meta medida.
 * @param links Transações vinculadas.
 * @param period Mês de referência `YYYY-MM`.
 * @param today Hoje `YYYY-MM-DD`.
 * @return O progresso.
 */
function measure(target: Goal, links: readonly GoalLink[], period = '2026-10', today = '2026-10-08'): ReturnType<typeof measureGoalProgress> {
    return measureGoalProgress({ goal: target, links, period: YearMonth.parse(period), today: LocalDate.parse(today) });
}

describe('meta (database-design §4.11)', () => {
    it('apara o nome e recusa valor-alvo zero ou negativo, também ao editar', () => {
        const created = goal(4000, null);
        expect(Goal.create({ id: goalId, profileId, name: '  Reserva  ', target: created.target, targetDate: null }).name).toBe('Reserva');
        expect(() => goal(0, null)).toThrow(InvalidValueError);
        expect(() => goal(-10, null)).toThrow(InvalidValueError);
        // Arredonda a zero na precisão da moeda: também não há o que juntar.
        expect(() => goal(0.001, null)).toThrow(InvalidValueError);
        expect(() => created.revise({ name: 'Viagem', target: Money.of(0, BRL), targetDate: null })).toThrow(InvalidValueError);
        expect(created.revise({ name: 'Viagem', target: Money.of(5000, BRL), targetDate: null }).id).toBe(created.id);
    });
});

describe('progresso da meta (desktop-mvp-plan Fase 9.3)', () => {
    it('cenário do mockup: 2 aportes de 700 → 35%, falta 2.600, ritmo contado do fim do mês de referência', () => {
        const progress = measure(goal(4000, '2027-01-15'), [link(700, '2026-09-05'), link(700, '2026-10-05')]);
        expect(progress.saved.amount).toBe(1400);
        expect(progress.remaining.amount).toBe(2600);
        expect(progress.ratio).toBeCloseTo(0.35, 10);
        expect(progress.reached).toBe(false);
        // 31/10/2026 → 15/01/2027 são 76 dias, ~2,5 meses médios.
        expect(progress.monthsLeft).toBeCloseTo(76 / (365.2425 / 12), 10);
        expect(progress.requiredPerMonth?.rounded().amount).toBe(1041.26);
        expect(progress.averagePerMonth?.amount).toBe(700);
        expect(progress.projectedGap?.rounded().amount).toBe(-852.12);
        expect(progress.contributions.map((contribution) => contribution.paidOn.toString())).toEqual(['2026-09-05', '2026-10-05']);
    });

    it('Regra de negócio (Metas): só contam as pagas até hoje; em aberto e pagas depois de hoje ficam pendentes', () => {
        const progress = measure(goal(4000, null), [link(700, '2026-10-08'), link(700, null), link(300, '2026-10-09')]);
        expect(progress.saved.amount).toBe(700);
        expect(progress.pending).toEqual({ count: 2, total: Money.of(1000, BRL) });
        expect(progress.contributions).toHaveLength(1);
    });

    it('o progresso não depende do mês de referência; só o ritmo depende', () => {
        const links = [link(500, '2026-08-10'), link(500, '2026-10-01')];
        const target = goal(3000, '2027-06-30');
        const past = measure(target, links, '2026-08');
        const current = measure(target, links, '2026-10');
        expect(past.saved.amount).toBe(current.saved.amount);
        expect(past.monthsLeft).toBeGreaterThan(current.monthsLeft ?? 0);
        // Em agosto, a média só enxerga o aporte de agosto.
        expect(past.averagePerMonth?.amount).toBe(500);
    });

    it('Regra de negócio (Metas): num mês passado o ritmo parte do guardado no fim dele, sem contar de novo os aportes seguintes', () => {
        // Cenário da revisão de 2026-10-08 (item 2): 500 por mês de janeiro a outubro, alvo de
        // 6.000 em 31/12/2026, olhando janeiro em outubro.
        const links = Array.from({ length: 10 }, (_, index) => link(500, `2026-${String(index + 1).padStart(2, '0')}-05`));
        const progress = measure(goal(6000, '2026-12-31'), links, '2026-01');
        expect(progress.saved.amount).toBe(5000);
        expect(progress.paceBase).toEqual({ period: YearMonth.parse('2026-01'), saved: Money.of(500, BRL), kind: 'past' });
        expect(progress.averagePerMonth?.amount).toBe(500);
        // 31/01 → 31/12 são 334 dias, ~10,97 meses: 500 + 500 × 10,97 ≈ 5.986, e não 5.000 + 500 × 10,97.
        const months = 334 / (365.2425 / 12);
        expect(progress.projectedGap?.amount).toBeCloseTo(500 + 500 * months - 6000, 6);
        expect(progress.requiredPerMonth?.amount).toBeCloseTo(5500 / months, 6);
    });

    it('Regra de negócio (Metas): num mês futuro o ritmo parte do guardado hoje mais a média dos meses até ele', () => {
        const links = [link(500, '2026-09-05'), link(500, '2026-10-05')];
        const progress = measure(goal(6000, '2027-06-30'), links, '2026-12');
        // Outubro conta como fechado hoje; novembro e dezembro entram pela média.
        expect(progress.paceBase).toEqual({ period: YearMonth.parse('2026-12'), saved: Money.of(2000, BRL), kind: 'estimated' });
        const months = (LocalDate.parse('2027-06-30').toEpochDay() - LocalDate.parse('2026-12-31').toEpochDay()) / (365.2425 / 12);
        expect(progress.projectedGap?.amount).toBeCloseTo(2000 + 500 * months - 6000, 6);
        expect(progress.requiredPerMonth?.amount).toBeCloseTo(4000 / months, 6);
    });

    it('o alvo alcançado na base, mas não hoje, não tem ritmo; o mês atual parte do guardado hoje', () => {
        const links = [link(600, '2026-09-05'), link(600, '2026-10-05')];
        // Em março de 2027, pela média de 600, já haveria 4.200 de 4.000.
        const ahead = measure(goal(4000, '2027-12-31'), links, '2027-03');
        expect(ahead.reached).toBe(false);
        expect(ahead.paceBase.saved.amount).toBe(4200);
        expect([ahead.requiredPerMonth, ahead.projectedGap]).toEqual([null, null]);
        expect(measure(goal(4000, '2027-12-31'), links).paceBase).toEqual({ period: YearMonth.parse('2026-10'), saved: Money.of(1200, BRL), kind: 'current' });
    });

    it('estorno desconta; com mais estorno que aporte o progresso fica negativo e nada é atingido', () => {
        expect(measure(goal(1000, null), [link(400, '2026-10-01'), link(-100, '2026-10-02')]).saved.amount).toBe(300);
        const negative = measure(goal(1000, null), [link(-50, '2026-10-01')]);
        expect(negative.saved.amount).toBe(-50);
        expect(negative.remaining.amount).toBe(1050);
        expect(negative.reached).toBe(false);
    });

    it('meta atingida (inclusive passando do alvo): falta zero e não há ritmo nem projeção', () => {
        const exact = measure(goal(1000, '2027-01-15'), [link(600, '2026-09-01'), link(400, '2026-10-01')]);
        expect(exact.reached).toBe(true);
        expect(exact.remaining.amount).toBe(0);
        expect(exact.requiredPerMonth).toBeNull();
        expect(exact.projectedGap).toBeNull();
        const over = measure(goal(1000, null), [link(1200, '2026-10-01')]);
        expect(over.ratio).toBeCloseTo(1.2, 10);
        expect(over.reached).toBe(true);
    });

    it('meta sem prazo: sem meses restantes, sem ritmo necessário e sem projeção, mas com média', () => {
        const progress = measure(goal(30000, null), [link(600, '2026-09-10'), link(600, '2026-10-10')], '2026-10', '2026-10-31');
        expect(progress.monthsLeft).toBeNull();
        expect(progress.requiredPerMonth).toBeNull();
        expect(progress.projectedGap).toBeNull();
        expect(progress.averagePerMonth?.amount).toBe(600);
    });

    it('prazo encerrado no mês de referência: zero meses e nenhum ritmo', () => {
        const progress = measure(goal(4000, '2026-10-20'), [link(700, '2026-10-05')]);
        expect(progress.monthsLeft).toBe(0);
        expect(progress.requiredPerMonth).toBeNull();
        expect(progress.projectedGap).toBeNull();
    });

    it('a média conta mês sem aporte como zero e para no mês atual quando o de referência é futuro', () => {
        const links = [link(400, '2026-07-15'), link(400, '2026-10-01')];
        // Julho a outubro: 4 meses, 800 ÷ 4.
        expect(measure(goal(5000, '2027-12-31'), links).averagePerMonth?.amount).toBe(200);
        // Dezembro como referência: a média continua até outubro, o mês de hoje.
        expect(measure(goal(5000, '2027-12-31'), links, '2026-12').averagePerMonth?.amount).toBe(200);
        // Antes do 1º aporte não há média.
        expect(measure(goal(5000, '2027-12-31'), links, '2026-06').averagePerMonth).toBeNull();
    });

    it('sem nenhuma transação vinculada: progresso zero, sem média e com o ritmo do alvo inteiro', () => {
        const progress = measure(goal(1200, '2027-10-31'), []);
        expect(progress.saved.amount).toBe(0);
        expect(progress.averagePerMonth).toBeNull();
        expect(progress.projectedGap).toBeNull();
        // 365 dias são ~11,99 meses médios: 1.200 ÷ 11,99.
        expect(progress.requiredPerMonth?.rounded().amount).toBe(100.07);
    });
});
