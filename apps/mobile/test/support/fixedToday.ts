/** O `Date` de verdade, para restaurar depois do teste. */
const RealDate = Date;

/**
 * Fixa só o relógio de parede (`new Date()` e `Date.now()`) no dia do cenário: as telas sugerem
 * "hoje" pelo calendário do aparelho, como o desktop. Não usa os *fake timers* do Jest, que
 * falsificam também o relógio dos temporizadores e deixavam o teste seguinte sem montar o app.
 *
 * @param year Ano.
 * @param month Mês, de 1 a 12.
 * @param day Dia.
 */
export function fixToday(year: number, month: number, day: number): void {
    const fixed = new RealDate(year, month - 1, day, 12, 0).getTime();
    /** `Date` cujo "agora" é o dia fixado; com argumentos, a data pedida, como o original. */
    class FixedDate extends RealDate {
        /**
         * @param value Data pedida, como no `Date`; sem ela, o instante fixado.
         */
        public constructor(value?: string | number | Date) {
            super(value ?? fixed);
        }

        /** @return O instante fixado, em milissegundos. */
        public static override now(): number {
            return fixed;
        }
    }
    globalThis.Date = FixedDate as DateConstructor;
}

/** Devolve o `Date` de verdade; chamado depois de cada teste que fixou o dia. */
export function restoreToday(): void {
    globalThis.Date = RealDate;
}
