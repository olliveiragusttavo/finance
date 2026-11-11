import {
    describeError,
    describeRepeatPreview,
    describeSeriesPlan,
    formatFrequency,
    formatHiddenRows,
    RECURRENCE_FREQUENCY_ORDER,
    repeatPreviewInput,
    REVIEW_VISIBLE_ROWS,
    scopeChoices,
    useCreatePlan,
    useDeletePlan,
    useRecurrenceOccurrences,
    useRecurrencePreview,
    useUpdatePlan,
    type EditScope,
    type RepeatKind,
    type ReviewAction,
    type ReviewGroup,
    type TransactionFormValues,
} from '@finance/client';
import type { AccountResponse, CoreInput, TransactionResponse } from '@finance/core';
import { useState, type ReactNode } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { Pressable, View } from 'react-native';
import { AppText } from '../ui/AppText.tsx';
import { Button } from '../ui/Button.tsx';
import { FormGroup, FormRow, RowInput, RowSelect, Segmented } from '../ui/form.tsx';
import { RowDate, RowValue } from '../ui/pickers.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { LoadingState } from '../ui/states.tsx';

/** "Não repetir", "Parcelado" e "Fixo", na ordem do mockup `MobileParcelar`. */
const REPEAT_KINDS: readonly { readonly value: RepeatKind; readonly label: string }[] = [
    { value: 'none', label: 'Não repetir' },
    { value: 'installments', label: 'Parcelado' },
    { value: 'fixed', label: 'Fixo' },
];

/** O valor digitado é o total da compra ou o de cada parcela. */
const VALUE_TYPES: readonly { readonly value: TransactionFormValues['valueType']; readonly label: string }[] = [
    { value: 'total', label: 'Valor total' },
    { value: 'perInstallment', label: 'Por parcela' },
];

/**
 * @param values Valores do formulário.
 * @return O resumo da repetição na linha do formulário: `Não repetir`, `Parcelado · 12x mensal`,
 * `Fixo · mensal`.
 */
function repeatSummary(values: TransactionFormValues): string {
    if (values.repeatKind === 'none') {
        return 'Não repetir';
    }
    const frequency = formatFrequency(values.frequency, false);
    return values.repeatKind === 'installments' ? `Parcelado · ${values.installments === '' ? '?' : values.installments}x ${frequency}` : `Fixo · ${frequency}`;
}

/**
 * "Repetir ou parcelar" (mockup `MobileParcelar`; mobile-mvp-plan, Fase 11): a linha do formulário
 * com o resumo e, ao toque, uma folha com o tipo, a frequência, as parcelas ou o fim, o sentido do
 * valor e a prévia das ocorrências (`recurrences.preview`) — as mesmas peças da seção "Repetir"
 * do desktop. Na edição de uma ocorrência, "Não repetir" some: a série só muda de forma.
 *
 * @param props.form O formulário do lançamento.
 * @param props.mode Lançamento novo ou edição de uma ocorrência.
 * @param props.seriesKind Forma da série editada; `null` no lançamento novo.
 * @param props.profileId Perfil do lançamento, para a prévia.
 * @param props.currency Moeda do perfil.
 * @return A linha e a folha.
 */
