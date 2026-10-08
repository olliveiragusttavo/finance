import type { CoreError } from '../../controllers/CoreResult.ts';

/** Uma série que o complemento não conseguiu estender. */
export interface TopUpFailureResponse {
    readonly recurrenceId: string;
    /** O erro como atravessa a fronteira; `INTERNAL` quando foi um bug, já registrado no log. */
    readonly error: CoreError;
}

/**
 * Resultado do complemento das recorrências. As falhas vêm dentro do sucesso, e não como falha
 * da rota, porque cada série é complementada à parte (backend-design §4.5): a abertura registra
 * as que falharam e segue, em vez de bloquear o app por uma série.
 */
export interface TopUpResponse {
    readonly emitted: number;
    readonly failures: readonly TopUpFailureResponse[];
}
