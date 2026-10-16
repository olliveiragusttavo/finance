import { z } from 'zod';
import { AccountId, ProfileId } from '../domain/shared/ids.ts';
import type { AccountInput, CreateAccountCommand, UpdateAccountCommand } from '../services/account/AccountCommands.ts';
import { currencyCodeField, moneyField, parsedText, registryNameField, yearMonthField } from './fields.ts';

export const accountTypeField = z.enum(['checking', 'investment']);

/**
 * Campos do cadastro novo. Os opcionais têm o default do schema — `consider_balance = 1`,
 * `opening_balance = 0` (database-design §4.4) — e o rótulo de moeda, quando ausente, é a
 * moeda do perfil, o caso comum.
 */
export const accountContentShape = {
    name: registryNameField,
    type: accountTypeField,
    currencyLabel: currencyCodeField.nullable().default(null),
    considerBalance: z.boolean().default(true),
    openingBalance: moneyField.default(0),
};

/**
 * Converte a saída do schema no conteúdo do Service, campo a campo, pelo mesmo motivo do
 * `toInput` das transações: sob `exactOptionalPropertyTypes` o comando precisa de todos os
 * campos explícitos.
 *
 * @param data Saída validada do schema.
 * @return O conteúdo do cadastro no formato do Service.
 */
export function toAccountInput(data: z.output<z.ZodObject<typeof accountContentShape>>): AccountInput {
    return {
        name: data.name,
        type: data.type,
        currencyLabel: data.currencyLabel,
        considerBalance: data.considerBalance,
        openingBalance: data.openingBalance,
    };
}

export const listAccountsRequest = z.strictObject({ profileId: parsedText(ProfileId), period: yearMonthField });

export const transferTargetsRequest = z.strictObject({ profileId: parsedText(ProfileId) });

export const createAccountRequest = z
    .strictObject({ profileId: parsedText(ProfileId), ...accountContentShape })
    .transform((data): CreateAccountCommand => ({ ...toAccountInput(data), profileId: data.profileId }));

/**
 * Edição completa, sem defaults: um cliente que omitisse `openingBalance` zeraria o saldo
 * inicial em silêncio e recalcularia a conta inteira.
 */
export const updateAccountRequest = z
    .strictObject({
        id: parsedText(AccountId),
        name: registryNameField,
        type: accountTypeField,
        currencyLabel: currencyCodeField.nullable(),
        considerBalance: z.boolean(),
        openingBalance: moneyField,
    })
    .transform((data): UpdateAccountCommand => ({ ...toAccountInput(data), id: data.id }));

export const accountIdRequest = z.strictObject({ id: parsedText(AccountId) });
