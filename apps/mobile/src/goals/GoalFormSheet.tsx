import {
    describeGoalFundingChange,
    emptyGoalForm,
    formatMoney,
    GOAL_FIELD_BY_CORE_FIELD,
    GOAL_FIELDS,
    GOAL_FUNDING_KINDS,
    goalFormFrom,
    readGoalForm,
    reportRejection,
    useAccounts,
    useCoreMutation,
    type GoalContent,
    type GoalFormValues,
} from '@finance/client';
import type { GoalProgressResponse, GoalResponse } from '@finance/core';
import { useState, type ReactNode } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { Pressable } from 'react-native';
import { useActiveProfile } from '../shell/ActiveProfile.tsx';
import { useReferenceMonth } from '../shell/useReferenceMonth.ts';
import { AppText } from '../ui/AppText.tsx';
import { Button } from '../ui/Button.tsx';
import { FormGroup, FormRow, RowInput, Segmented, toFieldErrors } from '../ui/form.tsx';
import { RowDate, RowSearchSelect } from '../ui/pickers.tsx';
import { Sheet } from '../ui/Sheet.tsx';

/** Os tipos de meta no controle segmentado, com os rótulos do `client`. */
const FUNDING_OPTIONS = GOAL_FUNDING_KINDS.map((item) => ({ value: item.kind, label: item.label }));

/**
 * Criar ou editar meta numa folha (mobile-mvp-plan, Fase 14, tela aprovada pelo usuário): nome,
 * tipo, conta de investimento na meta vinculada a conta, valor-alvo e data-alvo opcional — os
 * campos e a validação do diálogo do desktop (`readGoalForm` do `client`). Quem abre monta a folha
 * só enquanto ela está aberta.
 * Regra de negócio (Metas, desktop-mvp-plan Fase 13.3): só conta de investimento guarda o dinheiro
 * da meta — a desativada continua oferecida, porque o saldo dela ainda existe —, e trocar a meta
 * por lançamentos para a vinculada a conta desfaz os vínculos: a folha avisa quantos antes de
 * salvar.
 *
 * @param props.goal Meta a editar, com quantos lançamentos estão vinculados, ou `null` para criar.
 * @param props.onClose Fecha a folha, depois de salvar ou ao desistir.
 * @param props.onCreated Recebe a meta criada, para a tela abrir o detalhe dela.
 * @return A folha com o formulário.
 */
