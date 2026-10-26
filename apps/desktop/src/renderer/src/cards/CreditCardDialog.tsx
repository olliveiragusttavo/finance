import { describeError, formatMoney, useCoreMutation } from '@finance/client';
import type { AccountResponse, CreditCardResponse } from '@finance/core';
import { useState, type ReactNode } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { toast } from 'sonner';
import { Combobox } from '@/components/Combobox';
import { FormDialog } from '@/components/entityUi';
import { Field, fieldAria, toFieldErrors } from '@/components/form';
import { Input } from '@/components/ui/input';
import { reportRejection } from '@/lib/coreErrorField';
import { useActiveProfile } from '@/shell/activeProfile';
import {
    closingDayWarning,
    CREDIT_CARD_FIELDS,
    creditCardFormFrom,
    emptyCreditCardForm,
    payingAccountOptions,
    readCreditCardForm,
    type CreditCardContent,
    type CreditCardFormValues,
} from './creditCardForm.ts';

/**
 * Desativa ou reativa um cartão, sem confirmação, pelo mesmo motivo das contas: as duas
 * ações se desfazem uma com a outra e não mudam faturas nem saldos (desktop-mvp-plan §5.1).
 * Fica fora da tela porque o "⋯" da fatura e a alternativa do alerta de exclusão o usam.
 *
 * @return A ação de alternar o cartão.
 */
export function useToggleCreditCard(): (creditCard: CreditCardResponse) => void {
    const disable = useCoreMutation('creditCards.disable');
    const enable = useCoreMutation('creditCards.enable');
    return (creditCard) => {
        const mutation = creditCard.disabled ? enable : disable;
        mutation.mutate(
            { id: creditCard.id },
            {
                onSuccess: () => {
                    toast.success(creditCard.disabled ? `Cartão ${creditCard.name} reativado.` : `Cartão ${creditCard.name} desativado. As faturas continuam nos relatórios.`);
                },
                onError: (error) => {
                    toast.error(describeError(error.error).message);
                },
            },
        );
    };
}

/** Campo do formulário de cada campo que o núcleo pode apontar numa recusa de cartão. */
const CREDIT_CARD_FIELD_BY_CORE_FIELD: Readonly<Partial<Record<string, keyof CreditCardFormValues>>> = {
    name: 'name',
    accountId: 'accountId',
    limit: 'limit',
    closingDay: 'closingDay',
    dueDay: 'dueDay',
};

/**
 * Criar ou editar cartão: nome, conta pagadora, limite, fechamento e vencimento. O cadastro do
 * cartão fica na própria tela Cartões ("+ Novo cartão" e "Editar cartão") desde que a tela
 * Cadastros saiu (desktop-mvp-plan Fase 13.11); um diálogo só, para que criar e editar validem do
 * mesmo jeito.
 *
 * @param props.creditCard Cartão a editar, ou `null` para criar um.
 * @param props.accounts Contas do perfil, das quais saem as opções de conta pagadora.
 * @param props.onClose Fecha o diálogo.
 * @param props.onCreated Recebe o cartão criado, para a tela Cartões abrir a fatura dele.
 * @return O diálogo com o formulário.
 */
export function CreditCardDialog({
    creditCard,
    accounts,
    onClose,
    onCreated,
}: {
    readonly creditCard: CreditCardResponse | null;
    readonly accounts: readonly AccountResponse[];
    readonly onClose: () => void;
    readonly onCreated?: (creditCard: CreditCardResponse) => void;
}): ReactNode {
    const { profile } = useActiveProfile();
    const options = payingAccountOptions(accounts, creditCard?.accountId ?? null);
    /**
     * Valida pelo `readCreditCardForm`, que aplica o schema das rotas de cartão, e entrega ao
     * envio o conteúdo já montado.
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

    const submit = form.handleSubmit(async (content) => {
        setGeneralError(null);
        try {
            if (creditCard === null) {
                // Criar antes e avisar depois, como no `AccountDialog`: a chamada opcional não
                // avaliaria o argumento sem quem avisar.
                const created = await create.mutateAsync({ ...content, profileId: profile.id });
                onCreated?.(created);
            } else {
                await update.mutateAsync({ ...content, id: creditCard.id });
            }
            toast.success(creditCard === null ? `Cartão ${content.name} criado.` : `Cartão ${content.name} salvo.`);
            onClose();
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
    });

    return (
        <FormDialog
            open
            onClose={onClose}
            title={creditCard === null ? 'Novo cartão' : `Editar ${creditCard.name}`}
            description={
                creditCard === null
                    ? 'A fatura de cada mês reúne as compras feitas depois do fechamento anterior.'
                    : 'Mudar o fechamento vale para as compras novas; as já lançadas continuam nas faturas em que estão.'
            }
            submitLabel={creditCard === null ? 'Criar cartão' : 'Salvar'}
            pending={create.isPending || update.isPending}
            error={generalError}
            onSubmit={(event) => {
                void submit(event);
            }}
        >
            <Field id="card-name" label="Nome" error={errors.name}>
                <Input id="card-name" placeholder="Ex.: Roxinho" autoFocus {...fieldAria('card-name', errors.name)} {...form.register('name')} />
            </Field>
            <Field id="card-account" label="Conta pagadora" error={errors.accountId}>
                <Controller
                    control={form.control}
                    name="accountId"
                    render={({ field }) => (
                        <Combobox
                            id="card-account"
                            options={options.map((account) => ({ value: account.id, label: account.disabled ? `${account.name} (desativada)` : account.name }))}
                            value={field.value}
                            onChange={field.onChange}
                            placeholder="Escolha a conta"
                            searchLabel="Buscar conta"
                            emptyText="Nenhuma conta encontrada."
                            aria={fieldAria('card-account', errors.accountId)}
                        />
                    )}
                />
            </Field>
            <div className="grid grid-cols-3 items-start gap-3">
                <Field id="card-limit" label={`Limite (${profile.currency})`} error={errors.limit}>
                    <Input
                        id="card-limit"
                        inputMode="decimal"
                        placeholder={formatMoney({ amount: 0, currency: profile.currency })}
                        className="text-right tabular-nums"
                        {...fieldAria('card-limit', errors.limit)}
                        {...form.register('limit')}
                    />
                </Field>
                <Field id="card-closing-day" label="Dia do fechamento" error={errors.closingDay} hint={closingWarning ?? undefined}>
                    <Input
                        id="card-closing-day"
                        inputMode="numeric"
                        placeholder="1 a 31"
                        className="tabular-nums"
                        {...fieldAria('card-closing-day', errors.closingDay, closingWarning !== null)}
                        {...form.register('closingDay')}
                    />
                </Field>
                <Field id="card-due-day" label="Dia do vencimento" error={errors.dueDay}>
                    <Input id="card-due-day" inputMode="numeric" placeholder="1 a 31" className="tabular-nums" {...fieldAria('card-due-day', errors.dueDay)} {...form.register('dueDay')} />
                </Field>
            </div>
        </FormDialog>
    );
}
