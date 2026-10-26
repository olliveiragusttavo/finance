import {
    draftFromDefinition,
    emptyReportDraft,
    formatTransactionType,
    NO_SECONDARY,
    readReportDraft,
    REPORT_BASIS_LABELS,
    REPORT_DIMENSION_LABELS,
    REPORT_FORMAT_LABELS,
    REPORT_MEASURE_LABELS,
    REPORT_STATUS_LABELS,
    REPORT_TAG_MATCH_LABELS,
    reportDimensionsFor,
    toCreateReportInput,
    toUpdateReportInput,
    TRANSACTION_TYPE_ORDER,
    useCoreMutation,
    useReport,
    useReportPreview,
    type ReportDraft,
    type ReportDraftField,
    type ReportLookups,
} from '@finance/client';
import {
    REPORT_DATE_BASES,
    REPORT_FORMATS,
    REPORT_MEASURES,
    REPORT_NAME_MAX_LENGTH,
    REPORT_STATUS_FILTERS,
    REPORT_TAG_MATCHES,
    type ReportDefinitionResponse,
    type ReportDimension,
} from '@finance/core';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import type { FieldError } from 'react-hook-form';
import { toast } from 'sonner';
import { Combobox, type ComboboxOption } from '@/components/Combobox';
import { Field, fieldAria, SectionTitle } from '@/components/form';
import { DetailPane, PaneLayout } from '@/components/PaneLayout';
import { QueryState, Skeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { reportRejection } from '@/lib/coreErrorField';
import { useActiveProfile } from '@/shell/activeProfile';
import { useReferenceMonth } from '@/shell/useReferenceMonth';
import { ReportResult } from './ReportResult.tsx';
import { parseReportsSearch } from './reportsSearch.ts';
import { useReportLookups } from './useReportLookups.ts';

/** Campo do editor de cada campo que o núcleo pode apontar numa recusa. */
const FIELD_BY_CORE_FIELD: Readonly<Partial<Record<string, ReportDraftField>>> = {
    name: 'name',
    previousMonths: 'previousMonths',
    minValue: 'minValue',
    maxValue: 'maxValue',
    secondary: 'secondary',
};

/**
 * Editor dos relatórios personalizados (reports-design §2 e §3), em `/reports/edit`: o formulário
 * à esquerda — nome, período, os filtros dos lançamentos e o formato — e o resultado ao vivo à
 * direita, que roda o rascunho pela rota `reports.preview` sem salvar. Sem `report` na URL cria um
 * relatório novo; com ele, edita o salvo. Sem mockup próprio: segue a lista e o detalhe das outras
 * telas, com o formulário no lugar da lista. A barra do mês continua à vista, porque o resultado
 * ao vivo e o período "mês de referência" dependem dela.
 *
 * @return O editor.
 */
export function ReportEditorScreen(): ReactNode {
    const search = useSearch({ strict: false, select: (raw: Readonly<Record<string, unknown>>) => parseReportsSearch(raw) });
    const definition = useReport(search.report === undefined ? null : { id: search.report });
    const lookups = useReportLookups();
    if (search.report === undefined) {
        return lookups === null ? <EditorSkeleton /> : <ReportEditor definition={null} lookups={lookups} />;
    }
    return (
        <QueryState query={definition} loading={<EditorSkeleton />}>
            {(saved) => (lookups === null ? <EditorSkeleton /> : <ReportEditor key={saved.id} definition={saved} lookups={lookups} />)}
        </QueryState>
    );
}

/**
 * @return O esqueleto do editor enquanto a definição e os cadastros carregam.
 */
function EditorSkeleton(): ReactNode {
    return <Skeleton className="h-96" />;
}

/**
 * @param errors Erros do rascunho.
 * @return Os mesmos erros sem o do nome.
 */
function withoutName(errors: Partial<Record<ReportDraftField, string>>): Partial<Record<ReportDraftField, string>> {
    const copy = { ...errors };
    delete copy.name;
    return copy;
}

/**
 * @param message Mensagem do campo.
 * @return O erro no formato que o `Field` mostra; `undefined` sem mensagem.
 */
function fieldError(message: string | undefined): FieldError | undefined {
    return message === undefined ? undefined : { type: 'validate', message };
}

/**
 * O formulário e o resultado ao vivo. O rascunho fica num estado só, lido a cada mudança pelo
 * `readReportDraft` do `client` — a mesma leitura do celular —, e o resultado só é pedido quando
 * o filtro e o formato são válidos.
 *
 * @param props.definition Definição editada; `null` para um relatório novo.
 * @param props.lookups Cadastros do perfil, para as escolhas dos filtros.
 * @return O editor.
 */
function ReportEditor({ definition, lookups }: { readonly definition: ReportDefinitionResponse | null; readonly lookups: ReportLookups }): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const navigate = useNavigate();
    const [draft, setDraft] = useState<ReportDraft>(() => (definition === null ? emptyReportDraft(period) : draftFromDefinition(definition, period, profile.currency)));
    const [submitted, setSubmitted] = useState(false);
    const [coreErrors, setCoreErrors] = useState<Partial<Record<ReportDraftField, string>>>({});
    const [generalError, setGeneralError] = useState<string | null>(null);
    const create = useCoreMutation('reports.create');
    const update = useCoreMutation('reports.update');
    const reading = readReportDraft(draft, profile.currency);
    const preview = useReportPreview(reading.query === null ? null : { profileId: profile.id, period, ...reading.query });
    // O nome só acusa erro depois de tentar salvar: o editor abre sem nome, e o aviso logo de
    // início pareceria uma recusa do que ainda nem foi feito.
    const errors: Partial<Record<ReportDraftField, string>> = { ...(submitted ? reading.errors : withoutName(reading.errors)), ...coreErrors };
    const pending = create.isPending || update.isPending;

    /**
     * @param patch Campos alterados do rascunho.
     * @return void
     */
    const change = (patch: Partial<ReportDraft>): void => {
        setDraft((current) => ({ ...current, ...patch }));
        setCoreErrors({});
        setGeneralError(null);
    };

    /**
     * @return Promessa resolvida quando o relatório foi salvo e aberto, ou o erro apareceu.
     */
    const save = async (): Promise<void> => {
        setSubmitted(true);
        if (reading.name === null || reading.query === null) {
            return;
        }
        try {
            const saved = definition === null
                ? await create.mutateAsync(toCreateReportInput(profile.id, reading.name, reading.query))
                : await update.mutateAsync(toUpdateReportInput(definition.id, reading.name, reading.query));
            toast.success(definition === null ? `Relatório ${saved.name} criado.` : `Relatório ${saved.name} salvo.`);
            void navigate({ to: '/reports', search: (previous: Readonly<Record<string, unknown>>) => ({ ...previous, report: saved.id }) });
        } catch (rejection) {
            reportRejection(rejection, FIELD_BY_CORE_FIELD, (field, message) => { setCoreErrors({ [field]: message }); }, setGeneralError);
        }
    };

    return (
        <PaneLayout>
            <form
                noValidate
                aria-label={definition === null ? 'Novo relatório' : `Editar ${definition.name}`}
                className="flex w-110 shrink-0 flex-col border-r border-line bg-surface"
                onSubmit={(event) => {
                    event.preventDefault();
                    void save();
                }}
            >
                <div className="shrink-0 px-5 pt-5 pb-3">
                    <span className="text-12 text-muted">Relatórios</span>
                    <h1 className="text-20 font-semibold">{definition === null ? 'Novo relatório' : 'Editar relatório'}</h1>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5">
                    <Field id="report-name" label="Nome" error={fieldError(errors.name)}>
                        <Input
                            id="report-name"
                            maxLength={REPORT_NAME_MAX_LENGTH}
                            placeholder="Ex.: Gastos com o carro"
                            value={draft.name}
                            onChange={(event) => { change({ name: event.target.value }); }}
                            {...fieldAria('report-name', fieldError(errors.name))}
                        />
                    </Field>
                    <PeriodSection draft={draft} errors={errors} onChange={change} />
                    <FilterSection draft={draft} errors={errors} lookups={lookups} onChange={change} />
                    <LayoutSection draft={draft} errors={errors} onChange={change} />
                </div>
                <div className="flex shrink-0 flex-col gap-2 border-t border-line px-5 py-3.5">
                    {generalError !== null && (
                        <p role="alert" className="text-13 text-danger">
                            {generalError}
                        </p>
                    )}
                    <div className="flex justify-end gap-2.5">
                        <Button asChild variant="outline">
                            <Link to="/reports" search={(previous: Readonly<Record<string, unknown>>) => ({ ...previous, report: definition?.id })}>
                                Cancelar
                            </Link>
                        </Button>
                        <Button type="submit" disabled={pending}>
                            {pending ? 'Salvando…' : 'Salvar relatório'}
                        </Button>
                    </div>
                </div>
            </form>
            <DetailPane label="Resultado ao vivo">
                <div className="flex flex-col gap-1">
                    <h2 className="text-20 font-semibold">{draft.name.trim() === '' ? 'Sem nome' : draft.name.trim()}</h2>
                    <p className="text-13 text-muted">Resultado ao vivo, com o que está no formulário; nada é salvo até "Salvar relatório".</p>
                </div>
                {reading.query === null ? (
                    <p className="rounded-8 bg-warn-bg px-3 py-2.5 text-13 text-warn-ink">Corrija os campos marcados para ver o resultado.</p>
                ) : (
                    <QueryState query={preview} loading={<Skeleton className="h-60" />}>
                        {(data) => <ReportResult result={data} format={draft.format} name={draft.name.trim() === '' ? 'Novo relatório' : draft.name.trim()} currency={profile.currency} />}
                    </QueryState>
                )}
            </DetailPane>
        </PaneLayout>
    );
}

