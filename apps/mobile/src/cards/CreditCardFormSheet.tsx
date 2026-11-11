import {
    closingDayWarning,
    CREDIT_CARD_FIELD_BY_CORE_FIELD,
    CREDIT_CARD_FIELDS,
    creditCardFormFrom,
    emptyCreditCardForm,
    formatMoney,
    payingAccountOptions,
    readCreditCardForm,
    reportRejection,
    useCoreMutation,
    type CreditCardContent,
    type CreditCardFormValues,
} from '@finance/client';
import type { AccountResponse, CreditCardResponse } from '@finance/core';
import { useState, type ReactNode } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { useActiveProfile } from '../shell/ActiveProfile.tsx';
import { AppText } from '../ui/AppText.tsx';
import { Button } from '../ui/Button.tsx';
import { FormGroup, FormRow, RowInput, toFieldErrors } from '../ui/form.tsx';
import { RowSearchSelect } from '../ui/pickers.tsx';
import { Sheet } from '../ui/Sheet.tsx';

/**
 * Criar ou editar cartão numa folha (mobile-mvp-plan, Fase 13): nome, conta pagadora, limite e os
 * dias de fechamento e vencimento — os campos e a validação do diálogo do desktop
 * (`readCreditCardForm` do `client`). Quem abre monta a folha só enquanto ela está aberta, para
 * que cada abertura comece dos valores do cartão.
 * Regra de negócio (Cartões): a conta pagadora é uma conta ativa — a desativada só aparece quando
 * já é a do cartão editado, para não trocá-la sem querer (`payingAccountOptions`); o dia de
 * fechamento acima de 28 avisa que, nos meses sem ele, a fatura fecha no último dia.
 *
 * @param props.creditCard Cartão a editar, ou `null` para criar um.
 * @param props.accounts Contas do perfil, das quais sai a escolha da conta pagadora.
 * @param props.onClose Fecha a folha, depois de salvar ou ao desistir.
 * @param props.onCreated Recebe o cartão criado, para a tela abrir a fatura dele.
 * @return A folha com o formulário.
 */
export function CreditCardFormSheet(props: {
    readonly creditCard: CreditCardResponse | null;
    readonly accounts: readonly AccountResponse[];
    readonly onClose: () => void;
    readonly onCreated?: (creditCard: CreditCardResponse) => void;
}): ReactNode {
    const { creditCard, accounts, onClose, onCreated } = props;
    const { profile } = useActiveProfile();
    const options = payingAccountOptions(accounts, creditCard?.accountId ?? null);
    /**
     * Valida pelo `readCreditCardForm`, que aplica o schema das rotas de cartão, e entrega ao envio
     * o conteúdo já montado.
     *
     * @param values Valores dos campos.
     * @return O conteúdo do cartão, ou o erro de cada campo no formato do react-hook-form.
     */
    const resolver: Resolver<CreditCardFormValues, unknown, CreditCardContent> = (values) => {
        const result = readCreditCardForm(values, profile.currency);
        return result.ok ? { values: result.content, errors: {} } : { values: {}, errors: toFieldErrors<CreditCardFormValues>(CREDIT_CARD_FIELDS, result.errors) };
    };
    const form = useForm<CreditCardFormValues, unknown, CreditCardContent>({
        defaultValues: creditCard === null ? emptyCreditCardForm(options[0]?.id ?? '') : creditCardFormFrom(creditCard),
        resolver,
    });
    const create = useCoreMutation('creditCards.create');
    const update = useCoreMutation('creditCards.update');
    const [generalError, setGeneralError] = useState<string | null>(null);
    const { errors } = form.formState;
    const closingWarning = closingDayWarning(form.watch('closingDay'));

    /** Valida e grava; a recusa do núcleo vai para o campo que ela aponta. */
    const submit = (): void => {
        void form.handleSubmit(async (content) => {
            setGeneralError(null);
            try {
                if (creditCard === null) {
                    const created = await create.mutateAsync({ ...content, profileId: profile.id });
                    onClose();
                    onCreated?.(created);
                } else {
                    await update.mutateAsync({ ...content, id: creditCard.id });
                    onClose();
                }
            } catch (error) {
                reportRejection(
                    error,
                    CREDIT_CARD_FIELD_BY_CORE_FIELD,
                    (field, message) => {
                        form.setError(field, { type: 'core', message });
                    },
                    setGeneralError,
                );
            }
        })();
    };

    return (
        <Sheet open title={creditCard === null ? 'Novo cartão' : `Editar ${creditCard.name}`} onClose={onClose}>
            <FormGroup>
                <FormRow first label="Nome" error={errors.name?.message}>
                    <Controller
                        control={form.control}
                        name="name"
                        render={({ field }) => <RowInput label="Nome do cartão" error={errors.name?.message} placeholder="Ex.: Roxinho" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />}
                    />
                </FormRow>
                <FormRow label="Conta pagadora" error={errors.accountId?.message}>
                    <Controller
                        control={form.control}
                        name="accountId"
                        render={({ field }) => (
                            <RowSearchSelect
                                label="Conta pagadora"
                                options={options.map((account) => ({ value: account.id, label: account.disabled ? `${account.name} (desativada)` : account.name }))}
                                value={field.value === '' ? null : field.value}
                                onChange={field.onChange}
                                placeholder="Escolha a conta"
                                emptyText="Nenhuma conta encontrada."
                            />
                        )}
                    />
                </FormRow>
                <FormRow label={`Limite (${profile.currency})`} error={errors.limit?.message}>
                    <Controller
                        control={form.control}
                        name="limit"
                        render={({ field }) => (
                            <RowInput
                                label="Limite"
                                error={errors.limit?.message}
                                placeholder={formatMoney({ amount: 0, currency: profile.currency })}
                                keyboardType="numeric"
                                value={field.value}
                                onChangeText={field.onChange}
                                onBlur={field.onBlur}
                            />
                        )}
                    />
                </FormRow>
                <FormRow label="Dia do fechamento" error={errors.closingDay?.message}>
                    <Controller
                        control={form.control}
                        name="closingDay"
                        render={({ field }) => (
                            <RowInput label="Dia do fechamento" error={errors.closingDay?.message} placeholder="1 a 31" keyboardType="number-pad" maxLength={2} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />
                        )}
                    />
                </FormRow>
                <FormRow label="Dia do vencimento" error={errors.dueDay?.message}>
                    <Controller
                        control={form.control}
                        name="dueDay"
                        render={({ field }) => (
                            <RowInput label="Dia do vencimento" error={errors.dueDay?.message} placeholder="1 a 31" keyboardType="number-pad" maxLength={2} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />
                        )}
                    />
                </FormRow>
            </FormGroup>
            {closingWarning !== null && <AppText className="text-12 text-warn-ink">{closingWarning}</AppText>}
            <AppText className="text-12 text-muted">
                {creditCard === null
                    ? 'A fatura de cada mês reúne as compras feitas depois do fechamento anterior.'
                    : 'Mudar o fechamento vale para as compras novas; as já lançadas continuam nas faturas em que estão.'}
            </AppText>
            {generalError !== null && (
                <AppText accessibilityRole="alert" className="text-13 text-danger">
                    {generalError}
                </AppText>
            )}
            <Button label={creditCard === null ? 'Criar cartão' : 'Salvar'} busy={create.isPending || update.isPending} onPress={submit} />
        </Sheet>
    );
}
