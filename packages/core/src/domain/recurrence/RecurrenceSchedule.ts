import { BusinessRuleViolation, InvalidValueError } from '../shared/errors.ts';
import { LocalDate } from '../shared/LocalDate.ts';

/** Intervalo entre ocorrências (database-design §4.12, coluna `recurrence`). */
export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export const RECURRENCE_FREQUENCIES: readonly RecurrenceFrequency[] = ['daily', 'weekly', 'monthly', 'yearly'];

/** Dados do calendário, como a regra os guarda. */
export interface RecurrenceScheduleProps {
    readonly frequency: RecurrenceFrequency;
    /** Data da ocorrência de referência. */
    readonly startsOn: LocalDate;
    /** Número da ocorrência de referência (a 1ª é 1). */
    readonly startsAt: number;
    /** Dia do mês (mensal, anual), dia ISO da semana (semanal) ou `null` (diária). */
    readonly anchorDay: number | null;
}

/**
 * Calendário de uma série (database-design §4.12). Calcula a data de qualquer ocorrência direto
 * a partir da de referência, e não avançando uma a uma, para que o "último dia do mês" de um mês
 * curto não contamine as seguintes.
 * Regra de negócio (Recorrências): num mês sem o dia âncora a ocorrência cai no último dia do
 * mês, e a seguinte volta ao dia âncora — mensal no dia 31 vence em 31/01, 28/02, 31/03; anual
 * em 29/02 vence em 28/02 nos anos comuns.
 */
export class RecurrenceSchedule implements RecurrenceScheduleProps {
    public readonly frequency: RecurrenceFrequency;
    public readonly startsOn: LocalDate;
    public readonly startsAt: number;
    public readonly anchorDay: number | null;

    /**
     * @param props Calendário já validado por `of`.
     */
    private constructor(props: RecurrenceScheduleProps) {
        this.frequency = props.frequency;
        this.startsOn = props.startsOn;
        this.startsAt = props.startsAt;
        this.anchorDay = props.anchorDay;
        Object.freeze(this);
    }

    /**
     * @param props Calendário.
     * @return O calendário.
     * @throws {InvalidValueError} Quando o número de referência não é positivo ou o dia âncora
     * não combina com a frequência — estados que deixariam a série sem data calculável.
     */
    public static of(props: RecurrenceScheduleProps): RecurrenceSchedule {
        if (!Number.isInteger(props.startsAt) || props.startsAt < 1) {
            throw new InvalidValueError('startsAt', `número de ocorrência inválido: ${props.startsAt}`);
        }
        const limit = ANCHOR_LIMIT[props.frequency];
        const valid = limit === null ? props.anchorDay === null : props.anchorDay !== null && Number.isInteger(props.anchorDay) && props.anchorDay >= 1 && props.anchorDay <= limit;
        if (!valid) {
            throw new InvalidValueError('anchorDay', `dia âncora ${String(props.anchorDay)} inválido para a frequência ${props.frequency}`);
        }
        return new RecurrenceSchedule(props);
    }

    /**
     * Calendário de uma série nova, com a 1ª ocorrência na data do lançamento.
     *
     * @param frequency Frequência escolhida.
     * @param firstDate Data da 1ª ocorrência; dá o dia âncora.
     * @return O calendário.
     */
    public static startingOn(frequency: RecurrenceFrequency, firstDate: LocalDate): RecurrenceSchedule {
        return RecurrenceSchedule.of({ frequency, startsOn: firstDate, startsAt: 1, anchorDay: anchorDayOf(frequency, firstDate) });
    }