/** O que toda seção do formulário recebe. */
interface SectionProps {
    readonly draft: ReportDraft;
    readonly errors: Partial<Record<ReportDraftField, string>>;
    readonly onChange: (patch: Partial<ReportDraft>) => void;
}

/**
 * Intervalo de tempo (reports-design §2.1): onde termina, quantos meses antes e qual data decide o
 * mês de cada lançamento.
 *
 * @param props Rascunho, erros e a mudança.
 * @return A seção.
 */
function PeriodSection({ draft, errors, onChange }: SectionProps): ReactNode {
    return (
        <section aria-labelledby="report-period-title" className="flex flex-col gap-3">
            <div id="report-period-title">
                <SectionTitle>Período</SectionTitle>
            </div>
            <SelectField
                id="report-anchor"
                label="Termina em"
                value={draft.anchor}
                options={[
                    { value: 'reference', label: 'Mês de referência (acompanha a barra)' },
                    { value: 'fixed', label: 'Um mês fixo' },
                ]}
                onChange={(anchor) => { onChange({ anchor }); }}
            />
            {draft.anchor === 'fixed' && (
                <Field id="report-fixed-month" label="Mês final" error={fieldError(errors.fixedMonth)}>
                    <Input
                        id="report-fixed-month"
                        type="month"
                        className="tabular-nums"
                        value={draft.fixedMonth}
                        onChange={(event) => { onChange({ fixedMonth: event.target.value }); }}
                        {...fieldAria('report-fixed-month', fieldError(errors.fixedMonth))}
                    />
                </Field>
            )}
            <Field id="report-previous" label="Meses anteriores" error={fieldError(errors.previousMonths)} hint="0 mostra só o mês final; até 35 (36 meses no total).">
                <Input
                    id="report-previous"
                    inputMode="numeric"
                    className="tabular-nums"
                    value={draft.previousMonths}
                    onChange={(event) => { onChange({ previousMonths: event.target.value.replace(/\D/g, '') }); }}
                    {...fieldAria('report-previous', fieldError(errors.previousMonths), true)}
                />
            </Field>
            <SelectField
                id="report-basis"
                label="Data que decide o mês"
                value={draft.basis}
                options={REPORT_DATE_BASES.map((basis) => ({ value: basis, label: REPORT_BASIS_LABELS[basis] }))}
                onChange={(basis) => { onChange({ basis }); }}
                hint={draft.basis === 'payment' ? 'Lançamentos em aberto ficam de fora: ainda não têm data de pagamento.' : draft.basis === 'created' ? 'O dia em que o lançamento entrou no app.' : undefined}
            />
        </section>
    );
}

