import {
    currentDate,
    defaultPartialPaymentAccount,
    describeError,
    describeInvoicePayment,
    describeInvoiceReopening,
    formatMoney,
    formatMonthShort,
    PARTIAL_PAYMENT_FIELDS,
    partialPaymentAccountOptions,
    PAY_INVOICE_FIELDS,
    periodOfDate,
    readPartialPaymentForm,
    readPayInvoiceForm,
    reportRejection,
    subCategoryOptions,
    useCategoryTree,
    useCoreMutation,
    useStatement,
    type PartialPaymentFormValues,
    type PayInvoiceFormValues,
} from '@finance/client';
import type { AccountResponse, InvoiceResponse } from '@finance/core';
import { useState, type ReactNode } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { View } from 'react-native';
import { useActiveProfile } from '../shell/ActiveProfile.tsx';
import { AppText } from '../ui/AppText.tsx';
import { Button } from '../ui/Button.tsx';
import { FormGroup, FormRow, RowInput, toFieldErrors } from '../ui/form.tsx';
import { RowDate, RowSearchSelect } from '../ui/pickers.tsx';
import { Sheet } from '../ui/Sheet.tsx';

/*
 * Ações sobre a fatura no celular (mobile-mvp-plan, Fase 13): pagar, pagamento parcial e reabrir,
 * com as mesmas regras e frases do desktop. Cada uma diz antes o que muda no saldo da conta,
 * porque as três mexem no extrato de uma conta que não está na tela.
 */

/** A fatura sobre a qual a ação age, com o que as frases precisam. */
export interface InvoiceActionTarget {
    readonly creditCardId: string;
    readonly creditCardName: string;
    /** Conta pagadora do cartão: a que a fatura paga debita (database-design §4.7). */
    readonly payingAccountId: string;
    readonly payingAccountName: string;
    readonly invoice: InvoiceResponse;
    /** Vencimento da fatura `YYYY-MM-DD`. */
    readonly dueDate: string;
}

/**
 * Pagar a fatura inteira (mockup `MobilePagarFatura`): o valor a pagar, a conta pagadora, a data e
 * a prévia do saldo da conta antes de confirmar.
 * Regra de negócio (Fatura): quem paga é sempre a conta pagadora do cartão — o vínculo da fatura é
 * com o extrato dela (database-design §4.7) —, então a conta aparece, mas não se escolhe aqui;
 * trocar é editar o cartão. A data sugerida é hoje.
 *
 * @param props.target Fatura em aberto a pagar.
 * @param props.onClose Fecha a folha, depois de pagar ou ao desistir.
 * @param props.onPartial Troca para o pagamento parcial, como o link do mockup.
 * @return A folha.
 */
