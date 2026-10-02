import type { Brand } from '../domain/shared/ids.ts';
import type { LocalDate } from '../domain/shared/LocalDate.ts';

/**
 * Instante UTC no formato `YYYY-MM-DD HH:MM:SS`, exatamente o do `CHECK` de timestamp do
 * schema (database-design §3.9). Marcado para que uma data de calendário não seja gravada
 * em `updated_at` por engano.
 */
export type Timestamp = Brand<string, 'Timestamp'>;

/**
 * Porta do relógio. Nada no núcleo lê o relógio do sistema (backend-design §5.7): os
 * testes precisam congelar e mover o tempo, e "hoje" é a data **local** do usuário,
 * enquanto `updated_at` é UTC — duas leituras que só a plataforma sabe fazer certo.
 */
export interface Clock {
    /**
     * @return O instante atual em UTC; usado para carimbar `updated_at` e `deleted_at`.
     */
    now(): Timestamp;

    /**
     * @return A data de hoje no fuso do usuário; decide qual é o "mês corrente" cujo
     * fechamento vira o saldo exibido da conta.
     */
    today(): LocalDate;
}
