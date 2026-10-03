import { z } from 'zod';
import { AccountId, CreditCardId, ProfileId } from '../domain/shared/ids.ts';
import type { CreateCreditCardCommand, CreditCardInput, UpdateCreditCardCommand } from '../services/creditCard/CreditCardCommands.ts';
import { dayOfMonthField, moneyField, parsedText, registryNameField, yearMonthField } from './fields.ts';

/** Campos do cadastro do cartão; todos obrigatórios, no cadastro e na edição. */
const creditCardContentShape = {
    accountId: parsedText(AccountId),
    name: registryNameField,
    limit: moneyField.min(0),
    closingDay: dayOfMonthField,
    dueDay: dayOfMonthField,
};

/**
 * @param data Saída validada do schema.
 * @return O conteúdo do cadastro no formato do Service, campo a campo.
 */
function toCreditCardInput(data: z.output<z.ZodObject<typeof creditCardContentShape>>): CreditCardInput {
    return { accountId: data.accountId, name: data.name, limit: data.limit, closingDay: data.closingDay, dueDay: data.dueDay };
}

export const listCreditCardsRequest = z.strictObject({ profileId: parsedText(ProfileId), period: yearMonthField });

export const createCreditCardRequest = z
    .strictObject({ profileId: parsedText(ProfileId), ...creditCardContentShape })
    .transform((data): CreateCreditCardCommand => ({ ...toCreditCardInput(data), profileId: data.profileId }));

export const updateCreditCardRequest = z
    .strictObject({ id: parsedText(CreditCardId), ...creditCardContentShape })
    .transform((data): UpdateCreditCardCommand => ({ ...toCreditCardInput(data), id: data.id }));

export const creditCardIdRequest = z.strictObject({ id: parsedText(CreditCardId) });
