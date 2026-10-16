import { InvalidValueError } from '../domain/shared/errors.ts';
import type { Brand } from '../domain/shared/ids.ts';
import type { LocalDate } from '../domain/shared/LocalDate.ts';

/**
 * Instante UTC no formato `YYYY-MM-DD HH:MM:SS`, exatamente o do `CHECK` de timestamp do
 * schema (database-design §3.9). Marcado para que uma data de calendário não seja gravada
 * em `updated_at` por engano.
 */
export type Timestamp = Brand<string, 'Timestamp'>;

const TIMESTAMP_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]) ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

/**
 * Único ponto de entrada de um `Timestamp`. Existe para que o adaptador de relógio de cada
 * plataforma (fora do núcleo) produza o tipo marcado validando o formato, em vez de forçá-lo
 * com cast — um formato errado só seria descoberto pelo `CHECK` do schema, no meio de uma
 * unidade de trabalho.
 *
 * @param raw Instante UTC no formato `YYYY-MM-DD HH:MM:SS`.
 * @return O instante marcado.
 * @throws {InvalidValueError} Quando o texto não segue o formato do schema.
 */
export function parseTimestamp(raw: string): Timestamp {
    if (!TIMESTAMP_PATTERN.test(raw)) {
        throw new InvalidValueError('timestamp', `instante fora do formato YYYY-MM-DD HH:MM:SS: "${raw}"`);
    }
    return raw as Timestamp;
}

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
