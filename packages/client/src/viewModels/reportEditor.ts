import {
    REPORT_MAX_PREVIOUS_MONTHS,
    REPORT_NAME_MAX_LENGTH,
    YearMonth,
    type CategoryBranchResponse,
    type CoreInput,
    type ProfileResponse,
    type ReportDateBasis,
    type ReportDefinitionResponse,
    type ReportDimension,
    type ReportFilterResponse,
    type ReportLayoutResponse,
    type ReportFormat,
    type ReportMeasure,
    type ReportStatusFilter,
    type ReportTagMatch,
    type TransactionType,
} from '@finance/core';
import { formatMoney, formatMoneyForInput } from '../format/money.ts';
import { formatMonthShort } from '../format/dates.ts';
import { parseMoneyInput } from '../format/parseMoneyInput.ts';
import { formatTransactionType, TRANSACTION_TYPE_ORDER } from './transactionEditor.ts';

/*
 * Editor dos relatórios personalizados (reports-design §2 e §3): o rascunho do formulário, os
 * rótulos de cada opção e a leitura do rascunho na entrada das rotas. Fica no `client` porque o
 * celular vai montar o mesmo relatório com as mesmas palavras e a mesma validação.
 */

/** Rótulo de cada dimensão, no seletor e no cabeçalho da tabela. */
export const REPORT_DIMENSION_LABELS: Readonly<Record<ReportDimension, string>> = {
    month: 'Mês',
    type: 'Tipo',
    category: 'Categoria',
    subCategory: 'Subcategoria',
    source: 'Conta ou cartão',
    tag: 'Tag',
    partner: 'Sócio',
    status: 'Situação',
};

/** Rótulo de cada formato. */
export const REPORT_FORMAT_LABELS: Readonly<Record<ReportFormat, string>> = {
    table: 'Tabela',
    bar: 'Gráfico de barras',
    line: 'Gráfico de linha',
};

/** Rótulo de cada medida. */
export const REPORT_MEASURE_LABELS: Readonly<Record<ReportMeasure, string>> = {
    sum: 'Soma dos valores',
    count: 'Quantidade de lançamentos',
};

/** Rótulo de cada base de data (reports-design F3). */
export const REPORT_BASIS_LABELS: Readonly<Record<ReportDateBasis, string>> = {
    payment: 'Data de pagamento',
    due: 'Data de vencimento',
    created: 'Data de lançamento',
};

/** Rótulo de cada situação do filtro (reports-design A7). */
export const REPORT_STATUS_LABELS: Readonly<Record<ReportStatusFilter, string>> = {
    all: 'Pagos e em aberto',
    paid: 'Só pagos',
    open: 'Só em aberto',
};

/** Rótulo de cada combinação de tags (reports-design A4). */
export const REPORT_TAG_MATCH_LABELS: Readonly<Record<ReportTagMatch, string>> = {
    any: 'Qualquer uma',
    all: 'Todas',
};

/** Ordem das dimensões nos seletores: o tempo primeiro, depois a classificação e a origem. */
const DIMENSION_ORDER: readonly ReportDimension[] = ['month', 'category', 'subCategory', 'type', 'source', 'tag', 'partner', 'status'];

/**
 * Regra de negócio (Perfis): sócio só existe em perfil empresarial (database-design §4.2), então
 * agrupar por sócio só é oferecido nele.
 *
 * @param profileType Tipo do perfil ativo.
 * @return As dimensões oferecidas no seletor, na ordem dele.
 */
export function reportDimensionsFor(profileType: ProfileResponse['type']): readonly ReportDimension[] {
    return DIMENSION_ORDER.filter((dimension) => dimension !== 'partner' || profileType === 'business');
}

/** Valor da dimensão secundária no seletor quando não há segunda divisão. */
export const NO_SECONDARY = 'none';

/**
 * O formulário do editor como o usuário o preenche: os números e os valores ficam em texto até
 * a leitura, para que um campo pela metade ("1.2") não seja corrigido enquanto se digita.
 */
