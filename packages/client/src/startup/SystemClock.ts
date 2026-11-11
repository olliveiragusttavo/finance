import { LocalDate, parseTimestamp, type Clock, type Timestamp } from '@finance/core';

/**
 * Relógio real dos dois shells (porta `Clock`, backend-design §5.7), no `client` porque o
 * desktop e o celular precisam virar o mês no mesmo instante. As duas leituras são
 * diferentes de propósito: `now` é o instante UTC que carimba `updated_at`; `today` é a data
 * do calendário **local** do usuário, que decide o mês corrente — às 22h do dia 31 em
 * São Paulo, o UTC já está no dia 1º, mas o mês do usuário ainda não virou.
 */
export class SystemClock implements Clock {
    /**
     * @param current Fonte do instante atual; trocada nos testes para fixar o horário.
     */
    public constructor(private readonly current: () => Date = () => new Date()) {}

    /** @return O instante UTC no formato do schema, `YYYY-MM-DD HH:MM:SS`. */
    public now(): Timestamp {
        return parseTimestamp(this.current().toISOString().slice(0, 19).replace('T', ' '));
    }

    /** @return A data de hoje no fuso do sistema operacional. */
    public today(): LocalDate {
        const instant = this.current();
        return LocalDate.of(instant.getFullYear(), instant.getMonth() + 1, instant.getDate());
    }
}
