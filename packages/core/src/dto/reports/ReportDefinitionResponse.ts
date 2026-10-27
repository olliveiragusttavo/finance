import type { ReportDefinition } from '../../domain/report/ReportDefinition.ts';
import type { ReportDateBasis, ReportFilter, ReportStatusFilter, ReportTagMatch } from '../../domain/report/ReportFilter.ts';
import type { ReportDimension, ReportFormat, ReportLayout, ReportMeasure } from '../../domain/report/ReportLayout.ts';
import type { TransactionType } from '../../domain/transaction/TransactionType.ts';

/** Intervalo de tempo serializável; o mesmo formato da entrada da rota. */
export interface ReportPeriodResponse {
    readonly anchor: { readonly kind: 'reference' } | { readonly kind: 'fixed'; readonly month: string };
    readonly previousMonths: number;
    readonly basis: ReportDateBasis;
}

/**
 * Filtro serializável. Tem exatamente a forma da entrada de `reports.create`, para que o editor
 * abra uma definição salva e a regrave sem converter nada.
 */
export interface ReportFilterResponse {
    readonly period: ReportPeriodResponse;
    readonly types: readonly TransactionType[];
    readonly categoryIds: readonly string[];
    readonly subCategoryIds: readonly string[];
    readonly accountIds: readonly string[];
    readonly creditCardIds: readonly string[];
    readonly tagIds: readonly string[];
    readonly tagMatch: ReportTagMatch;
    readonly partnerIds: readonly string[];
    readonly goalIds: readonly string[];
    readonly status: ReportStatusFilter;
    readonly minValue: number | null;
    readonly maxValue: number | null;
}

/** Formato serializável; a mesma forma da entrada. */
export interface ReportLayoutResponse {
    readonly format: ReportFormat;
    readonly primary: ReportDimension;
    readonly secondary: ReportDimension | null;
    readonly measure: ReportMeasure;
    readonly analysis: boolean;
}

/** Definição de relatório serializável. */
export interface ReportDefinitionResponse {
    readonly id: string;
    readonly profileId: string;
    readonly name: string;
    readonly filter: ReportFilterResponse;
    readonly layout: ReportLayoutResponse;
}

/**
 * Também é o formato gravado no JSON da definição (reports-design §4): o que vai para o banco é o
 * que volta pela rota, e os dois são lidos pelo mesmo schema da Request.
 *
 * @param filter Filtro do domínio.
 * @return O filtro serializável, com os ids e o mês fixo como texto.
 */
export function toReportFilterResponse(filter: ReportFilter): ReportFilterResponse {
    const { anchor } = filter.period;
    return {
        period: {
            anchor: anchor.kind === 'fixed' ? { kind: 'fixed', month: anchor.month.toString() } : { kind: 'reference' },
            previousMonths: filter.period.previousMonths,
            basis: filter.period.basis,
        },
        types: filter.types,
        categoryIds: filter.categoryIds,
        subCategoryIds: filter.subCategoryIds,
        accountIds: filter.accountIds,
        creditCardIds: filter.creditCardIds,
        tagIds: filter.tagIds,
        tagMatch: filter.tagMatch,
        partnerIds: filter.partnerIds,
        goalIds: filter.goalIds,
        status: filter.status,
        minValue: filter.minValue,
        maxValue: filter.maxValue,
    };
}

/**
 * @param layout Formato do domínio.
 * @return O formato serializável.
 */
export function toReportLayoutResponse(layout: ReportLayout): ReportLayoutResponse {
    return { format: layout.format, primary: layout.primary, secondary: layout.secondary, measure: layout.measure, analysis: layout.analysis };
}

/**
 * @param definition Definição do domínio.
 * @return A definição serializável.
 */
export function toReportDefinitionResponse(definition: ReportDefinition): ReportDefinitionResponse {
    return {
        id: definition.id,
        profileId: definition.profileId,
        name: definition.name,
        filter: toReportFilterResponse(definition.filter),
        layout: toReportLayoutResponse(definition.layout),
    };
}