export function PayInvoiceSheet({ target, onClose, onPartial }: { readonly target: InvoiceActionTarget; readonly onClose: () => void; readonly onPartial: (() => void) | null }): ReactNode {
    const { invoice } = target;
    /**
     * Valida pelo `readPayInvoiceForm`, que aplica o schema de `invoices.pay`.
     *
     * @param values Valores dos campos.
     * @return Os valores, ou o erro do campo no formato do react-hook-form.
     */
    const resolver: Resolver<PayInvoiceFormValues> = (values) => {
        const result = readPayInvoiceForm(values, invoice.id);
        return result.ok ? { values: { paymentDate: result.input.paymentDate }, errors: {} } : { values: {}, errors: toFieldErrors<PayInvoiceFormValues>(PAY_INVOICE_FIELDS, result.errors) };
    };
    const form = useForm<PayInvoiceFormValues>({ defaultValues: { paymentDate: currentDate(new Date()) }, resolver });
    const pay = useCoreMutation('invoices.pay');
    const [generalError, setGeneralError] = useState<string | null>(null);
    const { errors } = form.formState;
    const paymentDate = form.watch('paymentDate');
    const paymentPeriod = periodOfDate(paymentDate);
    // O extrato do mês do pagamento dá o consolidado de antes; sem data válida, a prévia diz só
    // para qual extrato a fatura vai.
    const statement = useStatement(paymentPeriod === null ? null : { accountId: target.payingAccountId, period: paymentPeriod });
    const preview =
        paymentPeriod === null ? null : describeInvoicePayment({ invoice, accountName: target.payingAccountName, paymentDate, closingConsolidated: statement.data?.closing.consolidated ?? null });

    /** Valida e paga; a recusa do núcleo vai para a data ou para o aviso geral. */
    const submit = (): void => {
        void form.handleSubmit(async ({ paymentDate: date }) => {
            setGeneralError(null);
            try {
                await pay.mutateAsync({ invoiceId: invoice.id, paymentDate: date });
                onClose();
            } catch (error) {
                reportRejection(
                    error,
                    { paymentDate: 'paymentDate' } as const,
                    (field, message) => {
                        form.setError(field, { type: 'core', message });
                    },
                    setGeneralError,
                );
            }
        })();
    };

    return (
        <Sheet open title={`Pagar fatura de ${formatMonthShort(invoice.period)}`} onClose={onClose}>
            <AppText className="text-13 text-muted">{target.creditCardName}</AppText>
            <View className="gap-0.5">
                <AppText className="text-13 text-muted">Valor a pagar</AppText>
                <AppText className="text-28 font-semibold">{formatMoney(invoice.amountDue, 'absolute')}</AppText>
            </View>
            <FormGroup>
                <FormRow first label="Pagar com">
                    <AppText>{target.payingAccountName}</AppText>
                </FormRow>
                <FormRow label="Data do pagamento" error={errors.paymentDate?.message}>
                    <Controller control={form.control} name="paymentDate" render={({ field }) => <RowDate label="Data do pagamento" value={field.value} onChange={field.onChange} />} />
                </FormRow>
            </FormGroup>
            {preview !== null && (
                <View accessibilityLiveRegion="polite" className="gap-1 rounded-10 bg-surface2 px-3 py-2.5">
                    <AppText className="text-13 text-ink2">{preview.statement}</AppText>
                    {preview.balanceChange !== null && <AppText className="text-13 text-ink2">{preview.balanceChange}</AppText>}
                </View>
            )}
            {generalError !== null && (
                <AppText accessibilityRole="alert" className="text-13 text-danger">
                    {generalError}
                </AppText>
            )}
            <Button label="Confirmar pagamento" busy={pay.isPending} onPress={submit} />
            {onPartial !== null && <Button label="Fazer pagamento parcial" variant="ghost" onPress={onPartial} />}
        </Sheet>
    );
}

/**
 * Pagamento parcial: valor, data, conta que pagou e subcategoria.
 * Regra de negócio (Fatura, database-design §4.7): é uma transferência negativa na fatura, já
 * paga, com a conta que pagou como destino — o `readPartialPaymentForm` monta o lançamento. A
 * conta sugerida é a pagadora do cartão, mas pode ser outra ativa: o parcial é um lançamento
 * comum, e não o vínculo da fatura com um extrato. A subcategoria é pedida porque toda transação
 * tem uma (§4.13).
 *
 * @param props.target Fatura em aberto que recebe o pagamento.
 * @param props.accounts Contas do perfil, das quais saem as opções de conta.
 * @param props.onClose Fecha a folha.
 * @return A folha.
 */
