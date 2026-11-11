import {
    ACCOUNT_FIELD_BY_CORE_FIELD,
    ACCOUNT_FIELDS,
    type AccountContent,
    accountFormFrom,
    type AccountFormValues,
    currencyOptionsWith,
    emptyAccountForm,
    formatAccountType,
    formatMoney,
    readAccountForm,
    reportRejection,
    useCoreMutation,
} from '@finance/client';
import type { AccountResponse } from '@finance/core';
import { useState, type ReactNode } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { Switch, View } from 'react-native';
import { useActiveProfile } from '../shell/ActiveProfile.tsx';
import { AppText } from '../ui/AppText.tsx';
import { Button } from '../ui/Button.tsx';
import { FormGroup, FormRow, RowInput, RowSelect, Segmented, toFieldErrors } from '../ui/form.tsx';
import { Sheet } from '../ui/Sheet.tsx';

/** Tipos de conta, na ordem do primeiro uso e do desktop. */
const ACCOUNT_TYPES = (['checking', 'investment'] as const).map((type) => ({ value: type, label: formatAccountType(type) }));

/**
 * Criar ou editar conta numa folha (mobile-mvp-plan, Fase 12): nome, tipo, moeda, saldo inicial
 * e se entra no total — os campos e a validação do diálogo do desktop (`readAccountForm` do
 * `client`, que aplica o schema das rotas de conta), para que o celular nunca aceite o que o
 * desktop recusa. Quem abre monta a folha só enquanto ela está aberta, para que cada abertura
 * comece dos valores da conta, e não do que ficou digitado na anterior.
 *
 * @param props.account Conta a editar, ou `null` para criar uma.
 * @param props.onClose Fecha a folha, depois de salvar ou ao desistir.
 * @param props.onCreated Recebe a conta criada, para a tela abrir o extrato dela.
 * @return A folha com o formulário.
 */
export function AccountFormSheet(props: { readonly account: AccountResponse | null; readonly onClose: () => void; readonly onCreated?: (account: AccountResponse) => void }): ReactNode {
    const { account, onClose, onCreated } = props;
    const { profile } = useActiveProfile();
    /**
     * Valida pelo `readAccountForm` e entrega ao envio o conteúdo já montado — o que foi validado
     * é exatamente o que vai ao núcleo.
     *
     * @param values Valores dos campos.
     * @return O conteúdo da conta, ou o erro de cada campo no formato do react-hook-form.
     */
    const resolver: Resolver<AccountFormValues, unknown, AccountContent> = (values) => {
        const result = readAccountForm(values, profile.currency);
        return result.ok ? { values: result.content, errors: {} } : { values: {}, errors: toFieldErrors<AccountFormValues>(ACCOUNT_FIELDS, result.errors) };
    };
    const form = useForm<AccountFormValues, unknown, AccountContent>({ defaultValues: account === null ? emptyAccountForm(profile.currency) : accountFormFrom(account), resolver });
    const create = useCoreMutation('accounts.create');
    const update = useCoreMutation('accounts.update');
    const [generalError, setGeneralError] = useState<string | null>(null);
    const { errors } = form.formState;
    const currencies = currencyOptionsWith(account?.currency ?? profile.currency).map((option) => ({ value: option.code, label: option.label }));

    /**
     * Valida e grava. A recusa do núcleo vai para o campo que ele aponta (`reportRejection`),
     * ou para o aviso geral quando não aponta nenhum.
     */
    const submit = (): void => {
        void form.handleSubmit(async (content) => {
            setGeneralError(null);
            try {
                if (account === null) {
                    const created = await create.mutateAsync({ ...content, profileId: profile.id });
                    onClose();
                    onCreated?.(created);
                } else {
                    await update.mutateAsync({ ...content, id: account.id });
                    onClose();
                }
            } catch (error) {
                reportRejection(
                    error,
                    ACCOUNT_FIELD_BY_CORE_FIELD,
                    (field, message) => {
                        form.setError(field, { type: 'core', message });
                    },
                    setGeneralError,
                );
            }
        })();
    };

    return (
        <Sheet open title={account === null ? 'Nova conta' : `Editar ${account.name}`} onClose={onClose}>
            <FormGroup>
                <FormRow first label="Nome" error={errors.name?.message}>
                    <Controller
                        control={form.control}
                        name="name"
                        render={({ field }) => <RowInput label="Nome da conta" error={errors.name?.message} placeholder="Ex.: Nubank" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />}
                    />
                </FormRow>
                <FormRow label="Tipo" error={errors.type?.message}>
                    <Controller control={form.control} name="type" render={({ field }) => <Segmented label="Tipo da conta" options={ACCOUNT_TYPES} value={field.value} onChange={field.onChange} />} />
                </FormRow>
                <FormRow label="Moeda" error={errors.currency?.message}>
                    <Controller
                        control={form.control}
                        name="currency"
                        render={({ field }) => <RowSelect label="Moeda da conta" options={currencies} value={field.value} onChange={field.onChange} display={(option) => option.value} />}
                    />
                </FormRow>
                <FormRow label={`Saldo inicial (${profile.currency})`} error={errors.openingBalance?.message}>
                    <Controller
                        control={form.control}
                        name="openingBalance"
                        render={({ field }) => (
                            <RowInput
                                label="Saldo inicial"
                                error={errors.openingBalance?.message}
                                placeholder={formatMoney({ amount: 0, currency: profile.currency })}
                                keyboardType="numeric"
                                value={field.value}
                                onChangeText={field.onChange}
                                onBlur={field.onBlur}
                            />
                        )}
                    />
                </FormRow>
                <FormRow label="Considerar no total">
                    <Controller control={form.control} name="considerBalance" render={({ field }) => <Switch accessibilityLabel="Considerar no total" value={field.value} onValueChange={field.onChange} />} />
                </FormRow>
            </FormGroup>
            <View className="gap-1">
                <AppText className="text-12 text-muted">
                    {account === null ? 'O saldo inicial é o que a conta já tinha antes do primeiro mês registrado.' : 'Mudar o saldo inicial recalcula os saldos de todos os meses da conta.'}
                </AppText>
                <AppText className="text-12 text-muted">Fora do total, a conta continua nas listas e nos relatórios, mas não soma no consolidado nem no previsto do perfil.</AppText>
            </View>
            {generalError !== null && (
                <AppText accessibilityRole="alert" className="text-13 text-danger">
                    {generalError}
                </AppText>
            )}
            <Button label={account === null ? 'Criar conta' : 'Salvar'} busy={create.isPending || update.isPending} onPress={submit} />
        </Sheet>
    );
}