/**
 * Os filtros dos lançamentos (reports-design §2.2). Cada escolha vazia não restringe; dentro de um
 * filtro as escolhas se somam, e entre filtros todos valem.
 *
 * @param props Rascunho, erros, cadastros do perfil e a mudança.
 * @return A seção.
 */
function FilterSection({ draft, errors, lookups, onChange }: SectionProps & { readonly lookups: ReportLookups }): ReactNode {
    const { profile } = useActiveProfile();
    const categoryValues = [...draft.categoryIds.map((id) => `category:${id}`), ...draft.subCategoryIds.map((id) => `subCategory:${id}`)];
    const sourceValues = [...draft.accountIds.map((id) => `account:${id}`), ...draft.creditCardIds.map((id) => `creditCard:${id}`)];
    const categoryOptions = withMissing(
        [
            ...lookups.categories.map((category) => ({ value: `category:${category.id}`, label: category.name, group: 'Categorias inteiras' })),
            ...lookups.categories.flatMap((category) => category.subCategories.map((sub) => ({ value: `subCategory:${sub.id}`, label: sub.name, prefix: `${category.name} › `, group: 'Subcategorias' }))),
        ],
        categoryValues,
    );
    const sourceOptions = withMissing(
        [
            ...lookups.accounts.map((account) => ({ value: `account:${account.id}`, label: account.name, group: 'Contas' })),
            ...lookups.creditCards.map((card) => ({ value: `creditCard:${card.id}`, label: card.name, group: 'Cartões' })),
        ],
        sourceValues,
    );

    return (
        <section aria-labelledby="report-filter-title" className="flex flex-col gap-3">
            <div id="report-filter-title">
                <SectionTitle>Lançamentos</SectionTitle>
            </div>
            <fieldset className="flex flex-col gap-1.5 text-13">
                <legend className="mb-1 text-muted">Tipos</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {TRANSACTION_TYPE_ORDER.map((type) => (
                        <label key={type} className="flex items-center gap-1.5">
                            <input
                                type="checkbox"
                                className="accent-accent"
                                checked={draft.types.includes(type)}
                                onChange={(event) => { onChange({ types: event.target.checked ? [...draft.types, type] : draft.types.filter((chosen) => chosen !== type) }); }}
                            />
                            {formatTransactionType(type)}
                        </label>
                    ))}
                </div>
                <p className="text-12 text-ink2">Nenhum marcado inclui todos os tipos.</p>
            </fieldset>
            <MultiField
                id="report-categories"
                label="Categorias"
                options={categoryOptions}
                value={categoryValues}
                placeholder="Todas as categorias"
                searchLabel="Buscar categoria ou subcategoria"
                emptyText="Nenhuma categoria encontrada."
                onChange={(values) => { onChange({ categoryIds: idsOf(values, 'category'), subCategoryIds: idsOf(values, 'subCategory') }); }}
            />
            <MultiField
                id="report-sources"
                label="Contas e cartões"
                options={sourceOptions}
                value={sourceValues}
                placeholder="Todas as contas e cartões"
                searchLabel="Buscar conta ou cartão"
                emptyText="Nenhuma conta ou cartão encontrado."
                onChange={(values) => { onChange({ accountIds: idsOf(values, 'account'), creditCardIds: idsOf(values, 'creditCard') }); }}
            />
            <MultiField
                id="report-tags"
                label="Tags"
                options={withMissing(lookups.tags.map((tag) => ({ value: tag.id, label: tag.name })), draft.tagIds)}
                value={draft.tagIds}
                placeholder="Com ou sem tag"
                searchLabel="Buscar tag"
                emptyText="Nenhuma tag encontrada."
                onChange={(tagIds) => { onChange({ tagIds }); }}
            />
            {draft.tagIds.length > 1 && (
                <SelectField
                    id="report-tag-match"
                    label="Lançamentos com"
                    value={draft.tagMatch}
                    options={REPORT_TAG_MATCHES.map((match) => ({ value: match, label: `${REPORT_TAG_MATCH_LABELS[match]} das tags escolhidas` }))}
                    onChange={(tagMatch) => { onChange({ tagMatch }); }}
                />
            )}
            {profile.type === 'business' && (
                <MultiField
                    id="report-partners"
                    label="Sócios"
                    options={withMissing(lookups.partners.map((partner) => ({ value: partner.id, label: partner.name })), draft.partnerIds)}
                    value={draft.partnerIds}
                    placeholder="Com ou sem sócio"
                    searchLabel="Buscar sócio"
                    emptyText="Nenhum sócio encontrado."
                    onChange={(partnerIds) => { onChange({ partnerIds }); }}
                />
            )}
            <MultiField
                id="report-goals"
                label="Metas"
                options={withMissing(lookups.goals.map((goal) => ({ value: goal.id, label: goal.name })), draft.goalIds)}
                value={draft.goalIds}
                placeholder="Com ou sem meta"
                searchLabel="Buscar meta"
                emptyText="Nenhuma meta encontrada."
                onChange={(goalIds) => { onChange({ goalIds }); }}
            />
            <SelectField
                id="report-status"
                label="Situação"
                value={draft.status}
                options={REPORT_STATUS_FILTERS.map((status) => ({ value: status, label: REPORT_STATUS_LABELS[status] }))}
                onChange={(status) => { onChange({ status }); }}
            />
            <div className="grid grid-cols-2 gap-3">
                <Field id="report-min" label="Valor mínimo" error={fieldError(errors.minValue)}>
                    <Input
                        id="report-min"
                        inputMode="decimal"
                        placeholder="Sem mínimo"
                        className="text-right tabular-nums"
                        value={draft.minValue}
                        onChange={(event) => { onChange({ minValue: event.target.value }); }}
                        {...fieldAria('report-min', fieldError(errors.minValue))}
                    />
                </Field>
                <Field id="report-max" label="Valor máximo" error={fieldError(errors.maxValue)}>
                    <Input
                        id="report-max"
                        inputMode="decimal"
                        placeholder="Sem máximo"
                        className="text-right tabular-nums"
                        value={draft.maxValue}
                        onChange={(event) => { onChange({ maxValue: event.target.value }); }}
                        {...fieldAria('report-max', fieldError(errors.maxValue))}
                    />
                </Field>
            </div>
        </section>
    );
}

