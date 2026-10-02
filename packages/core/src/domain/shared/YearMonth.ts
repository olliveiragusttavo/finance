import { InvalidValueError } from './errors.ts';

const PATTERN = /^(\d{4})-(\d{2})$/;

/**
 * Competência mensal (ano e mês). É a chave natural de extratos e faturas — "uma linha por
 * mês" (database-design §4.6) — e existe como Value Object para que a aritmética de meses
 * (virada de ano, mês anterior) fique num lugar só, em vez de `month - 1` espalhado e
 * errado em janeiro.
 */
export class YearMonth {
    /**
     * @param year Ano, 1900–9999, a faixa de `ck_bank_statements_year`.
     * @param month Mês, 1–12.
     */
    private constructor(public readonly year: number, public readonly month: number) {}

    /**
     * @param year Ano da competência; validado contra a faixa do schema para falhar aqui, e
     * não com um `CHECK constraint failed` no meio de uma unidade de trabalho.
     * @param month Mês da competência, 1–12.
     * @return A competência.
     * @throws {InvalidValueError} Quando ano ou mês estão fora da faixa.
     */
    public static of(year: number, month: number): YearMonth {
        if (!Number.isInteger(year) || year < 1900 || year > 9999) {
            throw new InvalidValueError('year', `ano fora da faixa 1900–9999: ${year}`);
        }
        if (!Number.isInteger(month) || month < 1 || month > 12) {
            throw new InvalidValueError('month', `mês fora da faixa 1–12: ${month}`);
        }
        return new YearMonth(year, month);
    }

    /**
     * @param text Competência no formato `YYYY-MM`, o usado nos DTOs.
     * @return A competência.
     * @throws {InvalidValueError} Quando o texto não segue o formato ou está fora da faixa.
     */
    public static parse(text: string): YearMonth {
        const match = PATTERN.exec(text);
        if (match === null) {
            throw new InvalidValueError('period', `competência fora do formato YYYY-MM: "${text}"`);
        }
        return YearMonth.of(Number(match[1]), Number(match[2]));
    }

    /**
     * @return A competência seguinte, virando o ano em dezembro.
     */
    public next(): YearMonth {
        return this.month === 12 ? YearMonth.of(this.year + 1, 1) : YearMonth.of(this.year, this.month + 1);
    }

    /**
     * @return A competência anterior, voltando o ano em janeiro.
     */
    public previous(): YearMonth {
        return this.month === 1 ? YearMonth.of(this.year - 1, 12) : YearMonth.of(this.year, this.month - 1);
    }

    /**
     * Número de dias do mês, com fevereiro bissexto. Calculado sem `Date` para que o
     * resultado não dependa do fuso do aparelho (backend-design §5.7).
     *
     * @return 28 a 31.
     */
    public lengthInDays(): number {
        if (this.month === 2) {
            const leap = (this.year % 4 === 0 && this.year % 100 !== 0) || this.year % 400 === 0;
            return leap ? 29 : 28;
        }
        return [4, 6, 9, 11].includes(this.month) ? 30 : 31;
    }

    /**
     * Ordena competências. Existe porque a cadeia de fechamentos depende da ordem
     * cronológica dos extratos, e comparar ano e mês separadamente em cada ponto é onde o
     * erro de dezembro → janeiro costuma aparecer.
     *
     * @param other Competência a comparar.
     * @return Negativo se esta vem antes, zero se iguais, positivo se vem depois.
     */
    public compare(other: YearMonth): number {
        return this.year !== other.year ? this.year - other.year : this.month - other.month;
    }

    /**
     * @param other Competência a comparar.
     * @return `true` quando é o mesmo mês do mesmo ano.
     */
    public equals(other: YearMonth): boolean {
        return this.compare(other) === 0;
    }

    /**
     * @param other Competência a comparar.
     * @return `true` quando esta vem estritamente antes da outra.
     */
    public isBefore(other: YearMonth): boolean {
        return this.compare(other) < 0;
    }

    /**
     * @return A competência no formato `YYYY-MM`; ordena corretamente como texto e é a
     * forma dos DTOs.
     */
    public toString(): string {
        return `${String(this.year).padStart(4, '0')}-${String(this.month).padStart(2, '0')}`;
    }

    /**
     * Devolve a menor de duas competências. Existe para acumular "a partir de qual mês
     * recalcular" quando uma edição toca dois meses (o antigo e o novo).
     *
     * @param a Primeira competência.
     * @param b Segunda competência.
     * @return A que vem antes; `a` quando iguais.
     */
    public static min(a: YearMonth, b: YearMonth): YearMonth {
        return b.isBefore(a) ? b : a;
    }
}
