import type { Clock, IdGenerator, Timestamp } from '../../src/index.ts';
import { LocalDate } from '../../src/index.ts';
import { parseUuid, type Uuid } from '../../src/domain/shared/ids.ts';

/**
 * Relógio de teste controlado pelo próprio teste. Não é mock: é um adaptador de verdade da
 * porta `Clock`, cujo "hoje" o teste fixa e move, porque saldo do mês corrente, fatura em
 * aberto e virada de mês dependem de "hoje" (backend-design §5.7).
 */
export class FixedClock implements Clock {
    private current: LocalDate;

    /**
     * @param today Data inicial de "hoje", `YYYY-MM-DD`.
     */
    public constructor(today: string) {
        this.current = LocalDate.parse(today);
    }

    /**
     * @return Meio-dia UTC de "hoje"; o horário não importa para as regras, só o formato.
     */
    public now(): Timestamp {
        return `${this.current.toString()} 12:00:00` as Timestamp;
    }

    /**
     * @return O "hoje" fixado pelo teste.
     */
    public today(): LocalDate {
        return this.current;
    }

    /**
     * @param today Nova data de "hoje"; simula a passagem do tempo (virada do mês).
     * @return void
     */
    public set(today: string): void {
        this.current = LocalDate.parse(today);
    }
}

/**
 * Gerador de UUID v4 sequencial: ids previsíveis tornam falhas reproduzíveis e mensagens
 * de erro legíveis, sem mudar o formato que o schema exige.
 */
export class SequentialIds implements IdGenerator {
    private counter = 0;

    /**
     * @return O próximo id, com versão 4 e variante RFC para passar em qualquer validação.
     */
    public random(): Uuid {
        this.counter++;
        return parseUuid(`00000000-0000-4000-8000-${this.counter.toString(16).padStart(12, '0')}`);
    }
}
