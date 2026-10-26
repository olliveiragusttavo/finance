import { CoreCallError, describeError } from '@finance/client';
import type { CoreError } from '@finance/core';

/** Onde a tela mostra uma recusa do núcleo: abaixo de um campo, ou no aviso geral do diálogo. */
export type CoreErrorPlacement<F extends string> =
    | { readonly field: F; readonly message: string }
    | { readonly field: null; readonly message: string };

/**
 * Decide onde mostrar a recusa do núcleo num formulário. Regra de interface (desktop-mvp-plan
 * Fase 1.5 e 6): quando o núcleo aponta o campo (`CONFLICT` de nome, moeda travada, conta
 * pagadora desativada), a mensagem vai para baixo dele, como um erro de validação, em vez de
 * um aviso genérico longe do que o usuário precisa corrigir.
 *
 * @param error Erro como atravessou a fronteira.
 * @param fieldByCoreField Campo do formulário de cada campo que o núcleo pode apontar; o nome
 * do núcleo (`accountId`) e o da tela podem diferir.
 * @return A mensagem em pt-BR e o campo, ou `null` quando o erro não é de um campo do formulário.
 */
export function placeCoreError<F extends string>(error: CoreError, fieldByCoreField: Readonly<Partial<Record<string, F>>>): CoreErrorPlacement<F> {
    const { message, field } = describeError(error);
    const target = field === null ? undefined : fieldByCoreField[field];
    return target === undefined ? { field: null, message } : { field: target, message };
}

/**
 * Mostra a recusa de uma gravação no lugar certo do formulário. Erro que não é do núcleo
 * (falha de transporte, bug) é relançado: escondê-lo num aviso de formulário apagaria o rastro
 * que o `FailFastCoreClient` e o log precisam.
 *
 * @param error O que a mutação rejeitou.
 * @param fieldByCoreField Campo do formulário de cada campo que o núcleo pode apontar.
 * @param onField Mostra a mensagem abaixo de um campo.
 * @param onGeneral Mostra a mensagem no aviso geral do diálogo.
 * @throws {unknown} O próprio erro, quando ele não é uma recusa do núcleo.
 */
export function reportRejection<F extends string>(
    error: unknown,
    fieldByCoreField: Readonly<Partial<Record<string, F>>>,
    onField: (field: F, message: string) => void,
    onGeneral: (message: string) => void,
): void {
    if (!(error instanceof CoreCallError)) {
        throw error;
    }
    const placement = placeCoreError(error.error, fieldByCoreField);
    if (placement.field === null) {
        onGeneral(placement.message);
    } else {
        onField(placement.field, placement.message);
    }
}