export interface ReportDraft {
    readonly name: string;
    /** `reference` acompanha o mês da barra superior; `fixed` usa `fixedMonth`. */
    readonly anchor: 'reference' | 'fixed';
    /** Mês final fixo, `YYYY-MM` (o valor de um `<input type="month">`). */
    readonly fixedMonth: string;
    /** Meses anteriores ao final, como digitado. */
    readonly previousMonths: string;
    readonly basis: ReportDateBasis;
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
    /** Valores-limite em texto pt-BR; vazio sem limite. */
    readonly minValue: string;
    readonly maxValue: string;
    readonly format: ReportFormat;
    readonly primary: ReportDimension;
    readonly secondary: ReportDimension | typeof NO_SECONDARY;
    readonly measure: ReportMeasure;
}

/** Campos do rascunho que podem ter erro. */
export type ReportDraftField = 'name' | 'fixedMonth' | 'previousMonths' | 'minValue' | 'maxValue' | 'secondary';

/**
 * O filtro como a entrada das rotas o recebe: a forma da resposta, com as listas mutáveis que o
 * tipo de entrada do zod pede, e com todos os campos — o editor nunca depende dos padrões da rota.
 */
export type ReportFilterInput = { -readonly [K in keyof ReportFilterResponse]: ReportFilterResponse[K] extends readonly (infer U)[] ? U[] : ReportFilterResponse[K] };

/** O filtro e o formato lidos, na forma da entrada das rotas. */
export interface ReportQueryInput {
    readonly filter: ReportFilterInput;
    readonly layout: ReportLayoutResponse;
}

/**
 * O rascunho lido. O filtro e o formato valem sozinhos, sem o nome, porque o editor mostra o
 * resultado ao vivo antes de o relatório ter nome.
 */
export interface ReportDraftReading {
    /** Filtro e formato válidos; `null` enquanto algum campo deles tem erro. */
    readonly query: ReportQueryInput | null;
    /** Nome aparado e válido; `null` quando vazio ou longo demais. */
    readonly name: string | null;
    readonly errors: Partial<Record<ReportDraftField, string>>;
}

/**
 * @param reference Mês de referência da tela, o padrão do mês fixo.
 * @return O rascunho de um relatório novo: tabela das despesas do mês de referência por
 * categoria, pela data de pagamento — o relatório que mais se pede e um ponto de partida que já
 * mostra números.
 */
export function emptyReportDraft(reference: string): ReportDraft {
    return {
        name: '',
        anchor: 'reference',
        fixedMonth: reference,
        previousMonths: '0',
        basis: 'payment',
        types: ['expense'],
        categoryIds: [],
        subCategoryIds: [],
        accountIds: [],
        creditCardIds: [],
        tagIds: [],
        tagMatch: 'any',
        partnerIds: [],
        goalIds: [],
        status: 'all',
        minValue: '',
        maxValue: '',
        format: 'table',
        primary: 'category',
        secondary: NO_SECONDARY,
        measure: 'sum',
    };
}

/**
 * @param definition Definição salva, como o núcleo a devolve.
 * @param reference Mês de referência, o mês fixo sugerido quando a definição acompanha a barra.
 * @param currency Moeda do perfil, para escrever os valores-limite como o campo os mostra.
 * @return O rascunho que reabre a definição no editor.
 */
export function draftFromDefinition(definition: ReportDefinitionResponse, reference: string, currency: string): ReportDraft {
    const { filter, layout } = definition;
    const limit = (amount: number | null): string => (amount === null ? '' : formatMoneyForInput({ amount, currency }));
    return {
        name: definition.name,
        anchor: filter.period.anchor.kind,
        fixedMonth: filter.period.anchor.kind === 'fixed' ? filter.period.anchor.month : reference,
        previousMonths: String(filter.period.previousMonths),
        basis: filter.period.basis,
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
        minValue: limit(filter.minValue),
        maxValue: limit(filter.maxValue),
        format: layout.format,
        primary: layout.primary,
        secondary: layout.secondary ?? NO_SECONDARY,
        measure: layout.measure,
    };
}

/**
 * Lê o rascunho pelas mesmas regras do núcleo, para que o formulário aponte o campo antes de a
 * rota recusar.
 * Regra de negócio (Relatórios, F2 e L5): de 0 a 35 meses anteriores; a segunda divisão não
 * repete a primeira; o mínimo não passa do máximo.
 *
 * @param draft Formulário do editor.
 * @param currency Moeda do perfil, para ler os valores-limite.
 * @return O filtro e o formato quando válidos, o nome quando válido e o erro de cada campo.
 */
