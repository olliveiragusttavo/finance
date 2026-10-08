import { describeRepeatPreview, formatFrequency, parseMoneyInput, RECURRENCE_FREQUENCY_ORDER, useRecurrencePreview } from '@finance/client';
import type { CoreInput } from '@finance/core';
import type { ReactNode } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { Field, fieldAria } from '@/components/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import { periodOfDate } from '@/cards/invoiceForms';
import { parseSourceKey, type RepeatKind, type TransactionFormValues } from './transactionForm.ts';

/** Opções de "Repetir", na ordem do mockup `MobileParcelar`. */
const REPEAT_KINDS: readonly { readonly kind: RepeatKind; readonly label: string }[] = [
    { kind: 'none', label: 'Não repetir' },
    { kind: 'installments', label: 'Parcelado' },
    { kind: 'fixed', label: 'Fixo' },
];

/**
 * "Repetir" do formulário de lançamento (mockup `MobileParcelar`, adaptado ao diálogo do desktop;
 * desktop-mvp-plan Fase 9.1): não repetir, parcelado ou fixo, a frequência, as parcelas e se o
 * valor digitado é o total ou o de cada parcela, o fim da série fixa e a prévia do que será
 * gravado. Na edição de uma ocorrência, a série pode virar parcelada ou fixa, mas não deixar de
 * repetir; o valor é o da ocorrência, e só a fixa que vira parcelada pergunta se ele é o total ou
 * o de cada parcela, como na criação (desktop-mvp-plan Fase 9.2). A prévia não aparece na
 * edição: o diálogo de revisão mostra o que será excluído e criado.
 *
 * @param props.form O formulário.
 * @param props.idOf Id de um campo, único por formulário.
 * @param props.mode `create` num lançamento novo, `edit` numa ocorrência de série.
 * @param props.seriesKind Forma da série editada; `null` num lançamento novo.
 * @param props.profileId Perfil, para a prévia.
 * @param props.currency Moeda do perfil, para ler o valor.
 * @return A seção.
 */
