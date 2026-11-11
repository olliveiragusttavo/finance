import {
    currencyOptionsWith,
    emptyProfileForm,
    formatProfileType,
    PROFILE_FIELD_BY_CORE_FIELD,
    PROFILE_FIELDS,
    profileFormFrom,
    readProfileForm,
    reportRejection,
    useCoreMutation,
    type ProfileContent,
    type ProfileFormValues,
} from '@finance/client';
import type { ProfileResponse } from '@finance/core';
import { useState, type ReactNode } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { AppText } from '../ui/AppText.tsx';
import { Button } from '../ui/Button.tsx';
import { FormGroup, FormRow, RowInput, RowSelect, Segmented, toFieldErrors } from '../ui/form.tsx';
import { Sheet } from '../ui/Sheet.tsx';

/** Tipos de perfil, na ordem do primeiro uso. */
const PROFILE_TYPES = (['personal', 'business'] as const).map((type) => ({ value: type, label: formatProfileType(type) }));

/**
 * Aviso do perfil empresarial: é o tipo que tem sócios e o relatório por sócio. O tipo não muda
 * depois de criado, por isso o aviso aparece ao escolhê-lo.
 */
const BUSINESS_WITH_PARTNERS = 'Perfil empresarial: tem sócios com participação, cadastrados em Sócios, e o relatório por sócio.';

/**
 * Criar perfil (nome, tipo, moeda) ou editar (nome e moeda), numa folha, com a validação do
 * desktop (`readProfileForm` do `client`). O tipo não muda depois de criado: `profiles.update`
 * não o recebe, e trocar pessoal por empresarial mudaria o que o perfil pode ter (sócios).
 * Regra de negócio (Perfis, desktop-mvp-plan §5): a moeda só muda sem lançamentos; a recusa do
 * núcleo aparece abaixo da moeda.
 *
 * @param props.profile Perfil a editar, ou `null` para criar um.
 * @param props.onClose Fecha a folha.
 * @param props.onCreated Recebe o perfil criado, para a tela oferecer abri-lo.
 * @return A folha com o formulário.
 */
export function ProfileFormSheet(props: { readonly profile: ProfileResponse | null; readonly onClose: () => void; readonly onCreated?: (profile: ProfileResponse) => void }): ReactNode {
    const { profile, onClose, onCreated } = props;
    /**
     * Valida pelo `readProfileForm`, que aplica o schema da rota de perfil.
     *
     * @param values Valores dos campos.
     * @return O cadastro do perfil, ou o erro de cada campo no formato do react-hook-form.
     */
    const resolver: Resolver<ProfileFormValues, unknown, ProfileContent> = (values) => {
        const result = readProfileForm(values);
        return result.ok ? { values: result.content, errors: {} } : { values: {}, errors: toFieldErrors<ProfileFormValues>(PROFILE_FIELDS, result.errors) };
    };
    const form = useForm<ProfileFormValues, unknown, ProfileContent>({ defaultValues: profile === null ? emptyProfileForm() : profileFormFrom(profile), resolver });
    const create = useCoreMutation('profiles.create');
    const update = useCoreMutation('profiles.update');
    const [generalError, setGeneralError] = useState<string | null>(null);
    const { errors } = form.formState;
    const type = form.watch('type');
    const currencies = currencyOptionsWith(profile?.currency ?? null).map((option) => ({ value: option.code, label: option.label }));

    /** Valida e grava; a recusa do núcleo vai para o campo que ela aponta. */
    const submit = (): void => {
        void form.handleSubmit(async (content) => {
            setGeneralError(null);
            try {
                if (profile === null) {
                    const created = await create.mutateAsync(content);
                    onClose();
                    onCreated?.(created);
                } else {
                    await update.mutateAsync({ id: profile.id, name: content.name, currency: content.currency });
                    onClose();
                }
            } catch (error) {
                reportRejection(
                    error,
                    PROFILE_FIELD_BY_CORE_FIELD,
                    (field, message) => {
                        form.setError(field, { type: 'core', message });
                    },
                    setGeneralError,
                );
            }
        })();
    };

    return (
        <Sheet open title={profile === null ? 'Novo perfil' : `Editar ${profile.name}`} onClose={onClose}>
            <FormGroup>
                <FormRow first label="Nome" error={errors.name?.message}>
                    <Controller
                        control={form.control}
                        name="name"
                        render={({ field }) => <RowInput label="Nome do perfil" error={errors.name?.message} placeholder="Ex.: Pessoal" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />}
                    />
                </FormRow>
                <FormRow label="Tipo">
                    {profile === null ? (
                        <Controller control={form.control} name="type" render={({ field }) => <Segmented label="Tipo de perfil" options={PROFILE_TYPES} value={field.value} onChange={field.onChange} />} />
                    ) : (
                        <AppText>{formatProfileType(profile.type)}</AppText>
                    )}
                </FormRow>
                <FormRow label="Moeda" error={errors.currency?.message}>
                    <Controller control={form.control} name="currency" render={({ field }) => <RowSelect label="Moeda" options={currencies} value={field.value} onChange={field.onChange} display={(option) => option.value} />} />
                </FormRow>
            </FormGroup>
            <AppText className="text-12 text-muted">
                Todo valor do perfil é gravado na moeda dele; a moeda só muda enquanto o perfil não tem lançamentos.{profile === null ? '' : ' O tipo não muda depois de criado.'}
            </AppText>
            {type === 'business' && <AppText className="rounded-8 bg-soft px-3 py-2.5 text-13 text-soft-ink">{BUSINESS_WITH_PARTNERS}</AppText>}
            {generalError !== null && (
                <AppText accessibilityRole="alert" className="text-13 text-danger">
                    {generalError}
                </AppText>
            )}
            <Button label={profile === null ? 'Criar perfil' : 'Salvar'} busy={create.isPending || update.isPending} onPress={submit} />
        </Sheet>
    );
}