    /**
     * @param occurrence Número da ocorrência, a partir de 1.
     * @return A data de vencimento da ocorrência pelo calendário.
     */
    public dateOf(occurrence: number): LocalDate {
        const steps = occurrence - this.startsAt;
        switch (this.frequency) {
            case 'daily':
                return this.startsOn.plusDays(steps);
            case 'weekly':
                return dayOfWeekIn(this.startsOn.plusDays(7 * steps), this.requireAnchor());
            case 'monthly':
                return LocalDate.clampedTo(this.startsOn.period.plusMonths(steps), this.requireAnchor());
            case 'yearly':
                return LocalDate.clampedTo(this.startsOn.period.plusMonths(12 * steps), this.requireAnchor());
        }
    }

    /**
     * Novo dia âncora, a partir da data nova de uma ocorrência ("esta e as futuras" com a data
     * trocada).
     *
     * @param date Data nova da ocorrência editada.
     * @return O calendário com o dia âncora da data, e a referência acompanhando o dia novo.
     * @throws {BusinessRuleViolation} Na série diária, que não tem dia âncora: trocar a data só
     * vale para "somente esta".
     */
    public withAnchorFrom(date: LocalDate): RecurrenceSchedule {
        if (this.frequency === 'daily') {
            throw new BusinessRuleViolation(
                'recurrence-daily-date-single-only',
                'numa série diária, trocar a data só vale para "somente esta"',
                { field: 'dueDate' },
            );
        }
        const anchorDay = anchorDayOf(this.frequency, date);
        return RecurrenceSchedule.of({ frequency: this.frequency, startsOn: moveToAnchor(this.frequency, this.startsOn, anchorDay), startsAt: this.startsAt, anchorDay });
    }

    /**
     * @return O dia âncora, que as frequências com dia sempre têm (invariante de `of`).
     * @throws {InvalidValueError} Se o invariante tiver sido quebrado.
     */
    private requireAnchor(): number {
        if (this.anchorDay === null) {
            throw new InvalidValueError('anchorDay', `frequência ${this.frequency} sem dia âncora`);
        }
        return this.anchorDay;
    }
}

/** Maior dia âncora de cada frequência; `null` onde não há dia âncora. */
const ANCHOR_LIMIT: Readonly<Record<RecurrenceFrequency, number | null>> = { daily: null, weekly: 7, monthly: 31, yearly: 31 };

/**
 * @param frequency Frequência da série.
 * @param date Data de uma ocorrência.
 * @return O dia âncora que a data define: dia da semana na semanal, dia do mês na mensal e na
 * anual, `null` na diária.
 */
export function anchorDayOf(frequency: RecurrenceFrequency, date: LocalDate): number | null {
    switch (frequency) {
        case 'daily':
            return null;
        case 'weekly':
            return date.dayOfWeek();
        case 'monthly':
        case 'yearly':
            return date.day;
    }
}

/**
 * Leva uma ocorrência existente para o dia âncora novo **sem trocar o período dela**.
 * Regra de negócio (Recorrências, database-design §4.12): trocar a data em "esta e as futuras"
 * muda o dia dentro do mês em que cada ocorrência já está (último dia do mês quando o dia não
 * existe), ou o dia da semana dentro da semana dela na semanal — nunca a desloca de mês.
 *
 * @param frequency Frequência da série.
 * @param date Data atual da ocorrência.
 * @param anchorDay Dia âncora novo.
 * @return A data nova; na diária, a mesma data (não há dia âncora).
 */
export function moveToAnchor(frequency: RecurrenceFrequency, date: LocalDate, anchorDay: number | null): LocalDate {
    if (anchorDay === null || frequency === 'daily') {
        return date;
    }
    return frequency === 'weekly' ? dayOfWeekIn(date, anchorDay) : LocalDate.clampedTo(date.period, anchorDay);
}

/**
 * @param date Qualquer dia da semana desejada.
 * @param dayOfWeek Dia ISO procurado (1 = segunda).
 * @return O dia `dayOfWeek` da semana (segunda a domingo) que contém `date`.
 */
function dayOfWeekIn(date: LocalDate, dayOfWeek: number): LocalDate {
    return date.plusDays(dayOfWeek - date.dayOfWeek());
}
