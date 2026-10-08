import type { InstallmentValueType, Recurrence } from '../../domain/recurrence/Recurrence.ts';
import type { RecurrenceFrequency } from '../../domain/recurrence/RecurrenceSchedule.ts';
import type { TransactionType } from '../../domain/transaction/TransactionType.ts';
import type { OccurrencePreview } from '../../services/recurrence/RecurrenceService.ts';
import { toMoneyResponse, type MoneyResponse } from '../shared/MoneyResponse.ts';

/**
 * Uma série (database-design §4.12). A tela usa para a coluna "Rec." ("3/12", "Fixa"), o
 * subtítulo do painel ("parcela 3 de 12 (valor total …)") e para preencher "Repetir" na edição.
 */
export interface RecurrenceResponse {
    readonly id: string;
    readonly profileId: string;
    readonly kind: 'installments' | 'fixed';
    readonly frequency: RecurrenceFrequency;
    /** Quantidade de parcelas; `null` na fixa. */
    readonly installments: number | null;
    /** Como o valor do modelo se lê; `null` na fixa. */
    readonly valueType: InstallmentValueType | null;
    /** Última data em que a fixa emite; `null` sem fim ou na parcelada. */
    readonly endAt: string | null;
    readonly type: TransactionType;
    readonly name: string;
    /** Valor do modelo: o total no "valor total", senão o de cada ocorrência. */
    readonly value: MoneyResponse;
    /** Soma das parcelas de uma parcelada (o "valor total" do mockup); `null` na fixa, que não tem fim certo. */
    readonly total: MoneyResponse | null;
}

/**
 * @param recurrence Regra do domínio.
 * @return A série serializável, com o total das parcelas calculado pela mesma regra que as gera.
 */
export function toRecurrenceResponse(recurrence: Recurrence): RecurrenceResponse {
    const { terms, template } = recurrence;
    return {
        id: recurrence.id,
        profileId: recurrence.profileId,
        kind: terms.kind,
        frequency: recurrence.schedule.frequency,
        installments: terms.kind === 'installments' ? terms.installments : null,
        valueType: terms.kind === 'installments' ? terms.valueType : null,
        endAt: terms.kind === 'fixed' ? (terms.endAt?.toString() ?? null) : null,
        type: template.type,
        name: template.name,
        value: toMoneyResponse(template.value),
        total: terms.kind === 'installments' ? toMoneyResponse(terms.valueType === 'total' ? template.value : template.value.times(terms.installments)) : null,
    };
}

/** Uma ocorrência da prévia, sem gravar nada. */
export interface OccurrencePreviewResponse {
    readonly occurrence: number;
    readonly dueDate: string;
    readonly value: MoneyResponse;
    /** Fatura em que a compra cai; `null` numa conta. */
    readonly invoicePeriod: string | null;
}

/**
 * @param preview Ocorrência prevista pelo Service.
 * @return A ocorrência serializável.
 */
export function toOccurrencePreviewResponse(preview: OccurrencePreview): OccurrencePreviewResponse {
    return {
        occurrence: preview.occurrence,
        dueDate: preview.dueDate.toString(),
        value: toMoneyResponse(preview.value),
        invoicePeriod: preview.invoicePeriod?.toString() ?? null,
    };
}