export function RepeatRow(props: {
    readonly form: UseFormReturn<TransactionFormValues>;
    readonly mode: 'create' | 'edit';
    readonly seriesKind: 'installments' | 'fixed' | null;
    readonly profileId: string;
    readonly currency: string;
}): ReactNode {
    const { form, mode, seriesKind, profileId, currency } = props;
    const [open, setOpen] = useState(false);
    const values = form.watch();
    const { errors } = form.formState;
    const kinds = mode === 'create' ? REPEAT_KINDS : REPEAT_KINDS.filter((option) => option.value !== 'none');
    const previewInput = mode === 'create' && open ? repeatPreviewInput(values, profileId, currency) : null;
    const preview = useRecurrencePreview(previewInput);
    const description = previewInput === null || preview.data === undefined ? null : describeRepeatPreview({ occurrences: preview.data, repeat: previewInput.repeat });
    const error = errors.installments?.message ?? errors.endAt?.message;
    return (
        <>
            <FormRow label="Repetir" error={error}>
                <RowValue
                    label="Repetir ou parcelar"
                    text={repeatSummary(values)}
                    empty={values.repeatKind === 'none'}
                    onPress={() => {
                        setOpen(true);
                    }}
                />
            </FormRow>
            <Sheet
                open={open}
                title="Repetir ou parcelar"
                onClose={() => {
                    setOpen(false);
                }}
            >
                <Controller control={form.control} name="repeatKind" render={({ field }) => <Segmented label="Repetir" options={kinds} value={field.value} onChange={field.onChange} />} />
                {values.repeatKind !== 'none' && (
                    <FormGroup>
                        <FormRow first label="Frequência">
                            <Controller
                                control={form.control}
                                name="frequency"
                                render={({ field }) => (
                                    <RowSelect label="Frequência" options={RECURRENCE_FREQUENCY_ORDER.map((frequency) => ({ value: frequency, label: formatFrequency(frequency, true) }))} value={field.value} onChange={field.onChange} />
                                )}
                            />
                        </FormRow>
                        {values.repeatKind === 'installments' ? (
                            <FormRow label="Parcelas" error={errors.installments?.message}>
                                <Controller
                                    control={form.control}
                                    name="installments"
                                    render={({ field }) => <RowInput label="Parcelas" error={errors.installments?.message} keyboardType="number-pad" placeholder="12" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />}
                                />
                            </FormRow>
                        ) : (
                            <FormRow label="Termina em" error={errors.endAt?.message}>
                                <Controller control={form.control} name="endAt" render={({ field }) => <RowDate label="Termina em (opcional)" value={field.value} onChange={field.onChange} />} />
                            </FormRow>
                        )}
                        {values.repeatKind === 'installments' && (mode === 'create' || seriesKind === 'fixed') && (
                            <FormRow label="O valor é">
                                <Controller control={form.control} name="valueType" render={({ field }) => <Segmented label="O valor digitado é" options={VALUE_TYPES} value={field.value} onChange={field.onChange} />} />
                            </FormRow>
                        )}
                    </FormGroup>
                )}
                {values.repeatKind === 'fixed' && values.endAt !== '' && (
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                            form.setValue('endAt', '');
                        }}
                        className="min-h-11 justify-center self-start px-1"
                    >
                        <AppText className="text-13 text-accent">Repetir sem fim</AppText>
                    </Pressable>
                )}
                {description !== null && description.headline !== '' && (
                    <View accessibilityLabel="Prévia" className="gap-1.5">
                        <AppText className="font-semibold">{description.headline}</AppText>
                        <View className="overflow-hidden rounded-12 border border-line bg-surface">
                            {description.rows.map((row, index) => (
                                <View key={row.key} className={`flex-row items-center justify-between gap-2 px-3.5 py-2 ${index === 0 ? '' : 'border-t border-line2'}`}>
                                    <AppText className="text-13 text-muted">{row.label}</AppText>
                                    <AppText className="flex-1 text-13 text-ink2">{row.detail}</AppText>
                                    <AppText className="text-13">{row.amount}</AppText>
                                </View>
                            ))}
                        </View>
                        {description.more !== null && <AppText className="text-12 text-muted">{description.more}</AppText>}
                        {description.note !== null && <AppText className="text-12 text-muted">{description.note}</AppText>}
                    </View>
                )}
                <Button
                    label="Pronto"
                    onPress={() => {
                        setOpen(false);
                    }}
                />
            </Sheet>
        </>
    );
}

/**
 * A quais ocorrências da série a edição ou a exclusão se aplica (mockup `MobileEscopo`): "somente
 * esta", "esta e as futuras" ou "todas", com o detalhe de cada uma do `scopeChoices` — os mesmos
 * textos do desktop. "Somente esta" confirma direto; as outras seguem para a revisão.
 *
 * @param props.open Se a folha está aberta.
 * @param props.transaction Ocorrência editada ou excluída.
 * @param props.title Título da folha.
 * @param props.action Edição ou exclusão.
 * @param props.pending Se a gravação de "somente esta" está em andamento.
 * @param props.error Recusa da gravação, para mostrar na folha.
 * @param props.onConfirm Escopo escolhido.
 * @param props.onClose Fecha sem fazer nada.
 * @return A folha.
 */
