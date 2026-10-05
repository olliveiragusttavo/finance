import { describeError, describeInvoicePayment, describeInvoiceReopening, formatMoney, formatMonthShort, useCategoryTree, useCoreMutation, useStatement } from '@finance/client';
import type { AccountResponse, InvoiceResponse } from '@finance/core';
import { useState, type ReactNode } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { toast } from 'sonner';
import { Field, fieldAria, toFieldErrors } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { reportRejection } from '@/registry/coreErrorField';
import { FormDialog } from '@/registry/registryUi';
import { useActiveProfile } from '@/shell/activeProfile';
import { currentDate } from '@/shell/referenceMonth';
import {
    defaultPartialPaymentAccount,
    PARTIAL_PAYMENT_FIELDS,
    partialPaymentAccountOptions,
    PAY_INVOICE_FIELDS,
    periodOfDate,
    readPartialPaymentForm,
    readPayInvoiceForm,
    type PartialPaymentFormValues,
    type PayInvoiceFormValues,
} from './invoiceForms.ts';

/*
 * Ações sobre a fatura na tela Cartões (desktop-mvp-plan Fase 8): pagar, pagamento parcial e
 * reabrir. Cada uma diz antes o que muda no saldo da conta, porque as três mexem no extrato de
 * uma conta que não está na tela (brief §4, regra 9: nada de aviso genérico).
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
 * Pagar a fatura inteira (mockup `MobilePagarFatura`): valor a pagar, conta pagadora e data, e
 * a prévia do saldo da conta antes de confirmar.
 * Regra de negócio (Fatura): quem paga é sempre a conta pagadora do cartão — o vínculo da
 * fatura é com o extrato dela (database-design §4.7) —, então a conta aparece, mas não se
 * escolhe aqui; trocar é editar o cartão. A data sugerida é hoje.
 *
 * @param props.target Fatura em aberto a pagar.
 * @param props.onClose Fecha o diálogo, depois de pagar ou ao desistir.
 * @return O diálogo.
 */
export function PayInvoiceDialog({ target, onClose }: { readonly target: InvoiceActionTarget; readonly onClose: () => void }): ReactNode {
    const { invoice } = target;
    /**
     * Valida pelo `readPayInvoiceForm`, que aplica o schema de `invoices.pay`.
     *
     * @param values Valores dos campos.
     * @return A entrada da rota, ou o erro do campo no formato do react-hook-form.
     */
    const resolver: Resolver<PayInvoiceFormValues, unknown, PayInvoiceFormValues> = (values) => {
        const result = readPayInvoiceForm(values, invoice.id);
        return result.ok ? { values: { paymentDate: result.input.paymentDate }, errors: {} } : { values: {}, errors: toFieldErrors<PayInvoiceFormValues>(PAY_INVOICE_FIELDS, result.errors) };
    };
    const form = useForm<PayInvoiceFormValues, unknown, PayInvoiceFormValues>({ defaultValues: { paymentDate: currentDate(new Date()) }, resolver });
    const pay = useCoreMutation('invoices.pay');
    const [generalError, setGeneralError] = useState<string | null>(null);
    const { errors } = form.formState;
    const paymentDate = form.watch('paymentDate');
    const paymentPeriod = periodOfDate(paymentDate);
    // O extrato do mês do pagamento dá o consolidado de antes; com a data incompleta, a prévia
    // mostra só para qual extrato a fatura vai, sem o saldo.
    const statement = useStatement(paymentPeriod === null ? null : { accountId: target.payingAccountId, period: paymentPeriod });
    const preview =
        paymentPeriod === null
            ? null
            : describeInvoicePayment({ invoice, accountName: target.payingAccountName, paymentDate, closingConsolidated: statement.data?.closing.consolidated ?? null });

    const submit = form.handleSubmit(async ({ paymentDate: date }) => {
        setGeneralError(null);
        try {
            await pay.mutateAsync({ invoiceId: invoice.id, paymentDate: date });
            toast.success(`Fatura de ${formatMonthShort(invoice.period)} do cartão ${target.creditCardName} paga.`);
            onClose();
        } catch (error) {
            reportRejection(
                error,
                { paymentDate: 'paymentDate' },
                (field, message) => {
                    form.setError(field, { type: 'core', message });
                },
                setGeneralError,
            );
        }
    });

    return (
        <FormDialog
            open
            onClose={onClose}
            title={`Pagar fatura de ${formatMonthShort(invoice.period)}`}
            description={target.creditCardName}
            submitLabel="Confirmar pagamento"
            pending={pay.isPending}
            error={generalError}
            onSubmit={(event) => {
                void submit(event);
            }}
        >
            <dl className="flex flex-col gap-2 text-13">
                <div className="flex items-baseline justify-between">
                    <dt className="text-muted">Valor a pagar</dt>
                    <dd className="text-22 font-semibold tabular-nums">{formatMoney(invoice.amountDue, 'absolute')}</dd>
                </div>
                <div className="flex items-baseline justify-between">
                    <dt className="text-muted">Pagar com</dt>
                    <dd>{target.payingAccountName}</dd>
                </div>
            </dl>
            <Field id="pay-date" label="Data do pagamento" error={errors.paymentDate}>
                <Input id="pay-date" type="date" className="tabular-nums" {...fieldAria('pay-date', errors.paymentDate)} {...form.register('paymentDate')} />
            </Field>
            {preview !== null && (
                <p className="rounded-8 bg-surface2 px-3 py-2.5 text-13 text-ink2" aria-live="polite">
                    {preview.statement}
                    {preview.balanceChange !== null && (
                        <>
                            <br />
                            <span className="tabular-nums">{preview.balanceChange}</span>
                        </>
                    )}
                </p>
            )}
        </FormDialog>
    );
}

