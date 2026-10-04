import { describeError, formatMoney, useCoreMutation, type CoreCallError } from '@finance/client';
import type { AccountListResponse, AccountResponse, CreditCardListResponse, CreditCardResponse } from '@finance/core';
import type { UseQueryResult } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { toast } from 'sonner';
import { Field, fieldAria, toFieldErrors } from '@/components/form';
import { EmptyState, QueryState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useActiveProfile } from '@/shell/activeProfile';
import { reportRejection } from './coreErrorField.ts';
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
import { CreditCardDeletionDialog } from './DeletionDialog.tsx';
import { FormDialog, RowAction, SectionHeader, StatusTag } from './registryUi.tsx';

/** Diálogo aberto na seção: criar, editar ou excluir um cartão. */
type CreditCardDialogState =
    | { readonly mode: 'create' }
    | { readonly mode: 'edit'; readonly creditCard: CreditCardResponse }
    | { readonly mode: 'delete'; readonly creditCard: CreditCardResponse };

/**
 * Cartões em Cadastros (desktop-mvp-plan Fase 6): lista com os desativados marcados, criar e
 * editar em diálogo, desativar, reativar e excluir. A fatura do mês fica na tela Cartões;
 * aqui está o cadastro.
 *
 * @param props.query Lista de cartões do perfil.
 * @param props.accounts Contas do perfil, para o nome da conta pagadora e as opções do
 * formulário.
 * @return A seção de cartões.
 */
export function CreditCardsSection({
    query,
    accounts,
}: {
    readonly query: UseQueryResult<CreditCardListResponse, CoreCallError>;
    readonly accounts: UseQueryResult<AccountListResponse, CoreCallError>;
}): ReactNode {
    const [dialog, setDialog] = useState<CreditCardDialogState | null>(null);
    const toggle = useToggleCreditCard();
    const close = (): void => {
        setDialog(null);
    };
    const accountList = accounts.data?.accounts ?? [];
    // Regra de negócio (Cartões): todo cartão é pago por uma conta ativa do perfil; sem
    // nenhuma, não há o que escolher, e o botão explica em vez de abrir um formulário inútil.
    const hasActiveAccount = accountList.some((account) => !account.disabled);

    return (
        <>
            <SectionHeader
                title="Cartões"
                description="Todo cartão é pago por uma conta do perfil; as faturas pagas entram no extrato dela."
                actions={
                    <Button
                        disabled={!hasActiveAccount}
                        title={hasActiveAccount ? undefined : 'Reative ou crie uma conta para pagar o cartão.'}
                        onClick={() => {
                            setDialog({ mode: 'create' });
                        }}
                    >
                        + Novo cartão
                    </Button>
                }
            />
            <QueryState query={query}>
                {(list) =>
                    list.creditCards.length === 0 ? (
                        <EmptyState
                            title="Nenhum cartão"
                            description={hasActiveAccount ? 'Cadastre um cartão para lançar compras nas faturas.' : 'Para cadastrar um cartão, o perfil precisa de uma conta ativa que pague as faturas.'}
                        />
                    ) : (
                        <ul aria-label="Cartões" className="rounded-10 border border-line bg-surface">
                            {list.creditCards.map((creditCard) => (
                                <li key={creditCard.id} className="flex items-center justify-between gap-4 border-t border-line2 px-5 py-3 first:border-t-0">
                                    <div className="flex min-w-0 flex-col gap-0.5">
                                        <span className="flex items-center gap-2 font-medium">
                                            {creditCard.name}
                                            {creditCard.disabled && <StatusTag tone="warn">Desativado</StatusTag>}
                                        </span>
                                        <span className="text-12 text-muted">
                                            Paga por {accountName(accountList, creditCard.accountId)} · Limite <span className="tabular-nums">{formatMoney(creditCard.limit)}</span> · Fecha dia{' '}
                                            {creditCard.closingDay} · Vence dia {creditCard.dueDay}
                                        </span>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        <RowAction
                                            label="Editar"
                                            accessibleName={`Editar ${creditCard.name}`}
                                            onClick={() => {
                                                setDialog({ mode: 'edit', creditCard });
                                            }}
                                        />
                                        <RowAction
                                            label={creditCard.disabled ? 'Reativar' : 'Desativar'}
                                            accessibleName={`${creditCard.disabled ? 'Reativar' : 'Desativar'} ${creditCard.name}`}
                                            onClick={() => {
                                                toggle(creditCard);
                                            }}
                                        />
                                        <RowAction
                                            label="Excluir"
                                            accessibleName={`Excluir ${creditCard.name}`}
                                            danger
                                            onClick={() => {
                                                setDialog({ mode: 'delete', creditCard });
                                            }}
                                        />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )
                }
            </QueryState>
            {dialog?.mode === 'create' && <CreditCardDialog creditCard={null} accounts={accountList} onClose={close} />}
            {dialog?.mode === 'edit' && <CreditCardDialog key={dialog.creditCard.id} creditCard={dialog.creditCard} accounts={accountList} onClose={close} />}
            {dialog?.mode === 'delete' && (
                <CreditCardDeletionDialog
                    creditCard={dialog.creditCard}
                    onClose={close}
                    onDisableInstead={
                        dialog.creditCard.disabled
                            ? undefined
                            : () => {
                                  toggle(dialog.creditCard);
                              }
                    }
                />
            )}
        </>
    );
}

/**
 * @param accounts Contas do perfil.
 * @param accountId Conta pagadora do cartão.
 * @return O nome da conta; um traço enquanto a lista de contas ainda carrega.
 */
function accountName(accounts: readonly AccountResponse[], accountId: string): string {
    return accounts.find((account) => account.id === accountId)?.name ?? '—';
}

/**
 * Desativa ou reativa um cartão, sem confirmação, pelo mesmo motivo das contas: as duas
 * ações se desfazem uma com a outra e não mudam faturas nem saldos (desktop-mvp-plan §5.1).
 *
 * @return A ação de alternar o cartão.
 */
function useToggleCreditCard(): (creditCard: CreditCardResponse) => void {
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
 * Criar ou editar cartão: nome, conta pagadora, limite, fechamento e vencimento.
 *
 * @param props.creditCard Cartão a editar, ou `null` para criar um.
 * @param props.accounts Contas do perfil, das quais saem as opções de conta pagadora.
 * @param props.onClose Fecha o diálogo.
 * @return O diálogo com o formulário.
 */
function CreditCardDialog({
    creditCard,
    accounts,
    onClose,
}: {
    readonly creditCard: CreditCardResponse | null;
    readonly accounts: readonly AccountResponse[];
    readonly onClose: () => void;
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
                await create.mutateAsync({ ...content, profileId: profile.id });
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
                        <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger id="card-account" className="w-full" {...fieldAria('card-account', errors.accountId)}>
                                <SelectValue placeholder="Escolha a conta" />
                            </SelectTrigger>
                            <SelectContent>
                                {options.map((account) => (
                                    <SelectItem key={account.id} value={account.id}>
                                        {account.disabled ? `${account.name} (desativada)` : account.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
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
