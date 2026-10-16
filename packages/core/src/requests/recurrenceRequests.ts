import { z } from 'zod';
import { ProfileId, RecurrenceId } from '../domain/shared/ids.ts';
import { localDateField, moneyField, parsedText } from './fields.ts';
import { createTransactionRequest, deleteTransactionRequest, repeatSchema, sourceSchema, updateTransactionRequest } from './transactionRequests.ts';

export const listRecurrencesRequest = z.strictObject({ profileId: parsedText(ProfileId) });

export const recurrenceIdRequest = z.strictObject({ recurrenceId: parsedText(RecurrenceId) });

/** Prévia das parcelas: só o que decide datas, valores e faturas — o resto do formulário pode estar vazio. */
export const previewRecurrenceRequest = z.strictObject({
    profileId: parsedText(ProfileId),
    source: sourceSchema,
    dueDate: localDateField,
    value: moneyField,
    repeat: repeatSchema,
});

/**
 * Plano da criação, da edição e da exclusão para o diálogo de revisão: a entrada é exatamente a
 * da escrita que o diálogo confirma, para que o plano ensaie a mesma operação.
 */
export const planCreateRequest = createTransactionRequest;
export const planUpdateRequest = updateTransactionRequest;
export const planDeleteRequest = deleteTransactionRequest;

/** O complemento não tem entrada: percorre todas as séries vivas. */
export const topUpRecurrencesRequest = z.strictObject({});
