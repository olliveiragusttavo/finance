import { LocalDate, YearMonth } from '@finance/core';
import { formatDayMonth } from '../format/dates.ts';
import { formatWeekdayDayMonth } from './transactionDays.ts';

/*
 * Escolha de data no celular (mobile-mvp-plan, Fase 10): uma folha com o calendário do mês, sem
 * módulo nativo de seletor de data. A grade e os rótulos ficam aqui, sobre o `LocalDate` do
 * núcleo, sem `Date` nem `Intl`, que mudam o dia perto da meia-noite e diferem entre runtimes.
 */

/** Iniciais dos dias da semana, de domingo a sábado, como o calendário do desktop. */
export const WEEKDAY_INITIALS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'] as const;

/** Uma semana da grade: sete dias `YYYY-MM-DD`, com `null` antes do dia 1 e depois do último. */
export type DateGridWeek = readonly (string | null)[];

/**
 * @param period Competência `YYYY-MM`.
 * @return As semanas do mês, de domingo a sábado, com as casas vazias antes do dia 1 e depois do
 * último dia — a mesma disposição do Calendário do desktop.
 * @throws {InvalidValueError} Quando o texto não é uma competência válida.
 */
export function monthGrid(period: string): readonly DateGridWeek[] {
    const month = YearMonth.parse(period);
    const first = LocalDate.of(month.year, month.month, 1);
    const next = month.next();
    const days = LocalDate.of(next.year, next.month, 1).toEpochDay() - first.toEpochDay();
    // `dayOfWeek` é ISO (1 = segunda … 7 = domingo); o domingo abre a semana.
    const leading = first.dayOfWeek() % 7;
    const cells: (string | null)[] = [...Array<null>(leading).fill(null), ...Array.from({ length: days }, (_, index) => first.plusDays(index).toString())];
    while (cells.length % 7 !== 0) {
        cells.push(null);
    }
    return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}

/**
 * Rótulo da data escolhida num campo do lançamento: `Hoje, 06/10` e `Ontem, 05/10`, as escolhas
 * mais comuns de quem lança na hora; as demais com o dia da semana, `Seg, 12/10`, e o ano quando
 * não é o de hoje.
 *
 * @param date Data `YYYY-MM-DD`.
 * @param today Hoje, `YYYY-MM-DD`.
 * @return O rótulo.
 * @throws {InvalidValueError} Quando uma das datas não é válida.
 */
export function formatDateChoice(date: string, today: string): string {
    const day = LocalDate.parse(date);
    const now = LocalDate.parse(today);
    const distance = now.toEpochDay() - day.toEpochDay();
    if (distance === 0) {
        return `Hoje, ${formatDayMonth(date)}`;
    }
    if (distance === 1) {
        return `Ontem, ${formatDayMonth(date)}`;
    }
    const label = formatWeekdayDayMonth(date);
    return day.period.year === now.period.year ? label : `${label}/${String(day.period.year)}`;
}
