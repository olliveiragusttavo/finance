import type { AccountId, CreditCardId, GoalId, PartnerId, ProfileId, SubCategoryId, TagId, TransactionId } from '../../domain/shared/ids.ts';
import type { LocalDate } from '../../domain/shared/LocalDate.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';
import type { InstallmentValueType } from '../../domain/recurrence/Recurrence.ts';
import type { RecurrenceFrequency } from '../../domain/recurrence/RecurrenceSchedule.ts';
import type { TransactionType } from '../../domain/transaction/TransactionType.ts';

/**
 * De onde sai o dinheiro: uma conta (cai no extrato do mês do vencimento) ou um cartão
 * (cai numa fatura). Para cartão, `invoicePeriod` é a fatura escolhida pelo usuário;
 * `null` aceita a sugestão — ou, numa edição no mesmo cartão, mantém a fatura atual.
 */
export type TransactionSource =
    | { readonly kind: 'account'; readonly accountId: AccountId }
    | { readonly kind: 'creditCard'; readonly creditCardId: CreditCardId; readonly invoicePeriod: YearMonth | null };

/**
 * Conteúdo de uma transação como o Service recebe: já validado e tipado pela camada
 * Request, mas com dinheiro ainda em `number`, porque só o Service conhece a moeda do perfil
 * que o transforma em `Money`.
 */
export interface TransactionInput {
    readonly type: TransactionType;
    readonly source: TransactionSource;
    readonly subCategoryId: SubCategoryId;
    readonly destinationAccountId: AccountId | null;
    readonly partnerId: PartnerId | null;
    readonly goalId: GoalId | null;
    readonly name: string;
    readonly description: string | null;
    readonly value: number;
    readonly charges: number;
    /** Moeda de origem (proveniência); `null` quando é a própria moeda do perfil. */
    readonly originCurrency: string | null;
    readonly conversionRate: number;
    readonly dueDate: LocalDate;
    readonly paymentDate: LocalDate | null;
    /** Tags do lançamento; a edição substitui o conjunto inteiro. */
    readonly tagIds: readonly TagId[];
}

/**
 * Repetição pedida no formulário (mockup `MobileParcelar`; database-design §4.12): parcelar
 * num número fixo de partes, ou repetir sem fim inerente até uma data ou para sempre.
 */
export type RepeatInput =
    | { readonly kind: 'installments'; readonly frequency: RecurrenceFrequency; readonly installments: number; readonly valueType: InstallmentValueType }
    | { readonly kind: 'fixed'; readonly frequency: RecurrenceFrequency; readonly endAt: LocalDate | null };

/**
 * A quais ocorrências de uma série a edição ou a exclusão se aplica (database-design §4.12).
 * Num lançamento avulso só existe `single`.
 */
export type EditScope = 'single' | 'future' | 'all';

/** Lançamento novo num perfil. */
export interface CreateTransactionCommand extends TransactionInput {
    readonly profileId: ProfileId;
    /** Repetição; `null` lança uma transação avulsa. */
    readonly repeat: RepeatInput | null;
}

/** Edição completa de uma transação existente ("somente esta", para ocorrências de recorrência). */
export interface UpdateTransactionCommand extends TransactionInput {
    readonly id: TransactionId;
    readonly scope: EditScope;
    /**
     * Série como deve ficar (frequência, parcelas, fim); `null` ou igual à atual não muda a
     * série. Diferente, regenera as ocorrências futuras.
     */
    readonly repeat: RepeatInput | null;
}
