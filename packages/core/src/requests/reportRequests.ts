import { z } from 'zod';
import type { CategoryScope } from '../domain/report/CategoryScope.ts';
import { COMPARISON_MODES, type ComparisonMode } from '../domain/report/Comparison.ts';
import { CategoryId, ProfileId, SubCategoryId } from '../domain/shared/ids.ts';
import { parsedText, yearMonthField } from './fields.ts';

/** Meses da evolução do saldo quando a tela não pede: os 6 do mockup da Visão geral. */
const DEFAULT_EVOLUTION_MONTHS = 6;

/** Teto da série: dois anos cobrem qualquer gráfico da tela sem abrir uma consulta sem limite. */
const MAX_EVOLUTION_MONTHS = 24;

/**
 * Modo de comparação. Validado contra a lista do domínio para que a Request não tenha uma
 * cópia própria dos modos.
 */
const comparisonModeField = z.string().refine(
    (raw): raw is ComparisonMode => COMPARISON_MODES.some((mode) => mode === raw),
    { message: `modo de comparação: ${COMPARISON_MODES.join(', ')}` },
);

export const monthSummaryRequest = z.strictObject({ profileId: parsedText(ProfileId), period: yearMonthField });

export const balanceEvolutionRequest = z.strictObject({
    profileId: parsedText(ProfileId),
    period: yearMonthField,
    months: z.number().int().min(1).max(MAX_EVOLUTION_MONTHS).default(DEFAULT_EVOLUTION_MONTHS),
});

export const categoryReportRequest = z.strictObject({
    profileId: parsedText(ProfileId),
    period: yearMonthField,
    comparison: comparisonModeField.default('previousMonth'),
});

/**
 * Exatamente um dos dois ids: a união do domínio (`CategoryScope`) não admite os dois nem
 * nenhum, e a Request recusa antes de chegar ao Service.
 */
export const categoryTransactionsRequest = z
    .strictObject({
        profileId: parsedText(ProfileId),
        period: yearMonthField,
        categoryId: parsedText(CategoryId).optional(),
        subCategoryId: parsedText(SubCategoryId).optional(),
    })
    .transform((data, context) => {
        const scope: CategoryScope | null = data.subCategoryId !== undefined && data.categoryId === undefined
            ? { kind: 'subCategory', subCategoryId: data.subCategoryId }
            : data.categoryId !== undefined && data.subCategoryId === undefined
                ? { kind: 'category', categoryId: data.categoryId }
                : null;
        if (scope === null) {
            context.addIssue({ code: 'custom', path: ['categoryId'], message: 'informe a categoria ou a subcategoria, não as duas' });
            return z.NEVER;
        }
        return { profileId: data.profileId, period: data.period, scope };
    });

export const cardImpactRequest = z.strictObject({ profileId: parsedText(ProfileId), period: yearMonthField });
