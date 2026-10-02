import { InvalidValueError } from './errors.ts';

declare const brand: unique symbol;

/**
 * Tipo marcado: uma `string` que o compilador distingue de outras `string`. Existe para
 * que passar o id de uma conta onde se espera o de uma fatura seja erro de compilação,
 * não um saldo errado descoberto meses depois (backend-design §3.9).
 *
 * A marca é um objeto com uma chave por marca, e não um literal, para que marcas se
 * acumulem: `AccountId` é `Uuid` e mais alguma coisa. Com um literal, `Brand<Uuid, 'AccountId'>`
 * intersectaria `'Uuid' & 'AccountId'` e o tipo inteiro viraria `never`.
 */
export type Brand<T, B extends string> = T & { readonly [brand]: { readonly [K in B]: true } };

export type Uuid = Brand<string, 'Uuid'>;
export type ProfileId = Brand<Uuid, 'ProfileId'>;
export type AccountId = Brand<Uuid, 'AccountId'>;
export type CreditCardId = Brand<Uuid, 'CreditCardId'>;
export type BankStatementId = Brand<Uuid, 'BankStatementId'>;
export type InvoiceId = Brand<Uuid, 'InvoiceId'>;
export type TransactionId = Brand<Uuid, 'TransactionId'>;
export type SubCategoryId = Brand<Uuid, 'SubCategoryId'>;
export type PartnerId = Brand<Uuid, 'PartnerId'>;
export type GoalId = Brand<Uuid, 'GoalId'>;
export type RecurrenceId = Brand<Uuid, 'RecurrenceId'>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Normaliza e valida um UUID na forma canônica minúscula de 36 caracteres. A caixa é
 * normalizada aqui porque o SQLite compara chaves byte a byte: um id em maiúsculas vindo
 * de uma importação apontaria para "outra" linha (database-design §3.5).
 *
 * @param raw Texto recebido da UI, do banco ou de uma importação; pode vir em qualquer caixa.
 * @param field Nome do campo, para que o erro aponte qual entrada estava malformada.
 * @return O UUID canônico, em minúsculas.
 * @throws {InvalidValueError} Quando o texto não é um UUID.
 */
export function parseUuid(raw: string, field = 'id'): Uuid {
    const normalized = raw.trim().toLowerCase();
    if (!UUID_PATTERN.test(normalized)) {
        throw new InvalidValueError(field, `não é um UUID canônico: "${raw}"`);
    }
    return normalized as Uuid;
}

/**
 * Fábrica de um conversor tipado por entidade. Existe para que cada id marcado tenha um
 * único ponto de entrada validado, em vez de `as AccountId` espalhado pelo código — um
 * cast solto é exatamente o atalho que o tipo marcado existe para impedir.
 *
 * @param field Nome usado nas mensagens de erro do conversor gerado.
 * @return Função que valida e marca um id daquela entidade.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- o genérico é o tipo marcado que cada conversor devolve; é a razão de ser da fábrica.
function idParser<T extends Uuid>(field: string): (raw: string) => T {
    return (raw: string): T => parseUuid(raw, field) as T;
}

export const ProfileId = idParser<ProfileId>('profileId');
export const AccountId = idParser<AccountId>('accountId');
export const CreditCardId = idParser<CreditCardId>('creditCardId');
export const BankStatementId = idParser<BankStatementId>('bankStatementId');
export const InvoiceId = idParser<InvoiceId>('invoiceId');
export const TransactionId = idParser<TransactionId>('transactionId');
export const SubCategoryId = idParser<SubCategoryId>('subCategoryId');
export const PartnerId = idParser<PartnerId>('partnerId');
export const GoalId = idParser<GoalId>('goalId');
export const RecurrenceId = idParser<RecurrenceId>('recurrenceId');