/**
 * Pagamento parcial (desktop-mvp-plan Fase 8): valor, data, conta que pagou e subcategoria.
 * Regra de negócio (Fatura, database-design §4.7): é uma transferência negativa na fatura, já
 * paga, com a conta que pagou como destino — o `readPartialPaymentForm` monta o lançamento. A
 * conta sugerida é a pagadora do cartão, mas pode ser outra ativa: o parcial é um lançamento
 * comum, e não o vínculo da fatura com um extrato. A subcategoria é pedida porque toda
 * transação tem uma (§4.13); transferências ficam fora do relatório por categoria (R2).
 *
 * @param props.target Fatura em aberto que recebe o pagamento.
 * @param props.accounts Contas do perfil, das quais saem as opções de conta.
 * @param props.onClose Fecha o diálogo.
 * @return O diálogo.
 */
export function PartialPaymentDialog({
    target,
    accounts,
    onClose,
}: {
    readonly target: InvoiceActionTarget;
    readonly accounts: readonly AccountResponse[];
    readonly onClose: () => void;
}): ReactNode {
    const { profile } = useActiveProfile();
    const { invoice } = target;
    const options = partialPaymentAccountOptions(accounts);
    const categories = useCategoryTree({ profileId: profile.id });
    const partialTarget = { profileId: profile.id, creditCardId: target.creditCardId, invoicePeriod: invoice.period, amountDue: invoice.amountDue };
    /**
     * Valida pelo `readPartialPaymentForm`, que aplica o schema de `transactions.create`; os
     * valores dos campos seguem para o envio, que relê a entrada pronta.
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

    const submit = form.handleSubmit(async (values) => {
        const result = readPartialPaymentForm(values, partialTarget);
        if (!result.ok) {
            return;
        }
        setGeneralError(null);
        try {
            await create.mutateAsync(result.input);
            toast.success(`Pagamento parcial lançado na fatura de ${formatMonthShort(invoice.period)} do cartão ${target.creditCardName}.`);
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
    });

    return (
        <FormDialog
            open
            onClose={onClose}
            title={`Pagamento parcial da fatura de ${formatMonthShort(invoice.period)}`}
            description={`O valor sai da conta escolhida e abate a fatura, que continua em aberto. A pagar hoje: ${formatMoney(invoice.amountDue, 'absolute')}.`}
            submitLabel="Lançar pagamento"
            pending={create.isPending}
            error={generalError}
            onSubmit={(event) => {
                void submit(event);
            }}
        >
            <div className="grid grid-cols-2 items-start gap-3">
                <Field id="partial-amount" label={`Valor pago (${invoice.amountDue.currency})`} error={errors.amount}>
                    <Input
                        id="partial-amount"
                        inputMode="decimal"
                        placeholder={formatMoney({ amount: 0, currency: invoice.amountDue.currency })}
                        className="text-right tabular-nums"
                        autoFocus
                        {...fieldAria('partial-amount', errors.amount)}
                        {...form.register('amount')}
                    />
                </Field>
                <Field id="partial-date" label="Data do pagamento" error={errors.paymentDate}>
                    <Input id="partial-date" type="date" className="tabular-nums" {...fieldAria('partial-date', errors.paymentDate)} {...form.register('paymentDate')} />
                </Field>
            </div>
            <Field id="partial-account" label="Conta que pagou" error={errors.accountId}>
                <Controller
                    control={form.control}
                    name="accountId"
                    render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger id="partial-account" className="w-full" {...fieldAria('partial-account', errors.accountId)}>
                                <SelectValue placeholder="Escolha a conta" />
                            </SelectTrigger>
                            <SelectContent>
                                {options.map((account) => (
                                    <SelectItem key={account.id} value={account.id}>
                                        {account.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                />
            </Field>
            <Field id="partial-sub-category" label="Subcategoria" error={errors.subCategoryId}>
                <Controller
                    control={form.control}
                    name="subCategoryId"
                    render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger id="partial-sub-category" className="w-full" {...fieldAria('partial-sub-category', errors.subCategoryId)}>
                                <SelectValue placeholder={categories.isPending ? 'Carregando…' : 'Escolha a subcategoria'} />
                            </SelectTrigger>
                            <SelectContent>
                                {(categories.data ?? []).map((category) =>
                                    category.subCategories.length === 0 ? null : (
                                        <SelectGroup key={category.id}>
                                            <SelectLabel>{category.name}</SelectLabel>
                                            {category.subCategories.map((sub) => (
                                                <SelectItem key={sub.id} value={sub.id}>
                                                    {sub.name}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    ),
                                )}
                            </SelectContent>
                        </Select>
                    )}
                />
            </Field>
        </FormDialog>
    );
}

/**
 * Confirmação de reabrir a fatura. Regra de negócio (Fatura, database-design §4.7): reabrir
 * desfaz o pagamento e devolve o saldo da conta; o alerta diz de qual extrato o valor sai e
 * quando a fatura volta a pesar, como pede o plano ("explicando que o saldo da conta volta").
 *
 * @param props.target Fatura paga a reabrir.
 * @param props.onClose Fecha o alerta, depois de reabrir ou ao desistir.
 * @return O alerta.
 */
export function ReopenInvoiceDialog({ target, onClose }: { readonly target: InvoiceActionTarget; readonly onClose: () => void }): ReactNode {
    const reopen = useCoreMutation('invoices.reopen');
    const { invoice } = target;
    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
        >
            <DialogContent showCloseButton={false}>
                <DialogHeader>
                    <DialogTitle>Reabrir a fatura de {formatMonthShort(invoice.period)}?</DialogTitle>
                    <DialogDescription>{describeInvoiceReopening({ invoice, accountName: target.payingAccountName, dueDate: target.dueDate })}</DialogDescription>
                </DialogHeader>
                {reopen.error !== null && (
                    <p role="alert" className="text-13 text-danger">
                        {describeError(reopen.error.error).message}
                    </p>
                )}
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>
                        Cancelar
                    </Button>
                    <Button
                        type="button"
                        disabled={reopen.isPending}
                        onClick={() => {
                            reopen.mutate(
                                { invoiceId: invoice.id },
                                {
                                    onSuccess: () => {
                                        toast.success(`Fatura de ${formatMonthShort(invoice.period)} do cartão ${target.creditCardName} reaberta.`);
                                        onClose();
                                    },
                                },
                            );
                        }}
                    >
                        {reopen.isPending ? 'Reabrindo…' : 'Reabrir fatura'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