export function readReportDraft(draft: ReportDraft, currency: string): ReportDraftReading {
    const errors: Partial<Record<ReportDraftField, string>> = {};
    const name = draft.name.trim();
    if (name === '') {
        errors.name = 'Dê um nome ao relatório.';
    } else if (name.length > REPORT_NAME_MAX_LENGTH) {
        errors.name = `O nome tem até ${String(REPORT_NAME_MAX_LENGTH)} caracteres.`;
    }
    const fixedMonth = draft.anchor === 'fixed' ? readMonth(draft.fixedMonth) : null;
    if (draft.anchor === 'fixed' && fixedMonth === null) {
        errors.fixedMonth = 'Escolha o mês final.';
    }
    const previousMonths = /^\d{1,2}$/.test(draft.previousMonths.trim()) ? Number(draft.previousMonths.trim()) : Number.NaN;
    if (!(previousMonths >= 0 && previousMonths <= REPORT_MAX_PREVIOUS_MONTHS)) {
        errors.previousMonths = `Use um número de 0 a ${String(REPORT_MAX_PREVIOUS_MONTHS)}.`;
    }
    const minValue = readLimit(draft.minValue, currency);
    const maxValue = readLimit(draft.maxValue, currency);
    if (minValue === undefined) {
        errors.minValue = 'Valor inválido.';
    }
    if (maxValue === undefined) {
        errors.maxValue = 'Valor inválido.';
    } else if (maxValue !== null && minValue !== undefined && minValue !== null && minValue > maxValue) {
        errors.maxValue = 'O máximo precisa ser maior ou igual ao mínimo.';
    }
    if (draft.secondary === draft.primary) {
        errors.secondary = 'Escolha uma divisão diferente da primeira.';
    }
    const queryValid = errors.fixedMonth === undefined && errors.previousMonths === undefined && errors.minValue === undefined && errors.maxValue === undefined && errors.secondary === undefined;
    return {
        name: errors.name === undefined ? name : null,
        errors,
        query: queryValid
            ? {
                filter: {
                    period: { anchor: fixedMonth === null ? { kind: 'reference' } : { kind: 'fixed', month: fixedMonth }, previousMonths, basis: draft.basis },
                    types: TRANSACTION_TYPE_ORDER.filter((type) => draft.types.includes(type)),
                    categoryIds: [...draft.categoryIds],
                    subCategoryIds: [...draft.subCategoryIds],
                    accountIds: [...draft.accountIds],
                    creditCardIds: [...draft.creditCardIds],
                    tagIds: [...draft.tagIds],
                    tagMatch: draft.tagMatch,
                    partnerIds: [...draft.partnerIds],
                    goalIds: [...draft.goalIds],
                    status: draft.status,
                    minValue: minValue ?? null,
                    maxValue: maxValue ?? null,
                },
                layout: { format: draft.format, primary: draft.primary, secondary: draft.secondary === NO_SECONDARY ? null : draft.secondary, measure: draft.measure },
            }
            : null,
    };
}

/**
 * @param text Valor de um `<input type="month">`.
 * @return O mês `YYYY-MM`, ou `null` quando vazio ou inválido.
 */
function readMonth(text: string): string | null {
    try {
        return YearMonth.parse(text.trim()).toString();
    } catch {
        return null;
    }
}

/**
 * @param text Valor-limite como digitado.
 * @param currency Moeda do perfil.
 * @return O valor; `null` sem limite (campo vazio); `undefined` quando o texto não é um valor.
 */
function readLimit(text: string, currency: string): number | null | undefined {
    const parsed = parseMoneyInput(text, currency);
    if (parsed.ok) {
        return parsed.amount;
    }
    return parsed.reason === 'empty' ? null : undefined;
}

/**
 * @param profileId Perfil ativo.
 * @param name Nome lido.
 * @param query Filtro e formato lidos.
 * @return A entrada de `reports.create`.
 */
export function toCreateReportInput(profileId: string, name: string, query: ReportQueryInput): CoreInput<'reports.create'> {
    return { profileId, name, filter: query.filter, layout: query.layout };
}

/**
 * @param id Definição editada.
 * @param name Nome lido.
 * @param query Filtro e formato lidos.
 * @return A entrada de `reports.update`.
 */
export function toUpdateReportInput(id: string, name: string, query: ReportQueryInput): CoreInput<'reports.update'> {
    return { id, name, filter: query.filter, layout: query.layout };
}

/** Um cadastro que o filtro pode citar: só o id e o nome. */
export interface ReportNamedOption {
    readonly id: string;
    readonly name: string;
}

