import { z } from 'zod';
import { REPORT_DATE_BASES, REPORT_MAX_PREVIOUS_MONTHS, REPORT_STATUS_FILTERS, REPORT_TAG_MATCHES, type ReportFilterProps } from '../domain/report/ReportFilter.ts';
import { REPORT_DIMENSIONS, REPORT_FORMATS, REPORT_MEASURES, type ReportLayoutProps } from '../domain/report/ReportLayout.ts';
import { REPORT_NAME_MAX_LENGTH } from '../domain/report/ReportDefinition.ts';
import { AccountId, CategoryId, CreditCardId, GoalId, PartnerId, ProfileId, ReportDefinitionId, SubCategoryId, TagId } from '../domain/shared/ids.ts';
import { TRANSACTION_TYPES } from '../domain/transaction/TransactionType.ts';
import type { CreateReportCommand, PreviewReportCommand, RunReportCommand, UpdateReportCommand } from '../services/report/ReportCommands.ts';
import { moneyField, parsedText, yearMonthField } from './fields.ts';

/**
 * Teto de cada lista de ids do filtro. Um perfil real não tem centenas de contas ou tags; o teto
 * existe para que uma entrada malformada não monte um `IN (...)` com milhares de parâmetros.
 */
const REPORT_LIST_MAX = 500;

/**
 * @param parse Conversor do id marcado da lista.
 * @return Lista de ids validados, vazia por padrão — lista vazia não restringe (reports-design §2.2).
 */
function idList<T>(parse: (raw: string) => T): z.ZodDefault<z.ZodArray<z.ZodType<T, string>>> {
    return z.array(parsedText(parse)).max(REPORT_LIST_MAX).default([]);
}

/** Intervalo de tempo (reports-design §2.1): mês final, meses anteriores e a data que decide o mês. */
const reportPeriodSchema = z.strictObject({
    anchor: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('reference') }),
        z.strictObject({ kind: z.literal('fixed'), month: yearMonthField }),
    ]),
    previousMonths: z.number().int().min(0).max(REPORT_MAX_PREVIOUS_MONTHS).default(0),
    basis: z.enum(REPORT_DATE_BASES).default('payment'),
});

/**
 * Filtro do relatório. É também o schema que lê o JSON gravado (reports-design §4), por isso
 * produz as props do domínio, e não um comando: o `ReportFilter.create` repete os invariantes que
 * relacionam campos (mínimo ≤ máximo) nos dois caminhos.
 */
export const reportFilterSchema = z
    .strictObject({
        period: reportPeriodSchema,
        types: z.array(z.enum(TRANSACTION_TYPES)).max(TRANSACTION_TYPES.length * 2).default([]),
        categoryIds: idList(CategoryId),
        subCategoryIds: idList(SubCategoryId),
        accountIds: idList(AccountId),
        creditCardIds: idList(CreditCardId),
        tagIds: idList(TagId),
        tagMatch: z.enum(REPORT_TAG_MATCHES).default('any'),
        partnerIds: idList(PartnerId),
        goalIds: idList(GoalId),
        status: z.enum(REPORT_STATUS_FILTERS).default('all'),
        minValue: moneyField.nullable().default(null),
        maxValue: moneyField.nullable().default(null),
    })
    .transform((data): ReportFilterProps => ({
        period: { anchor: data.period.anchor, previousMonths: data.period.previousMonths, basis: data.period.basis },
        types: data.types,
        categoryIds: data.categoryIds,
        subCategoryIds: data.subCategoryIds,
        accountIds: data.accountIds,
        creditCardIds: data.creditCardIds,
        tagIds: data.tagIds,
        tagMatch: data.tagMatch,
        partnerIds: data.partnerIds,
        goalIds: data.goalIds,
        status: data.status,
        minValue: data.minValue,
        maxValue: data.maxValue,
    }));

/** Formato do relatório (reports-design §3); também lê o JSON gravado. */
export const reportLayoutSchema = z
    .strictObject({
        format: z.enum(REPORT_FORMATS),
        primary: z.enum(REPORT_DIMENSIONS),
        secondary: z.enum(REPORT_DIMENSIONS).nullable().default(null),
        measure: z.enum(REPORT_MEASURES).default('sum'),
    })
    .transform((data): ReportLayoutProps => ({ format: data.format, primary: data.primary, secondary: data.secondary, measure: data.measure }));

/**
 * O JSON da coluna `report_definitions.definition`. A versão vem primeiro para que uma mudança
 * de formato futura (`version: 2`) seja uma conversão na leitura, sem migration de dados.
 */
export const storedReportContentSchema = z.strictObject({
    version: z.literal(1),
    filter: reportFilterSchema,
    layout: reportLayoutSchema,
});

/** Nome do relatório; repete o limite do domínio só por conforto do formulário. */
const reportNameField = z.string().trim().min(1).max(REPORT_NAME_MAX_LENGTH);

export const listReportsRequest = z.strictObject({ profileId: parsedText(ProfileId) });

export const reportIdRequest = z.strictObject({ id: parsedText(ReportDefinitionId) });

export const createReportRequest = z
    .strictObject({ profileId: parsedText(ProfileId), name: reportNameField, filter: reportFilterSchema, layout: reportLayoutSchema })
    .transform((data): CreateReportCommand => ({ profileId: data.profileId, name: data.name, filter: data.filter, layout: data.layout }));

export const updateReportRequest = z
    .strictObject({ id: parsedText(ReportDefinitionId), name: reportNameField, filter: reportFilterSchema, layout: reportLayoutSchema })
    .transform((data): UpdateReportCommand => ({ id: data.id, name: data.name, filter: data.filter, layout: data.layout }));

/** `period` é o mês de referência da tela; a definição com mês fixo o ignora (reports-design F1). */
export const runReportRequest = z
    .strictObject({ id: parsedText(ReportDefinitionId), period: yearMonthField })
    .transform((data): RunReportCommand => ({ id: data.id, period: data.period }));

export const previewReportRequest = z
    .strictObject({ profileId: parsedText(ProfileId), period: yearMonthField, filter: reportFilterSchema, layout: reportLayoutSchema })
    .transform((data): PreviewReportCommand => ({ profileId: data.profileId, period: data.period, filter: data.filter, layout: data.layout }));
