import type { RecurrenceFrequency } from '../recurrence/RecurrenceSchedule.ts';
import type { LocalDate } from '../shared/LocalDate.ts';

/**
 * Tipos que um arquivo importado traz (import-design §1). Investimento fica de fora: nenhum
 * export conhecido o distingue de uma transferência, e adivinhar mudaria quem alimenta uma meta.
 */
export type ImportTransactionType = 'income' | 'expense' | 'transference';

export const IMPORT_TRANSACTION_TYPES: readonly ImportTransactionType[] = ['income', 'expense', 'transference'];

/**
 * Repetição que a linha declara no arquivo. A parcela e o total ficam anuláveis porque o arquivo
 * pode não ter as colunas, ou trazer "0" numa linha que não é parcela — a análise decide se a
 * linha entra numa série (import-design §5.5).
 */
export type ImportRepetition =
    | { readonly kind: 'none' }
    | { readonly kind: 'fixed'; readonly frequency: RecurrenceFrequency }
    | { readonly kind: 'installments'; readonly frequency: RecurrenceFrequency; readonly installment: number | null; readonly installments: number | null };

/**
 * Uma linha do arquivo já lida pelo client: datas e números interpretados, textos aparados. Não
 * carrega nada do formato (separador, coluna, codificação) — o núcleo só vê o conteúdo, e as
 * contas, cartões e categorias ainda são **nomes do arquivo**, resolvidos na revisão.
 */
export interface ImportRow {
    /** Linha no arquivo (a 1ª de dados é 1), para a tela apontar o problema. */
    readonly line: number;
    readonly type: ImportTransactionType;
    readonly name: string;
    /** Positivo; o negativo é estorno ou devolução, como no lançamento manual. */
    readonly value: number;
    readonly charges: number;
    /** Vencimento; numa compra no cartão, o vencimento da fatura (import-design §5.4). */
    readonly dueDate: LocalDate;
    /** Data de pagamento; `null` = em aberto. */
    readonly paymentDate: LocalDate | null;
    /** Data da compra; só decide a data da compra no cartão. */
    readonly purchaseDate: LocalDate | null;
    /** Conta de origem; numa compra no cartão, a conta que paga a fatura. */
    readonly account: string;
    /** Cartão da compra; só em despesa, `null` fora do cartão. */
    readonly creditCard: string | null;
    /** Conta de destino; só em transferência. */
    readonly destination: string | null;
    readonly category: string | null;
    readonly subCategory: string | null;
    /** Observação, que entra inteira na descrição. */
    readonly description: string | null;
    /** Tags da coluna própria, já separadas. */
    readonly tags: readonly string[];
    readonly repetition: ImportRepetition;
}

/** Escolhas da revisão que mudam o que a análise produz (mockup `DesktopImportRevisar`). */
export interface ImportOptions {
    /** Agrupa as linhas da mesma série numa recorrência; desligado, toda linha é avulsa. */
    readonly groupSeries: boolean;
    /** Mantém as ocorrências das fixas depois do horizonte; desligado, o app as gera. */
    readonly keepFutureOccurrences: boolean;
    /** Transforma as `#palavras` da observação em tags. */
    readonly hashtagsAsTags: boolean;
    /** Sem coluna de pagamento: paga no vencimento cada linha que vence até hoje. */
    readonly pastDueAsPaid: boolean;
}