export function RepeatSection({
    form,
    idOf,
    mode,
    seriesKind,
    profileId,
    currency,
}: {
    readonly form: UseFormReturn<TransactionFormValues>;
    readonly idOf: (name: string) => string;
    readonly mode: 'create' | 'edit';
    readonly seriesKind: 'installments' | 'fixed' | null;
    readonly profileId: string;
    readonly currency: string;
}): ReactNode {
    const { errors } = form.formState;
    const values = form.watch();
    const kinds = mode === 'create' ? REPEAT_KINDS : REPEAT_KINDS.filter((option) => option.kind !== 'none');
    const previewInput = mode === 'create' ? previewInputOf(values, profileId, currency) : null;
    const preview = useRecurrencePreview(previewInput);
    const description = previewInput === null || preview.data === undefined
        ? null
        : describeRepeatPreview({ occurrences: preview.data, repeat: previewInput.repeat });

    return (
        <section aria-label="Repetir" className="flex flex-col gap-2.5 rounded-8 bg-surface2 p-3 ring-1 ring-line">
            <Controller
                control={form.control}
                name="repeatKind"
                render={({ field }) => (
                    <div role="radiogroup" aria-label="Repetir" className={cn('grid gap-0.5 rounded-8 bg-surface p-0.5 ring-1 ring-line', kinds.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
                        {kinds.map((option) => (
                            <button
                                key={option.kind}
                                type="button"
                                role="radio"
                                aria-checked={field.value === option.kind}
                                className={cn('rounded-6 px-1 py-1.5 text-12 text-ink2', field.value === option.kind && 'bg-soft font-semibold text-soft-ink')}
                                onClick={() => {
                                    field.onChange(option.kind);
                                }}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                )}
            />
            {values.repeatKind !== 'none' && (
                <div className="grid grid-cols-2 items-start gap-2.5">
                    <Field id={idOf('frequency')} label="Frequência" error={undefined}>
                        <Controller
                            control={form.control}
                            name="frequency"
                            render={({ field }) => (
                                <Select value={field.value} onValueChange={field.onChange}>
                                    <SelectTrigger id={idOf('frequency')} className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {RECURRENCE_FREQUENCY_ORDER.map((frequency) => (
                                            <SelectItem key={frequency} value={frequency}>
                                                {formatFrequency(frequency, true)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        />
                    </Field>
                    {values.repeatKind === 'installments' ? (
                        <Field id={idOf('installments')} label="Parcelas" error={errors.installments}>
                            <Input id={idOf('installments')} inputMode="numeric" className="text-right tabular-nums" {...fieldAria(idOf('installments'), errors.installments)} {...form.register('installments')} />
                        </Field>
                    ) : (
                        <Field id={idOf('end-at')} label="Termina em (opcional)" error={errors.endAt}>
                            <Input id={idOf('end-at')} type="date" className="tabular-nums" {...fieldAria(idOf('end-at'), errors.endAt)} {...form.register('endAt')} />
                        </Field>
                    )}
                </div>
            )}
            {values.repeatKind === 'installments' && (mode === 'create' || seriesKind === 'fixed') && (
                <Controller
                    control={form.control}
                    name="valueType"
                    render={({ field }) => (
                        <div role="radiogroup" aria-label="O valor digitado é" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-13">
                            <span className="w-full text-muted">O valor digitado é</span>
                            {(['total', 'perInstallment'] as const).map((valueType) => (
                                <label key={valueType} className="flex items-center gap-1.5">
                                    <input
                                        type="radio"
                                        className="accent-accent"
                                        checked={field.value === valueType}
                                        onChange={() => {
                                            field.onChange(valueType);
                                        }}
                                    />
                                    {valueType === 'total' ? 'Valor total' : 'Valor por parcela'}
                                </label>
                            ))}
                        </div>
                    )}
                />
            )}
            {description !== null && description.headline !== '' && (
                <div aria-label="Prévia" role="region" className="flex flex-col gap-1.5 text-13">
                    <p className="font-semibold tabular-nums">{description.headline}</p>
                    <ul className="flex flex-col">
                        {description.rows.map((row) => (
                            <li key={row.key} className="flex justify-between gap-2 border-t border-line2 py-1 tabular-nums">
                                <span className="text-muted">{row.label}</span>
                                <span className="flex-1 text-ink2">{row.detail}</span>
                                <span>{row.amount}</span>
                            </li>
                        ))}
                    </ul>
                    {description.more !== null && <p className="text-12 text-muted">{description.more}</p>}
                    {description.note !== null && <p className="text-12 text-muted">{description.note}</p>}
                </div>
            )}
        </section>
    );
}

/**
 * Entrada da prévia, só quando o formulário já tem o que decide datas, valores e faturas: um
 * campo incompleto não pode virar consulta.
 *
 * @param values Valores dos campos.
 * @param profileId Perfil.
 * @param currency Moeda do perfil.
 * @return A entrada de `recurrences.preview`, ou `null` enquanto falta algo.
 */
function previewInputOf(values: TransactionFormValues, profileId: string, currency: string): (CoreInput<'recurrences.preview'> & { readonly repeat: NonNullable<CoreInput<'transactions.create'>['repeat']> }) | null {
    const amount = parseMoneyInput(values.amount, currency);
    const source = parseSourceKey(values.source);
    const installments = /^\d{1,3}$/.test(values.installments.trim()) ? Number(values.installments.trim()) : null;
    if (values.repeatKind === 'none' || !amount.ok || amount.amount <= 0 || source === null || periodOfDate(values.dueDate) === null) {
        return null;
    }
    if (values.repeatKind === 'installments' && (installments === null || installments < 2 || installments > 360)) {
        return null;
    }
    if (values.repeatKind === 'fixed' && values.endAt !== '' && periodOfDate(values.endAt) === null) {
        return null;
    }
    const repeat = values.repeatKind === 'installments'
        ? { kind: 'installments' as const, frequency: values.frequency, installments: installments ?? 2, valueType: values.valueType }
        : { kind: 'fixed' as const, frequency: values.frequency, endAt: values.endAt === '' ? null : values.endAt };
    return {
        profileId,
        source: source.kind === 'account' ? source : { ...source, invoicePeriod: values.invoicePeriod === '' ? null : values.invoicePeriod },
        dueDate: values.dueDate,
        value: values.inverted ? 0 - amount.amount : amount.amount,
        repeat,
    };
}
