import { describe, expect, it } from 'vitest';
import { seriesHasOccurrence, seriesValueOf } from '../../src/domain/recurrence/Recurrence.ts';
import { anchorDayOf, moveToAnchor, RecurrenceSchedule } from '../../src/domain/recurrence/RecurrenceSchedule.ts';
import { Currency } from '../../src/domain/shared/Currency.ts';
import { LocalDate } from '../../src/domain/shared/LocalDate.ts';
import { Money } from '../../src/domain/shared/Money.ts';
import { YearMonth } from '../../src/domain/shared/YearMonth.ts';

const BRL = Currency.of('BRL');

/**
 * @param schedule Calendário.
 * @param count Quantas ocorrências listar a partir da 1ª.
 * @return As datas das ocorrências, como texto.
 */
function dates(schedule: RecurrenceSchedule, count: number): readonly string[] {
    return Array.from({ length: count }, (_, index) => schedule.dateOf(index + 1).toString());
}

describe('aritmética de datas sem Date (backend-design §5.7)', () => {
    it('dias desde 1970 vão e voltam, atravessando anos bissextos e a virada do século', () => {
        for (const text of ['1970-01-01', '2000-02-29', '2026-12-31', '2027-01-01', '2100-03-01', '1900-01-01']) {
            const date = LocalDate.parse(text);
            expect(LocalDate.ofEpochDay(date.toEpochDay()).toString()).toBe(text);
        }
        expect(LocalDate.parse('1970-01-01').toEpochDay()).toBe(0);
        expect(LocalDate.parse('2026-02-28').plusDays(1).toString()).toBe('2026-03-01');
        expect(LocalDate.parse('2028-02-28').plusDays(1).toString()).toBe('2028-02-29');
        expect(LocalDate.parse('2027-01-01').plusDays(-1).toString()).toBe('2026-12-31');
    });

    it('dia da semana ISO, com a semana começando na segunda', () => {
        expect(LocalDate.parse('2026-10-05').dayOfWeek()).toBe(1);
        expect(LocalDate.parse('2026-10-11').dayOfWeek()).toBe(7);
        expect(LocalDate.parse('1970-01-01').dayOfWeek()).toBe(4);
    });

    it('meses andam para frente e para trás e contam a distância', () => {
        expect(YearMonth.parse('2026-11').plusMonths(3).toString()).toBe('2027-02');
        expect(YearMonth.parse('2026-01').plusMonths(-1).toString()).toBe('2025-12');
        expect(YearMonth.parse('2026-10').monthsUntil(YearMonth.parse('2027-01'))).toBe(3);
        expect(YearMonth.parse('2026-10').monthsUntil(YearMonth.parse('2026-09'))).toBe(-1);
    });
});

