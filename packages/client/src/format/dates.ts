import { LocalDate, YearMonth } from '@finance/core';

const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'] as const;

/*
 * Datas e meses no padrão dos mockups, sem `Intl` nem `Date`: o resultado de `Intl` difere
 * entre o Chromium e o Hermes, e um `Date` construído no fuso errado muda o dia perto da
 * meia-noite (backend-design §5.7). As entradas são o texto ISO dos DTOs, interpretado pelos
 * Value Objects do núcleo, que recusam data inexistente.
 */

/**
 * @param date Data `YYYY-MM-DD`.
 * @return Dia e mês, `08/10` — a data das tabelas e das etiquetas ("vence 10/10").
 * @throws {InvalidValueError} Quando o texto não é uma data válida.
 */
export function formatDayMonth(date: string): string {
    const parsed = LocalDate.parse(date);
    return `${pad(parsed.day)}/${pad(parsed.period.month)}`;
}

/**
 * @param date Data `YYYY-MM-DD`.
 * @return A data completa, `08/10/2026` — a dos campos de edição.
 * @throws {InvalidValueError} Quando o texto não é uma data válida.
 */
export function formatDate(date: string): string {
    const parsed = LocalDate.parse(date);
    return `${formatDayMonth(date)}/${String(parsed.period.year)}`;
}

/**
 * @param period Competência `YYYY-MM`.
 * @return O mês por extenso, `Outubro de 2026` — o da barra do mês de referência.
 * @throws {InvalidValueError} Quando o texto não é uma competência válida.
 */
export function formatMonthLong(period: string): string {
    const parsed = YearMonth.parse(period);
    return `${monthName(parsed.month)} de ${String(parsed.year)}`;
}

/**
 * @param period Competência `YYYY-MM`.
 * @return O mês abreviado com o ano, `out/2026` — o das colunas dos relatórios.
 * @throws {InvalidValueError} Quando o texto não é uma competência válida.
 */
export function formatMonthShort(period: string): string {
    const parsed = YearMonth.parse(period);
    return `${formatMonthAbbreviation(period)}/${String(parsed.year)}`;
}

/**
 * @param period Competência `YYYY-MM`.
 * @return Só o mês abreviado, `out` — o de "fat. nov" e "paga no extrato de jul", onde o ano
 * se subentende pela vizinhança do mês de referência.
 * @throws {InvalidValueError} Quando o texto não é uma competência válida.
 */
export function formatMonthAbbreviation(period: string): string {
    return monthName(YearMonth.parse(period).month).slice(0, 3).toLowerCase();
}

/**
 * @param month Mês 1–12, já validado pelo `YearMonth`.
 * @return O nome do mês com inicial maiúscula.
 */
function monthName(month: number): string {
    return MONTH_NAMES[month - 1] ?? '';
}

/**
 * @param value Dia ou mês.
 * @return O número com dois dígitos.
 */
function pad(value: number): string {
    return String(value).padStart(2, '0');
}