export function ScopeSheet(props: {
    readonly open: boolean;
    readonly transaction: TransactionResponse;
    readonly title: string;
    readonly action: 'edit' | 'delete';
    readonly pending: boolean;
    readonly error: string | null;
    readonly onConfirm: (scope: EditScope) => void;
    readonly onClose: () => void;
}): ReactNode {
    const { open, transaction, title, action, pending, error, onConfirm, onClose } = props;
    const occurrences = useRecurrenceOccurrences(open && transaction.recurrenceId !== null ? { recurrenceId: transaction.recurrenceId } : null);
    const [scope, setScope] = useState<EditScope>('single');
    const choices = occurrences.data === undefined ? null : scopeChoices({ edited: transaction, occurrences: occurrences.data });
    const confirmLabel = scope === 'single' ? (action === 'delete' ? 'Excluir' : 'Salvar') : 'Continuar';
    return (
        <Sheet open={open} title={title} onClose={onClose}>
            <AppText className="text-ink2">{action === 'delete' ? 'Este lançamento faz parte de uma série. Excluir quais?' : 'Este lançamento faz parte de uma série. Aplicar a quais?'}</AppText>
            {choices === null ? (
                <LoadingState />
            ) : (
                <View accessibilityRole="radiogroup" accessibilityLabel="Escopo" className="gap-2">
                    {choices.map((choice) => {
                        const selected = choice.scope === scope;
                        return (
                            <Pressable
                                key={choice.scope}
                                accessibilityRole="radio"
                                accessibilityState={{ selected }}
                                accessibilityLabel={`${choice.label}, ${choice.detail}`}
                                onPress={() => {
                                    setScope(choice.scope);
                                }}
                                className={`min-h-13 justify-center gap-0.5 rounded-10 border px-3.5 py-2.5 ${selected ? 'border-accent bg-soft' : 'border-line bg-surface'}`}
                            >
                                <AppText className={`font-medium ${selected ? 'text-soft-ink' : ''}`}>{choice.label}</AppText>
                                <AppText className="text-12 text-muted">{choice.detail}</AppText>
                            </Pressable>
                        );
                    })}
                </View>
            )}
            {error !== null && <AppText accessibilityRole="alert" className="text-13 text-danger">{error}</AppText>}
            <Button
                label={confirmLabel}
                variant={action === 'delete' && scope === 'single' ? 'danger' : 'primary'}
                disabled={choices === null}
                busy={pending}
                onPress={() => {
                    onConfirm(scope);
                }}
            />
            <Button label="Cancelar" variant="secondary" onPress={onClose} />
        </Sheet>
    );
}

/** O que a revisão confere antes de gravar: criar a série, editar ou excluir parte dela. */
export type SeriesReviewRequest =
    | { readonly action: 'create'; readonly input: CoreInput<'recurrences.planCreate'> }
    | { readonly action: 'edit'; readonly input: CoreInput<'recurrences.planUpdate'> }
    | { readonly action: 'delete'; readonly input: CoreInput<'recurrences.planDelete'> };

/** Título da revisão de cada ação, como o desktop. */
const REVIEW_TITLES: Readonly<Record<ReviewAction, string>> = {
    create: 'Revisar o lançamento',
    edit: 'Revisar as alterações',
    delete: 'Revisar a exclusão',
};

/** Rótulo do botão de confirmação de cada ação. */
const CONFIRM_LABELS: Readonly<Record<ReviewAction, string>> = { create: 'Lançar', edit: 'Salvar', delete: 'Excluir' };

/**
 * Um grupo da revisão (o que entra, o que sai, o que muda), com as primeiras linhas e "Ver todas".
 *
 * @param props.group Grupo já descrito pelo `describeSeriesPlan`.
 * @return O grupo.
 */