/**
 * Formato (reports-design §3): tabela ou gráfico, a primeira divisão (linhas ou eixo), a segunda
 * (colunas ou séries) e a medida. Os rótulos mudam com o formato para dizer onde cada divisão
 * aparece.
 *
 * @param props Rascunho, erros e a mudança.
 * @return A seção.
 */
function LayoutSection({ draft, errors, onChange }: SectionProps): ReactNode {
    const { profile } = useActiveProfile();
    const dimensions = reportDimensionsFor(profile.type);
    const dimensionOptions = dimensions.map((dimension) => ({ value: dimension, label: REPORT_DIMENSION_LABELS[dimension] }));
    const table = draft.format === 'table';
    return (
        <section aria-labelledby="report-layout-title" className="flex flex-col gap-3">
            <div id="report-layout-title">
                <SectionTitle>Formato</SectionTitle>
            </div>
            <SelectField
                id="report-format"
                label="Mostrar como"
                value={draft.format}
                options={REPORT_FORMATS.map((format) => ({ value: format, label: REPORT_FORMAT_LABELS[format] }))}
                onChange={(format) => { onChange({ format }); }}
            />
            <SelectField<ReportDimension>
                id="report-primary"
                label={table ? 'Linhas' : 'Eixo'}
                value={draft.primary}
                options={dimensionOptions}
                onChange={(primary) => { onChange({ primary }); }}
            />
            <SelectField<ReportDimension | typeof NO_SECONDARY>
                id="report-secondary"
                label={table ? 'Colunas' : 'Séries'}
                value={draft.secondary}
                options={[{ value: NO_SECONDARY, label: table ? 'Só o total' : 'Uma série só' }, ...dimensionOptions]}
                onChange={(secondary) => { onChange({ secondary }); }}
                error={errors.secondary}
            />
            <SelectField
                id="report-measure"
                label="Medida"
                value={draft.measure}
                options={REPORT_MEASURES.map((measure) => ({ value: measure, label: REPORT_MEASURE_LABELS[measure] }))}
                onChange={(measure) => { onChange({ measure }); }}
                hint={draft.measure === 'sum' ? 'Soma o valor dos lançamentos; estornos abatem, encargos ficam de fora.' : undefined}
            />
        </section>
    );
}

