import type { AccountType } from '../../domain/account/Account.ts';
import type { ProfileType } from '../../domain/profile/Profile.ts';
import type { InstallmentValueType, RecurrenceTerms } from '../../domain/recurrence/Recurrence.ts';
import type { RecurrenceFrequency } from '../../domain/recurrence/RecurrenceSchedule.ts';
import { CorruptRowError } from '../../domain/shared/errors.ts';
import type { TransactionType } from '../../domain/transaction/TransactionType.ts';

/** `recurrences.type` (database-design §4.12). */
export const RECURRENCE_KIND_CODE: Readonly<Record<RecurrenceTerms['kind'], number>> = {
    installments: 1,
    fixed: 2,
};

/** `recurrences.recurrence` — o intervalo entre ocorrências. */
export const RECURRENCE_FREQUENCY_CODE: Readonly<Record<RecurrenceFrequency, number>> = {
    daily: 1,
    weekly: 2,
    monthly: 3,
    yearly: 4,
};

/** `recurrences.value_type` — só nas parceladas. */
export const INSTALLMENT_VALUE_TYPE_CODE: Readonly<Record<InstallmentValueType, number>> = {
    total: 1,
    perInstallment: 2,
};

/**
 * Códigos inteiros dos enums no schema (database-design §3.9). O domínio usa literais de
 * texto e o banco usa os inteiros do diagrama; a tradução fica só aqui, na fronteira do
 * Repository, para que nenhum `type = 3` apareça em regra de negócio.
 */
export const TRANSACTION_TYPE_CODE: Readonly<Record<TransactionType, number>> = {
    income: 1,
    expense: 2,
    transference: 3,
    investment: 4,
};

export const ACCOUNT_TYPE_CODE: Readonly<Record<AccountType, number>> = {
    checking: 1,
    investment: 2,
};

export const PROFILE_TYPE_CODE: Readonly<Record<ProfileType, number>> = {
    personal: 1,
    business: 2,
};

/**
 * Converte o inteiro gravado de volta para o literal do domínio.
 *
 * @param codes Tabela de códigos do enum.
 * @param code Inteiro lido do banco.
 * @param table Tabela de origem, para o erro.
 * @return O literal do domínio correspondente.
 * @throws {CorruptRowError} Quando o código não existe — o `CHECK` do schema impede isso,
 * então só acontece com um banco mais novo ou alterado à mão.
 */
export function decodeEnum<T extends string>(codes: Readonly<Record<T, number>>, code: number, table: string): T {
    for (const [literal, value] of Object.entries(codes) as [T, number][]) {
        if (value === code) {
            return literal;
        }
    }
    throw new CorruptRowError(table, `código de enum desconhecido: ${code}`);
}
