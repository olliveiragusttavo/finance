import type { z } from 'zod';
import { DomainError, type ErrorCode, type ErrorDetails } from '../domain/shared/errors.ts';

/** Erro como atravessa a fronteira UI ↔ núcleo: só dados, sem classe. */
export interface CoreError {
    readonly code: ErrorCode;
    readonly message: string;
    readonly details: ErrorDetails;
}

/**
 * Resultado de toda rota. Uma união discriminada, e não exceção, porque o IPC do Electron
 * serializa por structured clone e uma exceção chegaria ao renderer sem classe nem campos
 * próprios (desktop-shell-design §5.3).
 */
export type CoreResult<T> =
    | { readonly ok: true; readonly data: T }
    | { readonly ok: false; readonly error: CoreError };

/**
 * Recebe falhas inesperadas (bugs) para log. É injetado porque o núcleo não sabe onde a
 * plataforma registra logs.
 */
export type UnexpectedErrorListener = (error: unknown) => void;

/**
 * Executa uma rota: valida a entrada com o schema da camada Request, chama o caso de uso e
 * converte o resultado em `CoreResult`. É o único lugar que traduz exceção em resultado,
 * para que todos os Controllers falhem do mesmo jeito.
 *
 * @param schema Schema da camada Request; produz o comando tipado do Service.
 * @param raw Entrada não confiável, como chegou do transporte.
 * @param action Caso de uso a executar com a entrada validada; devolve o DTO de saída.
 * @param onUnexpected Destino do log de falhas inesperadas.
 * @return A promessa do resultado; a assincronia existe só na fronteira de transporte
 * (backend-design §3.5).
 */
export function handle<S extends z.ZodType, T>(
    schema: S,
    raw: unknown,
    action: (input: z.output<S>) => T,
    onUnexpected: UnexpectedErrorListener,
): Promise<CoreResult<T>> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return Promise.resolve(failure({
            code: 'VALIDATION_FAILED',
            message: 'Entrada inválida',
            details: {
                field: issue?.path.map(String).join('.') ?? '',
                reason: issue?.message ?? '',
                issues: parsed.error.issues.length,
            },
        }));
    }
    try {
        return Promise.resolve({ ok: true, data: action(parsed.data) });
    } catch (error) {
        return Promise.resolve(failure(toCoreError(error, onUnexpected)));
    }
}

/**
 * Tradução única de exceção em erro de fronteira, exportada para as rotas que devolvem falhas
 * parciais dentro de um resultado de sucesso (o complemento, série a série) — para que elas
 * falhem do mesmo jeito que uma rota inteira.
 *
 * @param error O que o caso de uso lançou.
 * @param onUnexpected Destino do log, que recebe o erro quando ele não é de domínio (um bug).
 * @return O erro de domínio como dados, ou `INTERNAL` sem detalhes para qualquer outro.
 */
export function toCoreError(error: unknown, onUnexpected: UnexpectedErrorListener): CoreError {
    if (error instanceof DomainError) {
        return { code: error.code, message: error.message, details: error.details };
    }
    onUnexpected(error);
    return { code: 'INTERNAL', message: 'Erro inesperado', details: {} };
}

/**
 * @param error Erro a devolver.
 * @return O resultado de falha.
 */
function failure<T>(error: CoreError): CoreResult<T> {
    return { ok: false, error };
}