export function GoalFormSheet(props: { readonly goal: GoalProgressResponse | null; readonly onClose: () => void; readonly onCreated?: (goal: GoalResponse) => void }): ReactNode {
    const { goal, onClose, onCreated } = props;
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const accounts = useAccounts({ profileId: profile.id, period });
    const investments = (accounts.data?.accounts ?? []).filter((account) => account.type === 'investment');
    /**
     * Valida pelo `readGoalForm`, que aplica o schema das rotas de meta, e entrega ao envio o
     * conteúdo já montado.
     *
     * @param values Valores dos campos.
     * @return O conteúdo da meta, ou o erro de cada campo no formato do react-hook-form.
     */
    const resolver: Resolver<GoalFormValues, unknown, GoalContent> = (values) => {
        const result = readGoalForm(values, profile.currency);
        return result.ok ? { values: result.content, errors: {} } : { values: {}, errors: toFieldErrors<GoalFormValues>(GOAL_FIELDS, result.errors) };
    };
    const form = useForm<GoalFormValues, unknown, GoalContent>({ defaultValues: goal === null ? emptyGoalForm() : goalFormFrom(goal), resolver });
    const create = useCoreMutation('goals.create');
    const update = useCoreMutation('goals.update');
    const [generalError, setGeneralError] = useState<string | null>(null);
    const { errors } = form.formState;
    const fundingKind = form.watch('fundingKind');
    const targetDate = form.watch('targetDate');
    const unlinkWarning = goal !== null && goal.funding.kind === 'transactions' && fundingKind === 'account' ? describeGoalFundingChange(goal) : null;

    /** Valida e grava; a recusa do núcleo vai para o campo que ela aponta. */
    const submit = (): void => {
        void form.handleSubmit(async (content) => {
            setGeneralError(null);
            try {
                if (goal === null) {
                    const created = await create.mutateAsync({ ...content, profileId: profile.id });
                    onClose();
                    onCreated?.(created);
                } else {
                    await update.mutateAsync({ ...content, id: goal.id });
                    onClose();
                }
            } catch (error) {
                reportRejection(
                    error,
                    GOAL_FIELD_BY_CORE_FIELD,
                    (field, message) => {
                        form.setError(field, { type: 'core', message });
                    },
                    setGeneralError,
                );
            }
        })();
    };

    return (
        <Sheet open title={goal === null ? 'Nova meta' : `Editar ${goal.name}`} onClose={onClose}>
            <FormGroup>
                <FormRow first label="Nome" error={errors.name?.message}>
                    <Controller
                        control={form.control}
                        name="name"
                        render={({ field }) => <RowInput label="Nome da meta" error={errors.name?.message} placeholder="Ex.: Viagem Floripa" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />}
                    />
                </FormRow>
                <FormRow label={`Valor-alvo (${profile.currency})`} error={errors.value?.message}>
                    <Controller
                        control={form.control}
                        name="value"
                        render={({ field }) => (
                            <RowInput
                                label="Valor-alvo"
                                error={errors.value?.message}
                                placeholder={formatMoney({ amount: 0, currency: profile.currency })}
                                keyboardType="numeric"
                                value={field.value}
                                onChangeText={field.onChange}
                                onBlur={field.onBlur}
                            />
                        )}
                    />
                </FormRow>
                <FormRow label="Data-alvo" error={errors.targetDate?.message}>
                    <Controller control={form.control} name="targetDate" render={({ field }) => <RowDate label="Data-alvo" value={field.value} onChange={field.onChange} />} />
                </FormRow>
            </FormGroup>
            {targetDate === '' ? (
                <AppText className="text-12 text-muted">Sem data-alvo, a meta não tem prazo.</AppText>
            ) : (
                <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                        form.setValue('targetDate', '');
                    }}
                    className="min-h-11 justify-center self-start"
                >
                    <AppText className="text-13 text-accent">Tirar a data-alvo</AppText>
                </Pressable>
            )}
            <Controller control={form.control} name="fundingKind" render={({ field }) => <Segmented label="Tipo da meta" options={FUNDING_OPTIONS} value={field.value} onChange={field.onChange} />} />
            <AppText className="text-12 text-muted">{GOAL_FUNDING_KINDS.find((item) => item.kind === fundingKind)?.description ?? ''}</AppText>
            {fundingKind === 'account' && (
                <FormGroup>
                    <FormRow first label="Conta" error={errors.accountId?.message}>
                        <Controller
                            control={form.control}
                            name="accountId"
                            render={({ field }) => (
                                <RowSearchSelect
                                    label="Conta de investimento"
                                    options={investments.map((account) => ({ value: account.id, label: account.disabled ? `${account.name} (desativada)` : account.name }))}
                                    value={field.value === '' ? null : field.value}
                                    onChange={field.onChange}
                                    placeholder="Escolha a conta"
                                    emptyText="Nenhuma conta de investimento; crie uma em Contas."
                                />
                            )}
                        />
                    </FormRow>
                </FormGroup>
            )}
            {unlinkWarning !== null && <AppText className="rounded-8 bg-warn-bg px-3 py-2.5 text-13 text-warn-ink">{unlinkWarning}</AppText>}
            {generalError !== null && (
                <AppText accessibilityRole="alert" className="text-13 text-danger">
                    {generalError}
                </AppText>
            )}
            <Button label={goal === null ? 'Criar meta' : 'Salvar'} busy={create.isPending || update.isPending} onPress={submit} />
        </Sheet>
    );
}
