import { z } from 'zod';
import { ACCOUNT_TYPES } from '../domain/account/Account.ts';
import { IMPORT_TRANSACTION_TYPES, type ImportRepetition, type ImportRow } from '../domain/import/ImportRow.ts';
import { RECURRENCE_FREQUENCIES } from '../domain/recurrence/RecurrenceSchedule.ts';
import { AccountId, CreditCardId, ProfileId } from '../domain/shared/ids.ts';
import type { ImportCommand } from '../services/import/ImportCommands.ts';
import { dayOfMonthField, localDateField, moneyField, parsedText, registryNameField } from './fields.ts';

/**
 * Maior arquivo aceito numa importação. O arquivo real tem 1.890 linhas; o teto só impede que um
 * arquivo errado (um log, uma planilha de outra coisa) prenda o núcleo numa transação enorme.
 */
const IMPORT_MAX_ROWS = 50_000;

/** Texto livre de uma linha; o tamanho é conferido pela análise, que aponta a linha. */
const rowText = z.string().max(10_000);

/** Repetição declarada na linha (import-design §4). */
const repetitionSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('none') }),
    z.strictObject({ kind: z.literal('fixed'), frequency: z.enum(RECURRENCE_FREQUENCIES) }),
    z.strictObject({
        kind: z.literal('installments'),
        frequency: z.enum(RECURRENCE_FREQUENCIES),
        installment: z.number().int().nullable(),
        installments: z.number().int().nullable(),
    }),
]);

/**
 * Uma linha do arquivo já lida pelo client (import-design §2). É exportada para o client
 * converter as linhas no mesmo formato de domínio que o núcleo recebe e chamar a mesma análise
 * na tela de revisão.
 */
export const importRowSchema = z
    .strictObject({
        line: z.number().int().min(1),
        type: z.enum(IMPORT_TRANSACTION_TYPES),
        name: rowText,
        value: moneyField,
        charges: moneyField.default(0),
        dueDate: localDateField,
        paymentDate: localDateField.nullable().default(null),
        purchaseDate: localDateField.nullable().default(null),
        account: rowText,
        creditCard: rowText.nullable().default(null),
        destination: rowText.nullable().default(null),
        category: rowText.nullable().default(null),
        subCategory: rowText.nullable().default(null),
        description: rowText.nullable().default(null),
        tags: z.array(rowText).max(100).default([]),
        repetition: repetitionSchema.default({ kind: 'none' }),
    })
    .transform((data): ImportRow => ({ ...data, repetition: repetitionOf(data.repetition) }));

/** Escolhas da revisão (mockup `DesktopImportRevisar`). */
export const importOptionsSchema = z.strictObject({
    groupSeries: z.boolean(),
    keepFutureOccurrences: z.boolean(),
    hashtagsAsTags: z.boolean(),
    pastDueAsPaid: z.boolean(),
});

const accountDecisionSchema = z.strictObject({
    name: rowText,
    profileId: parsedText(ProfileId),
    target: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('create'), type: z.enum(ACCOUNT_TYPES), considerBalance: z.boolean() }),
        z.strictObject({ kind: z.literal('link'), accountId: parsedText(AccountId) }),
    ]),
});

const creditCardDecisionSchema = z.strictObject({
    name: rowText,
    target: z.discriminatedUnion('kind', [
        z.strictObject({
            kind: z.literal('create'),
            payingAccount: rowText,
            closingDay: dayOfMonthField,
            dueDay: dayOfMonthField,
            limit: moneyField.min(0).default(0),
        }),
        z.strictObject({ kind: z.literal('link'), creditCardId: parsedText(CreditCardId) }),
    ]),
});

/** Importação de um arquivo, como a revisão a aprovou (rota `imports.run`). */
export const runImportRequest = z
    .strictObject({
        rows: z.array(importRowSchema).min(1).max(IMPORT_MAX_ROWS),
        options: importOptionsSchema,
        accounts: z.array(accountDecisionSchema),
        creditCards: z.array(creditCardDecisionSchema),
        transferCategory: z.strictObject({ category: registryNameField, subCategory: registryNameField }),
    })
    .transform((data): ImportCommand => data);

/**
 * @param repetition Repetição como o schema a leu.
 * @return A mesma repetição no tipo do domínio — o schema já a validou; a cópia só troca o tipo
 * inferido pelo zod pelo declarado no domínio, sem `as`.
 */
function repetitionOf(repetition: z.output<typeof repetitionSchema>): ImportRepetition {
    switch (repetition.kind) {
        case 'none':
            return { kind: 'none' };
        case 'fixed':
            return { kind: 'fixed', frequency: repetition.frequency };
        case 'installments':
            return { kind: 'installments', frequency: repetition.frequency, installment: repetition.installment, installments: repetition.installments };
    }
}