function ReviewGroupList({ group }: { readonly group: ReviewGroup }): ReactNode {
    const [expanded, setExpanded] = useState(false);
    const rows = expanded ? group.rows : group.rows.slice(0, REVIEW_VISIBLE_ROWS);
    const more = expanded ? null : formatHiddenRows(group.rows.length - rows.length);
    return (
        <View className="gap-1">
            <AppText className="font-semibold">{group.title}</AppText>
            <View className="overflow-hidden rounded-12 border border-line bg-surface">
                {rows.map((row, index) => (
                    <View key={row.key} className={`flex-row flex-wrap items-center gap-2 px-3.5 py-2 ${index === 0 ? '' : 'border-t border-line2'}`}>
                        <AppText className="text-13">{row.date}</AppText>
                        <AppText className={`rounded-full px-2 text-12 ${row.paid ? 'bg-warn-bg text-warn-ink' : 'bg-line2 text-ink2'}`}>{row.status}</AppText>
                        {row.editedByHand && <AppText className="rounded-full bg-line2 px-2 text-12 text-ink2">Editada manualmente</AppText>}
                    </View>
                ))}
            </View>
            {(more !== null || expanded) && (
                <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                        setExpanded(!expanded);
                    }}
                    className="min-h-11 flex-row items-center gap-2"
                >
                    {more !== null && <AppText className="text-12 text-muted">{more}</AppText>}
                    <AppText className="text-12 text-accent">{expanded ? 'Ver menos' : 'Ver todas'}</AppText>
                </Pressable>
            )}
        </View>
    );
}

/**
 * Revisão da série antes de gravar (database-design §4.12; mockup `MobileEscopo`): o resumo, os
 * avisos — ocorrências já pagas e saldos de meses passados que mudam — e as ocorrências que entram,
 * saem ou mudam, pelos ensaios do núcleo (`recurrences.planCreate`, `planUpdate`, `planDelete`) e
 * pelo `describeSeriesPlan` do desktop.
 *
 * @param props.open Se a folha está aberta.
 * @param props.request O que revisar.
 * @param props.accounts Contas do perfil, para os nomes nos avisos.
 * @param props.pending Se a gravação está em andamento.
 * @param props.error Recusa da gravação.
 * @param props.onConfirm Grava.
 * @param props.onClose Volta um passo.
 * @return A folha.
 */
export function SeriesReviewSheet(props: {
    readonly open: boolean;
    readonly request: SeriesReviewRequest;
    readonly accounts: readonly Pick<AccountResponse, 'id' | 'name'>[];
    readonly pending: boolean;
    readonly error: string | null;
    readonly onConfirm: () => void;
    readonly onClose: () => void;
}): ReactNode {
    const { open, request, accounts, pending, error, onConfirm, onClose } = props;
    const created = useCreatePlan(open && request.action === 'create' ? request.input : null);
    const updated = useUpdatePlan(open && request.action === 'edit' ? request.input : null);
    const deleted = useDeletePlan(open && request.action === 'delete' ? request.input : null);
    const query = request.action === 'create' ? created : request.action === 'edit' ? updated : deleted;
    const review = query.data === undefined ? null : describeSeriesPlan({ plan: query.data, action: request.action, accounts });
    const planError = query.error === null ? null : describeError(query.error.error).message;
    return (
        <Sheet open={open} title={REVIEW_TITLES[request.action]} onClose={onClose}>
            <AppText className="text-13 text-muted">Confira o que será feito antes de confirmar.</AppText>
            {review === null && planError === null && <LoadingState />}
            {review !== null && (
                <View className="gap-3">
                    {review.summary.map((sentence) => (
                        <AppText key={sentence} className="text-ink2">
                            • {sentence}
                        </AppText>
                    ))}
                    {review.warnings.length > 0 && (
                        <View accessibilityRole="alert" className="gap-1 rounded-10 bg-warn-bg px-3 py-2.5">
                            {review.warnings.map((warning) => (
                                <AppText key={warning} className="text-13 text-warn-ink">
                                    {warning}
                                </AppText>
                            ))}
                        </View>
                    )}
                    {review.groups.map((group) => (
                        <ReviewGroupList key={group.kind} group={group} />
                    ))}
                </View>
            )}
            {(planError ?? error) !== null && <AppText accessibilityRole="alert" className="text-13 text-danger">{planError ?? error}</AppText>}
            <Button label={CONFIRM_LABELS[request.action]} variant={request.action === 'delete' ? 'danger' : 'primary'} disabled={review === null} busy={pending} onPress={onConfirm} />
            <Button label="Voltar" variant="secondary" onPress={onClose} />
        </Sheet>
    );
}
