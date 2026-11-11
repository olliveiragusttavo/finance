import {
    callOrThrow,
    type CoreCallError,
    CURRENCY_OPTIONS,
    describeError,
    EMPTY_ONBOARDING_FORM,
    formatMoney,
    formatProfileType,
    invalidateAfter,
    ONBOARDING_FIELDS,
    type OnboardingFormValues,
    type OnboardingInput,
    readOnboardingForm,
    useCoreClient,
} from '@finance/client';
import type { OnboardingResponse } from '@finance/core';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDevicePreferences } from '../preferences/devicePreferences.tsx';
import { ThemeButton } from '../shell/ThemeButton.tsx';
import { AppText } from '../ui/AppText.tsx';
import { Button } from '../ui/Button.tsx';
import { FormGroup, FormRow, FormSection, RowInput, RowSelect, Segmented, toFieldErrors } from '../ui/form.tsx';

/** Tipos de perfil, na ordem do mockup. */
const PROFILE_TYPES = (['personal', 'business'] as const).map((type) => ({ value: type, label: formatProfileType(type) }));

/** Moedas oferecidas, as mesmas do desktop; a linha mostra só o código, como o mockup. */
const CURRENCIES = CURRENCY_OPTIONS.map((option) => ({ value: option.code, label: option.label }));

/**
 * Valida pelo `readOnboardingForm` do `client` — o mesmo do desktop, que aplica o schema do
 * núcleo —, e entrega ao envio a entrada da rota já montada: o que foi validado é exatamente o
 * que vai ao núcleo.
 *
 * @param values Valores dos campos.
 * @return A entrada da rota, ou o erro de cada campo no formato do react-hook-form.
 */
const onboardingResolver: Resolver<OnboardingFormValues, unknown, OnboardingInput> = (values) => {
    const result = readOnboardingForm(values);
    return result.ok ? { values: result.input, errors: {} } : { values: {}, errors: toFieldErrors<OnboardingFormValues>(ONBOARDING_FIELDS, result.errors) };
};

/**
 * Chama o `onboarding.start` e prepara a entrada no app, como o desktop: o perfil criado vira o
 * aberto no aparelho e o último mês volta ao corrente, para o Início abrir no mês de hoje mesmo
 * que o aparelho guarde o mês de um banco anterior. As preferências mudam **antes** de invalidar
 * os perfis, porque é a invalidação que monta o shell, e ele as lê ao montar.
 *
 * @return A mutação do primeiro uso.
 */
function useStartOnboarding(): UseMutationResult<OnboardingResponse, CoreCallError, OnboardingInput> {
    const client = useCoreClient();
    const queryClient = useQueryClient();
    const { update } = useDevicePreferences();
    return useMutation<OnboardingResponse, CoreCallError, OnboardingInput>({
        mutationFn: (input) => callOrThrow(client, 'onboarding.start', input),
        onSuccess: async (started) => {
            update({ lastProfileId: started.profile.id, lastPeriod: null });
            await invalidateAfter(queryClient, 'onboarding.start');
        },
    });
}

/**
 * Primeiro uso (mockup `MobilePrimeiroUso`; mobile-mvp-plan, Fase 7): o banco sem perfil abre
 * aqui, fora do shell, porque toda tela do shell lê dados de um perfil. Cria o perfil e a
 * primeira conta juntos pelo `onboarding.start` — o primeiro uso não pode deixar perfil sem
 * conta. A conta nasce corrente e na moeda do perfil, como o mockup propõe (ele não pergunta o
 * tipo): investimento se escolhe depois, em Contas. "Entrar num grupo" aparece desabilitado,
 * com o porquê, até a sincronização existir (mobile-mvp-plan §5.1).
 *
 * @return A tela.
 */
export function FirstUseScreen(): ReactNode {
    const insets = useSafeAreaInsets();
    const form = useForm<OnboardingFormValues, unknown, OnboardingInput>({ defaultValues: EMPTY_ONBOARDING_FORM, resolver: onboardingResolver });
    const start = useStartOnboarding();
    const { errors } = form.formState;
    const currency = form.watch('currency');

    /** Valida e, se o formulário estiver certo, cria o perfil e a conta. */
    const submit = (): void => {
        void form.handleSubmit((input) => {
            start.mutate(input);
        })();
    };

    return (
        <View style={{ paddingTop: insets.top }} className="flex-1 bg-bg">
            <View className="absolute right-3 z-10" style={{ top: insets.top + 12 }}>
                <ThemeButton />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} contentContainerClassName="flex-grow gap-3.5 px-5 pt-14">
                <View className="gap-1.5">
                    <AppText className="text-26 font-semibold" accessibilityRole="header">Vamos começar</AppText>
                    <AppText className="text-13 text-muted">Seus dados ficam só neste aparelho e nos dispositivos que você parear.</AppText>
                </View>

                <FormSection>Perfil</FormSection>
                <FormGroup>
                    <FormRow first label="Nome" error={errors.profileName?.message}>
                        <Controller
                            control={form.control}
                            name="profileName"
                            render={({ field }) => <RowInput label="Nome do perfil" error={errors.profileName?.message} placeholder="Ex.: Pessoal" maxLength={45} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />}
                        />
                    </FormRow>
                    <FormRow label="Tipo">
                        <Controller control={form.control} name="profileType" render={({ field }) => <Segmented label="Tipo de perfil" options={PROFILE_TYPES} value={field.value} onChange={field.onChange} />} />
                    </FormRow>
                    <FormRow label="Moeda" error={errors.currency?.message}>
                        <Controller
                            control={form.control}
                            name="currency"
                            render={({ field }) => <RowSelect label="Moeda" options={CURRENCIES} value={field.value} onChange={field.onChange} display={(option) => option.value} />}
                        />
                    </FormRow>
                </FormGroup>

                <FormSection>Primeira conta</FormSection>
                <FormGroup>
                    <FormRow first label="Nome" error={errors.accountName?.message}>
                        <Controller
                            control={form.control}
                            name="accountName"
                            render={({ field }) => <RowInput label="Nome da conta" error={errors.accountName?.message} placeholder="Ex.: Nubank" maxLength={45} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />}
                        />
                    </FormRow>
                    <FormRow label="Saldo inicial" error={errors.openingBalance?.message}>
                        <Controller
                            control={form.control}
                            name="openingBalance"
                            render={({ field }) => (
                                <RowInput
                                    label="Saldo inicial"
                                    error={errors.openingBalance?.message}
                                    placeholder={formatMoney({ amount: 0, currency })}
                                    keyboardType="numeric"
                                    value={field.value}
                                    onChangeText={field.onChange}
                                    onBlur={field.onBlur}
                                />
                            )}
                        />
                    </FormRow>
                </FormGroup>
                <AppText className="text-12 text-muted">Saldo inicial é o que a conta já tinha antes do primeiro mês registrado.</AppText>

                {start.isError && (
                    <AppText accessibilityRole="alert" className="text-13 text-danger">
                        {describeError(start.error.error).message}
                    </AppText>
                )}

                <View className="mt-auto gap-2.5 pt-4">
                    <Button large label={start.isPending ? 'Criando…' : 'Criar e começar'} busy={start.isPending} onPress={submit} />
                    <Button large variant="secondary" disabled label="Entrar num grupo existente" accessibilityHint="A sincronização entre aparelhos chega numa próxima versão do app." onPress={() => undefined} />
                    <AppText className="text-center text-12 text-muted">A sincronização entre aparelhos chega numa próxima versão do app.</AppText>
                </View>
            </ScrollView>
        </View>
    );
}
