import { randomUUID } from 'node:crypto';
import { LocalDate, parseTimestamp, parseUuid, type Clock, type IdGenerator, type Timestamp, type Uuid } from '@finance/core';

/**
 * Relógio real do desktop (porta `Clock`, backend-design §5.7). As duas leituras são
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

/** Gerador de UUID v4 sobre o `crypto` do Node, que o `utilityProcess` tem completo. */
export class CryptoIdGenerator implements IdGenerator {
    /** @return Um UUID v4 aleatório, validado pelo mesmo parser do núcleo. */
    public random(): Uuid {
        return parseUuid(randomUUID());
    }
}