describe('calendário da série (database-design §4.12)', () => {
    it('mensal no dia 31 cai no último dia dos meses curtos e volta ao 31', () => {
        const schedule = RecurrenceSchedule.startingOn('monthly', LocalDate.parse('2026-01-31'));
        expect(dates(schedule, 5)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
        const leap = RecurrenceSchedule.startingOn('monthly', LocalDate.parse('2028-01-31'));
        expect(leap.dateOf(2).toString()).toBe('2028-02-29');
    });

    it('anual em 29/02 vence em 28/02 nos anos comuns e volta ao 29 no bissexto', () => {
        const schedule = RecurrenceSchedule.startingOn('yearly', LocalDate.parse('2028-02-29'));
        expect(dates(schedule, 5)).toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
    });

    it('diária e semanal, atravessando a virada do ano', () => {
        expect(dates(RecurrenceSchedule.startingOn('daily', LocalDate.parse('2026-12-30')), 3)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
        expect(dates(RecurrenceSchedule.startingOn('weekly', LocalDate.parse('2026-12-24')), 3)).toEqual(['2026-12-24', '2026-12-31', '2027-01-07']);
    });

    it('trocar o dia âncora leva cada ocorrência para o dia novo dentro do próprio mês ou semana', () => {
        // Mensal no dia 5 passa para o 31: fica no mesmo mês, no último dia quando não há 31.
        expect(moveToAnchor('monthly', LocalDate.parse('2026-02-05'), 31).toString()).toBe('2026-02-28');
        expect(moveToAnchor('monthly', LocalDate.parse('2026-03-05'), 31).toString()).toBe('2026-03-31');
        // Semanal de segunda (05/10) para sexta: a mesma semana, não a seguinte.
        expect(moveToAnchor('weekly', LocalDate.parse('2026-10-05'), 5).toString()).toBe('2026-10-09');
        expect(moveToAnchor('weekly', LocalDate.parse('2026-10-11'), 1).toString()).toBe('2026-10-05');

        const schedule = RecurrenceSchedule.startingOn('monthly', LocalDate.parse('2026-01-05')).withAnchorFrom(LocalDate.parse('2026-03-31'));
        expect(dates(schedule, 4)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    });

    it('a diária não tem dia âncora: trocar a data só vale para "somente esta"', () => {
        const schedule = RecurrenceSchedule.startingOn('daily', LocalDate.parse('2026-10-05'));
        expect(anchorDayOf('daily', LocalDate.parse('2026-10-05'))).toBeNull();
        expect(() => schedule.withAnchorFrom(LocalDate.parse('2026-10-07'))).toThrow('numa série diária, trocar a data só vale para "somente esta"');
    });

    it('recusa dia âncora que não combina com a frequência', () => {
        expect(() => RecurrenceSchedule.of({ frequency: 'weekly', startsOn: LocalDate.parse('2026-10-05'), startsAt: 1, anchorDay: 8 })).toThrow();
        expect(() => RecurrenceSchedule.of({ frequency: 'daily', startsOn: LocalDate.parse('2026-10-05'), startsAt: 1, anchorDay: 5 })).toThrow();
        expect(() => RecurrenceSchedule.of({ frequency: 'monthly', startsOn: LocalDate.parse('2026-10-05'), startsAt: 0, anchorDay: 5 })).toThrow();
    });
});

describe('parcelas (database-design §4.12)', () => {
    it('o total dividido põe a diferença do arredondamento na primeira e soma exatamente o total', () => {
        expect(Money.of(1000, BRL).split(3).map((part) => part.amount)).toEqual([333.34, 333.33, 333.33]);
        expect(Money.of(-100, BRL).split(3).map((part) => part.amount)).toEqual([-33.34, -33.33, -33.33]);
        const parts = Money.of(4800.01, BRL).split(12);
        expect(parts.reduce((sum, part) => sum.add(part), Money.zero(BRL)).rounded().amount).toBe(4800.01);
        expect(() => Money.of(10, BRL).split(0)).toThrow();
    });

    it('valor e existência de cada ocorrência por forma da série', () => {
        const schedule = RecurrenceSchedule.startingOn('monthly', LocalDate.parse('2026-10-05'));
        const total = { kind: 'installments', installments: 3, valueType: 'total' } as const;
        expect([1, 2, 3].map((n) => seriesValueOf(total, Money.of(1000, BRL), n).amount)).toEqual([333.34, 333.33, 333.33]);
        expect(seriesValueOf({ ...total, valueType: 'perInstallment' }, Money.of(100, BRL), 2).amount).toBe(100);
        expect([0, 1, 3, 4].map((n) => seriesHasOccurrence(total, schedule, n))).toEqual([false, true, true, false]);
        const fixed = { kind: 'fixed', endAt: LocalDate.parse('2026-12-05') } as const;
        expect([3, 4].map((n) => seriesHasOccurrence(fixed, schedule, n))).toEqual([true, false]);
        expect(seriesHasOccurrence({ kind: 'fixed', endAt: null }, schedule, 500)).toBe(true);
    });
});