/**
 * Lista curta e fixa de opções, no `Select` dos formulários, com rótulo e mensagem pelo `Field`.
 *
 * @param props.id Id do campo.
 * @param props.label Rótulo.
 * @param props.value Opção escolhida.
 * @param props.options Opções, na ordem do seletor.
 * @param props.onChange Escolhe uma opção; só recebe valores da lista.
 * @param props.hint Explicação abaixo do campo.
 * @param props.error Erro do campo.
 * @return O campo.
 */
function SelectField<T extends string>({
    id,
    label,
    value,
    options,
    onChange,
    hint,
    error,
}: {
    readonly id: string;
    readonly label: string;
    readonly value: T;
    readonly options: readonly { readonly value: T; readonly label: string }[];
    readonly onChange: (value: T) => void;
    readonly hint?: string | undefined;
    readonly error?: string | undefined;
}): ReactNode {
    return (
        <Field id={id} label={label} error={fieldError(error)} hint={hint}>
            <Select
                value={value}
                onValueChange={(raw) => {
                    const chosen = options.find((option) => option.value === raw);
                    if (chosen !== undefined) {
                        onChange(chosen.value);
                    }
                }}
            >
                <SelectTrigger id={id} className="w-full bg-surface" {...fieldAria(id, fieldError(error), hint !== undefined)}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </Field>
    );
}

