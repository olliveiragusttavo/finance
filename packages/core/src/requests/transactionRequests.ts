import { z } from 'zod';
import { AccountId, CreditCardId, GoalId, PartnerId, ProfileId, SubCategoryId, TagId, TransactionId } from '../domain/shared/ids.ts';
import type { CreateTransactionCommand, TransactionInput, UpdateTransactionCommand } from '../services/transaction/TransactionCommands.ts';
import { currencyCodeField, localDateField, moneyField, parsedText, yearMonthField } from './fields.ts';

const accountSourceSchema = z.strictObject({ kind: z.literal('account'), accountId: parsedText(AccountId) });

const sourceSchema = z.discriminatedUnion('kind', [
    accountSourceSchema,
    z.strictObject({
        kind: z.literal('creditCard'),
        creditCardId: parsedText(CreditCardId),
        // Ausente ou nulo aceita a fatura sugerida pela data da compra (database-design §4.7).
        invoicePeriod: yearMonthField.nullable().default(null),
    }),
]);

const explicitSourceSchema = z.discriminatedUnion('kind', [
    accountSourceSchema,
    z.strictObject({
        kind: z.literal('creditCard'),
        creditCardId: parsedText(CreditCardId),
        // Nulo mantém a fatura atual no mesmo cartão, ou aceita a sugestão ao trocar de cartão.
        invoicePeriod: yearMonthField.nullable(),
    }),
]);

/**
 * Campos do lançamento novo. Opcionais têm o default do domínio — `charges = 0`,
 * `conversion_rate = 1` (database-design §3.9) — para que o formulário rápido do celular
 * envie só o essencial (brief M2).
 */
const contentShape = {
    type: z.enum(['income', 'expense', 'transference', 'investment']),
    source: sourceSchema,
    subCategoryId: parsedText(SubCategoryId),
    destinationAccountId: parsedText(AccountId).nullable().default(null),
    partnerId: parsedText(PartnerId).nullable().default(null),
    goalId: parsedText(GoalId).nullable().default(null),
    name: z.string().trim().min(1).max(100),
    description: z.string().nullable().default(null),
    value: moneyField,
    charges: moneyField.default(0),
    originCurrency: currencyCodeField.nullable().default(null),
    conversionRate: z.number().positive().default(1),
    dueDate: localDateField,
    // Pago e data de pagamento andam juntos (brief §3, Transação): a transação está paga
    // exatamente quando a data de pagamento vem preenchida.
    paymentDate: localDateField.nullable().default(null),
    // Tags são opcionais no lançamento rápido (brief M2, "Mais detalhes").
    tagIds: z.array(parsedText(TagId)).default([]),
};

/**
 * Campos da edição, todos obrigatórios — os anuláveis aceitam `null`, mas precisam vir
 * explícitos. A edição substitui a transação inteira, e um default aqui faria um cliente
 * que omitisse `charges` ou `description` apagar o valor gravado em silêncio, em vez de
 * receber um erro de validação.
 */
const explicitContentShape = {
    type: contentShape.type,
    source: explicitSourceSchema,
    subCategoryId: contentShape.subCategoryId,
    destinationAccountId: parsedText(AccountId).nullable(),
    partnerId: parsedText(PartnerId).nullable(),
    goalId: parsedText(GoalId).nullable(),
    name: contentShape.name,
    description: z.string().nullable(),
    value: moneyField,
    charges: moneyField,
    originCurrency: currencyCodeField.nullable(),
    conversionRate: z.number().positive(),
    dueDate: localDateField,
    paymentDate: localDateField.nullable(),
    tagIds: z.array(parsedText(TagId)),
};

/**
 * Converte o resultado do schema no comando do Service. Existe porque o Zod devolve
 * propriedades opcionais no tipo de saída dos defaults em algumas combinações, e o
 * comando precisa de todos os campos explícitos sob `exactOptionalPropertyTypes`.
 *
 * @param data Saída validada do schema.
 * @return O conteúdo da transação no formato do Service.
 */
function toInput(data: z.output<z.ZodObject<typeof contentShape>>): TransactionInput {
    return {
        type: data.type,
        source: data.source,
        subCategoryId: data.subCategoryId,
        destinationAccountId: data.destinationAccountId,
        partnerId: data.partnerId,
        goalId: data.goalId,
        name: data.name,
        description: data.description,
        value: data.value,
        charges: data.charges,
        originCurrency: data.originCurrency,
        conversionRate: data.conversionRate,
        dueDate: data.dueDate,
        paymentDate: data.paymentDate,
        tagIds: data.tagIds,
    };
}

export const createTransactionRequest = z
    .strictObject({ profileId: parsedText(ProfileId), ...contentShape })
    .transform((data): CreateTransactionCommand => ({ ...toInput(data), profileId: data.profileId }));

export const updateTransactionRequest = z
    .strictObject({ id: parsedText(TransactionId), ...explicitContentShape })
    .transform((data): UpdateTransactionCommand => ({ ...toInput(data), id: data.id }));

export const transactionIdRequest = z.strictObject({ id: parsedText(TransactionId) });

export const listTransactionsRequest = z.strictObject({ profileId: parsedText(ProfileId), period: yearMonthField });

export const setPaidRequest = z.strictObject({ id: parsedText(TransactionId), paid: z.boolean() });