/** Os cadastros do perfil, para dar nome aos ids do filtro. */
export interface ReportLookups {
    readonly categories: readonly CategoryBranchResponse[];
    readonly accounts: readonly ReportNamedOption[];
    readonly creditCards: readonly ReportNamedOption[];
    readonly tags: readonly ReportNamedOption[];
    readonly partners: readonly ReportNamedOption[];
    readonly goals: readonly ReportNamedOption[];
}

/**
 * Descreve o intervalo de tempo da definição em palavras, para o cabeçalho do relatório.
 *
 * @param filter Filtro da definição.
 * @param from Primeiro mês da janela resolvida, `YYYY-MM`.
 * @param to Último mês, `YYYY-MM`.
 * @return `out/2026 · pela data de pagamento` ou `mai/2026 a out/2026 · pela data de vencimento`.
 */
export function describeReportPeriod(filter: ReportFilterResponse, from: string, to: string): string {
    const months = from === to ? formatMonthShort(to) : `${formatMonthShort(from)} a ${formatMonthShort(to)}`;
    return `${months} · pela ${REPORT_BASIS_LABELS[filter.period.basis].toLowerCase()}`;
}

/**
 * Descreve cada filtro ativo, para o cabeçalho do relatório dizer o que entrou. Um cadastro
 * excluído depois de salvo aparece como "(excluída)": ele continua no filtro e não casa com nada
 * (reports-design §2.2), e esconder isso faria o relatório parecer errado.
 *
 * @param filter Filtro da definição.
 * @param lookups Cadastros do perfil.
 * @param currency Moeda do perfil, para os valores-limite.
 * @return Uma frase por filtro ativo; vazio quando nada restringe além do período.
 */
export function describeReportFilters(filter: ReportFilterResponse, lookups: ReportLookups, currency: string): readonly string[] {
    const subCategories = lookups.categories.flatMap((category) => category.subCategories.map((sub) => ({ id: sub.id, name: `${category.name} › ${sub.name}` })));
    const parts: string[] = [];
    if (filter.types.length > 0) {
        parts.push(`Tipo: ${filter.types.map(formatTransactionType).join(', ')}`);
    }
    const classification = [...namesOf(filter.categoryIds, lookups.categories), ...namesOf(filter.subCategoryIds, subCategories)];
    if (classification.length > 0) {
        parts.push(`Categoria: ${classification.join(', ')}`);
    }
    const sources = [...namesOf(filter.accountIds, lookups.accounts), ...namesOf(filter.creditCardIds, lookups.creditCards)];
    if (sources.length > 0) {
        parts.push(`Conta ou cartão: ${sources.join(', ')}`);
    }
    if (filter.tagIds.length > 0) {
        const match = filter.tagIds.length > 1 ? ` (${REPORT_TAG_MATCH_LABELS[filter.tagMatch].toLowerCase()})` : '';
        parts.push(`Tag${match}: ${namesOf(filter.tagIds, lookups.tags).join(', ')}`);
    }
    if (filter.partnerIds.length > 0) {
        parts.push(`Sócio: ${namesOf(filter.partnerIds, lookups.partners).join(', ')}`);
    }
    if (filter.goalIds.length > 0) {
        parts.push(`Meta: ${namesOf(filter.goalIds, lookups.goals).join(', ')}`);
    }
    if (filter.status !== 'all') {
        parts.push(REPORT_STATUS_LABELS[filter.status]);
    }
    const money = (amount: number): string => formatMoney({ amount, currency });
    if (filter.minValue !== null && filter.maxValue !== null) {
        parts.push(`Valor de ${money(filter.minValue)} a ${money(filter.maxValue)}`);
    } else if (filter.minValue !== null) {
        parts.push(`Valor a partir de ${money(filter.minValue)}`);
    } else if (filter.maxValue !== null) {
        parts.push(`Valor até ${money(filter.maxValue)}`);
    }
    return parts;
}

/**
 * @param ids Ids citados no filtro.
 * @param options Cadastros vivos que podem ter os ids.
 * @return O nome de cada id, na ordem do filtro; "(excluída)" para o que não está mais entre eles.
 */
function namesOf(ids: readonly string[], options: readonly ReportNamedOption[]): readonly string[] {
    const byId = new Map(options.map((option) => [option.id, option.name]));
    return ids.map((id) => byId.get(id) ?? '(excluída)');
}