/**
 * Escolha de vários cadastros, com busca, pelo `Combobox` dos formulários.
 *
 * @param props.id Id do campo.
 * @param props.label Rótulo.
 * @param props.options Cadastros oferecidos.
 * @param props.value Valores escolhidos.
 * @param props.placeholder Texto sem escolha — o que "nenhum" quer dizer no filtro.
 * @param props.searchLabel Nome do campo de busca.
 * @param props.emptyText Frase da busca sem resultado.
 * @param props.onChange Troca a escolha.
 * @return O campo.
 */
function MultiField({
    id,
    label,
    options,
    value,
    placeholder,
    searchLabel,
    emptyText,
    onChange,
}: {
    readonly id: string;
    readonly label: string;
    readonly options: readonly ComboboxOption[];
    readonly value: readonly string[];
    readonly placeholder: string;
    readonly searchLabel: string;
    readonly emptyText: string;
    readonly onChange: (value: readonly string[]) => void;
}): ReactNode {
    return (
        <Field id={id} label={label} error={undefined}>
            <Combobox id={id} multiple options={options} value={value} placeholder={placeholder} searchLabel={searchLabel} emptyText={emptyText} onChange={onChange} />
        </Field>
    );
}

/**
 * Regra de negócio (Relatórios, §2.2): o cadastro excluído depois de salvo continua no filtro e não
 * casa com nada. Ele entra nas opções como "(excluída)", para que a escolha mostre que ele está lá
 * e o usuário possa tirá-lo.
 *
 * @param options Cadastros vivos.
 * @param chosen Valores escolhidos no rascunho.
 * @return As opções, com uma a mais para cada escolhido que não está mais entre elas.
 */
function withMissing(options: readonly ComboboxOption[], chosen: readonly string[]): readonly ComboboxOption[] {
    const known = new Set(options.map((option) => option.value));
    return [...options, ...chosen.filter((value) => !known.has(value)).map((value) => ({ value, label: '(excluída)', group: 'Excluídas' }))];
}

/**
 * @param values Valores do `Combobox`, com o tipo de cadastro como prefixo (`category:<id>`).
 * @param kind Tipo de cadastro procurado.
 * @return Os ids daquele tipo, na ordem da escolha.
 */
function idsOf(values: readonly string[], kind: 'category' | 'subCategory' | 'account' | 'creditCard'): string[] {
    const prefix = `${kind}:`;
    return values.filter((value) => value.startsWith(prefix)).map((value) => value.slice(prefix.length));
}