export function PartialPaymentSheet({ target, accounts, onClose }: { readonly target: InvoiceActionTarget; readonly accounts: readonly AccountResponse[]; readonly onClose: () => void }): ReactNode {
    const { profile } = useActiveProfile();
    const { invoice } = target;
    const options = partialPaymentAccountOptions(accounts);
    const categories = useCategoryTree({ profileId: profile.id });
    const partialTarget = { profileId: profile.id, creditCardId: target.creditCardId, invoicePeriod: invoice.period, amountDue: invoice.amountDue };
    /**
     * Valida pelo `readPartialPaymentForm`, que aplica o schema de `transactions.create`; os
     * valores seguem para o envio, que relê a entrada pronta.
     *
     * @param values Valores dos campos.
     * @return Os mesmos valores, ou o erro de cada campo no formato do react-hook-form.
     */
    const resolver: Resolver<PartialPaymentFormValues> = (values) => {
        const result = readPartialPaymentForm(values, partialTarget);
        return result.ok ? { values, errors: {} } : { values: {}, errors: toFieldErrors<PartialPaymentFormValues>(PARTIAL_PAYMENT_FIELDS, result.errors) };
    };
    const form = useForm<PartialPaymentFormValues>({
        defaultValues: { amount: '', paymentDate: currentDate(new Date()), accountId: defaultPartialPaymentAccount(options, target.payingAccountId), subCategoryId: '' },
        resolver,
    });
    const create = useCoreMutation('transactions.create');
    const [generalError, setGeneralError] = useState<string | null>(null);
    const { errors } = form.formState;
    const subCategories = subCategoryOptions(categories.data ?? [], '').map((option) => ({ value: option.id, label: option.label }));

    /** Valida e lança o pagamento; a recusa do núcleo vai para o campo que ela aponta. */
    const submit = (): void => {
        void form.handleSubmit(async (values) => {
            const result = readPartialPaymentForm(values, partialTarget);
            if (!result.ok) {
                return;
            }
            setGeneralError(null);
            try {
                await create.mutateAsync(result.input);
                onClose();
            } catch (error) {
                reportRejection(
                    error,
                    { value: 'amount', destinationAccountId: 'accountId', subCategoryId: 'subCategoryId', paymentDate: 'paymentDate' } as const,
                    (field, message) => {
                        form.setError(field, { type: 'core', message });
                    },
                    setGeneralError,
                );
            }
        })();
    };

    return (
        <Sheet open title={`Pagamento parcial da fatura de ${formatMonthShort(invoice.period)}`} onClose={onClose}>
            <AppText className="text-13 text-ink2">O valor sai da conta escolhida e abate a fatura, que continua em aberto. A pagar hoje: {formatMoney(invoice.amountDue, 'absolute')}.</AppText>
            <FormGroup>
                <FormRow first label={`Valor pago (${invoice.amountDue.currency})`} error={errors.amount?.message}>
                    <Controller
                        control={form.control}
                        name="amount"
                        render={({ field }) => (
                            <RowInput
                                label="Valor pago"
                                error={errors.amount?.message}
                                placeholder={formatMoney({ amount: 0, currency: invoice.amountDue.currency })}
                                keyboardType="numeric"
                                value={field.value}
                                onChangeText={field.onChange}
                                onBlur={field.onBlur}
                            />
                        )}
                    />
                </FormRow>
                <FormRow label="Data do pagamento" error={errors.paymentDate?.message}>
                    <Controller control={form.control} name="paymentDate" render={({ field }) => <RowDate label="Data do pagamento" value={field.value} onChange={field.onChange} />} />
                </FormRow>
                <FormRow label="Conta que pagou" error={errors.accountId?.message}>
                    <Controller
                        control={form.control}
                        name="accountId"
                        render={({ field }) => (
                            <RowSearchSelect
                                label="Conta que pagou"
                                options={options.map((account) => ({ value: account.id, label: account.name }))}
                                value={field.value === '' ? null : field.value}
                                onChange={field.onChange}
                                placeholder="Escolha a conta"
                                emptyText="Nenhuma conta encontrada."
                            />
                        )}
                    />
                </FormRow>
                <FormRow label="Subcategoria" error={errors.subCategoryId?.message}>
                    <Controller
                        control={form.control}
                        name="subCategoryId"
                        render={({ field }) => (
                            <RowSearchSelect
                                label="Subcategoria"
                                options={subCategories}
                                value={field.value === '' ? null : field.value}
                                onChange={field.onChange}
                                placeholder="Escolha a subcategoria"
                                emptyText="Nenhuma subcategoria encontrada."
                            />
                        )}
                    />
                </FormRow>
            </FormGroup>
            {generalError !== null && (
                <AppText accessibilityRole="alert" className="text-13 text-danger">
                    {generalError}
                </AppText>
            )}
            <Button label="Lançar pagamento" busy={create.isPending} onPress={submit} />
        </Sheet>
    );
}

/**
 * Confirmação de reabrir a fatura. Regra de negócio (Fatura, database-design §4.7): reabrir
 * desfaz o pagamento e devolve o saldo da conta; a folha diz de qual extrato o valor sai e quando
 * a fatura volta a pesar (`describeInvoiceReopening`).
 *
 * @param props.target Fatura paga a reabrir.
 * @param props.onClose Fecha a folha, depois de reabrir ou ao desistir.
 * @return A folha.
 */
export function ReopenInvoiceSheet({ target, onClose }: { readonly target: InvoiceActionTarget; readonly onClose: () => void }): ReactNode {
    const reopen = useCoreMutation('invoices.reopen');
    const { invoice } = target;
    return (
        <Sheet open title={`Reabrir a fatura de ${formatMonthShort(invoice.period)}?`} onClose={onClose}>
            <AppText className="text-ink2">{describeInvoiceReopening({ invoice, accountName: target.payingAccountName, dueDate: target.dueDate })}</AppText>
            {reopen.error !== null && (
                <AppText accessibilityRole="alert" className="text-13 text-danger">
                    {describeError(reopen.error.error).message}
                </AppText>
            )}
            <Button
                label="Reabrir fatura"
                busy={reopen.isPending}
                onPress={() => {
                    reopen.mutateAsync({ invoiceId: invoice.id }).then(onClose, () => undefined);
                }}
            />
            <Button label="Cancelar" variant="secondary" onPress={onClose} />
        </Sheet>
    );
}
