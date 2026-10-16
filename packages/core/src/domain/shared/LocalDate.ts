import { InvalidValueError } from './errors.ts';
import { YearMonth } from './YearMonth.ts';

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Data de calendário sem hora nem fuso, como o `TEXT` `YYYY-MM-DD` do schema
 * (database-design §3.9). Não usa `Date` porque um `Date` construído no fuso errado só
 * vira bug perto da meia-noite de um dia 31 (backend-design §5.7) — e vencimento e
 * pagamento são datas do calendário do usuário, não instantes.
 */
export class LocalDate {
    /**
     * @param period Competência da data; guardada pronta porque quase toda regra de
     * extrato e fatura pergunta "em que mês cai".
     * @param day Dia do mês, já validado contra o tamanho do mês.
     */
    private constructor(public readonly period: YearMonth, public readonly day: number) {}

    /**
     * @param year Ano da data.
     * @param month Mês da data, 1–12.
     * @param day Dia do mês; validado contra o mês real (sem 30/02), como o `CHECK` de
     * formato do schema faria, mas falhando antes de abrir a unidade de trabalho.
     * @return A data.
     * @throws {InvalidValueError} Quando a data não existe no calendário.
     */
    public static of(year: number, month: number, day: number): LocalDate {
        const period = YearMonth.of(year, month);
        if (!Number.isInteger(day) || day < 1 || day > period.lengthInDays()) {
            throw new InvalidValueError('date', `dia inexistente: ${period.toString()}-${day}`);
        }
        return new LocalDate(period, day);
    }

    /**
     * @param text Data no formato `YYYY-MM-DD`, o do banco e dos DTOs.
     * @return A data.
     * @throws {InvalidValueError} Quando o texto não segue o formato ou a data não existe.
     */
    public static parse(text: string): LocalDate {
        const match = PATTERN.exec(text);
        if (match === null) {
            throw new InvalidValueError('date', `data fora do formato YYYY-MM-DD: "${text}"`);
        }
        return LocalDate.of(Number(match[1]), Number(match[2]), Number(match[3]));
    }

    /**
     * Data do dia pedido no mês, com o dia inexistente virando o último dia do mês.
     * Regra de negócio (Cartão de crédito): um cartão que fecha no dia 31 fecha em 30/04,
     * em 28/02 e em 29/02 nos bissextos; o dia guardado continua 31 e o ajuste é feito a
     * cada mês, para que maio volte a fechar no dia 31 (database-design §4.5).
     *
     * @param period Mês em que a data deve cair.
     * @param day Dia do mês desejado, 1–31.
     * @return A data, ajustada para o último dia quando o mês é mais curto.
     */
    public static clampedTo(period: YearMonth, day: number): LocalDate {
        return LocalDate.of(period.year, period.month, Math.min(day, period.lengthInDays()));
    }

    /**
     * @param other Data a comparar.
     * @return Negativo se esta vem antes, zero se iguais, positivo se vem depois.
     */
    public compare(other: LocalDate): number {
        const byPeriod = this.period.compare(other.period);
        return byPeriod !== 0 ? byPeriod : this.day - other.day;
    }

    /**
     * @param other Data a comparar.
     * @return `true` quando esta vem estritamente antes da outra.
     */
    public isBefore(other: LocalDate): boolean {
        return this.compare(other) < 0;
    }

    /**
     * @param other Data a comparar.
     * @return `true` quando são o mesmo dia.
     */
    public equals(other: LocalDate): boolean {
        return this.compare(other) === 0;
    }

    /**
     * Dias desde 1970-01-01 no calendário gregoriano proleptico, sem `Date`: um `Date` montado no
     * fuso do aparelho muda o dia perto da meia-noite (backend-design §5.7). Algoritmo
     * `days_from_civil` de Howard Hinnant, só aritmética inteira.
     *
     * @return O número do dia.
     */
    public toEpochDay(): number {
        const year = this.period.month <= 2 ? this.period.year - 1 : this.period.year;
        const era = Math.floor(year / 400);
        const yearOfEra = year - era * 400;
        const shiftedMonth = (this.period.month + 9) % 12;
        const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + this.day - 1;
        const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
        return era * 146097 + dayOfEra - 719468;
    }

    /**
     * Inverso de `toEpochDay` (`civil_from_days`).
     *
     * @param epochDay Dias desde 1970-01-01.
     * @return A data.
     * @throws {InvalidValueError} Quando o ano sai da faixa aceita.
     */
    public static ofEpochDay(epochDay: number): LocalDate {
        const shifted = epochDay + 719468;
        const era = Math.floor(shifted / 146097);
        const dayOfEra = shifted - era * 146097;
        const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
        const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
        const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
        const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1;
        const month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9;
        return LocalDate.of(yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day);
    }

    /**
     * @param days Dias a andar; negativo volta.
     * @return A data deslocada.
     */
    public plusDays(days: number): LocalDate {
        return LocalDate.ofEpochDay(this.toEpochDay() + days);
    }

    /**
     * @return O dia da semana ISO: 1 = segunda … 7 = domingo. A semana começa na segunda, como
     * no calendário brasileiro de trabalho e na ISO 8601.
     */
    public dayOfWeek(): number {
        // 1970-01-01 foi uma quinta-feira (4).
        return ((this.toEpochDay() + 3) % 7 + 7) % 7 + 1;
    }

    /**
     * @return A data no formato `YYYY-MM-DD`, que ordena corretamente como texto e é a
     * forma persistida.
     */
    public toString(): string {
        return `${this.period.toString()}-${String(this.day).padStart(2, '0')}`;
    }
}
