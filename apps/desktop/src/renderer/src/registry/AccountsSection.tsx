import { describeError, formatAccountType, formatMoney, useCoreMutation, type CoreCallError } from '@finance/client';
import type { AccountListResponse, AccountResponse } from '@finance/core';
import type { UseQueryResult } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { toast } from 'sonner';
import { Field, fieldAria, toFieldErrors } from '@/components/form';
import { EmptyState, QueryState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { currencyOptionsWith } from '@/lib/currencies';
import { useActiveProfile } from '@/shell/activeProfile';
import { ACCOUNT_FIELDS, accountFormFrom, emptyAccountForm, readAccountForm, type AccountContent, type AccountFormValues } from './accountForm.ts';
import { reportRejection } from './coreErrorField.ts';
import { AccountDeletionDialog } from './DeletionDialog.tsx';
import { FormDialog, RowAction, SectionHeader, StatusTag } from './registryUi.tsx';

/** Tipos de conta, na ordem do primeiro uso. */
const ACCOUNT_TYPES: readonly AccountFormValues['type'][] = ['checking', 'investment'];

/** Diálogo aberto na seção: criar, editar ou excluir uma conta. */
type AccountDialogState = { readonly mode: 'create' } | { readonly mode: 'edit'; readonly account: AccountResponse } | { readonly mode: 'delete'; readonly account: AccountResponse };

/**
 * Contas em Cadastros (desktop-mvp-plan Fase 6): lista com as desativadas e as fora do total
 * marcadas, criar e editar em diálogo, desativar, reativar e excluir. Os saldos do mês ficam
 * na tela Contas; aqui está o cadastro.
 *
 * @param props.query Lista de contas do perfil, a mesma que conta o item na lista lateral.
 * @return A seção de contas.
 */
export function AccountsSection({ query }: { readonly query: UseQueryResult<AccountListResponse, CoreCallError> }): ReactNode {
    const [dialog, setDialog] = useState<AccountDialogState | null>(null);
    const toggle = useToggleAccount();
    const close = (): void => {
        setDialog(null);
    };

    return (
        <>
            <SectionHeader
                title="Contas"
                description="Desativar tira a conta dos lançamentos novos sem mudar o histórico nem os saldos."
                actions={
                    <Button
                        onClick={() => {
                            setDialog({ mode: 'create' });
                        }}
                    >
                        + Nova conta
                    </Button>
                }
            />
            <QueryState query={query}>
                {(list) =>
                    list.accounts.length === 0 ? (
                        <EmptyState title="Nenhuma conta" description="Crie uma conta para começar a lançar." />
                    ) : (
                        <ul aria-label="Contas" className="rounded-10 border border-line bg-surface">
                            {list.accounts.map((account) => (
                                <li key={account.id} className="flex items-center justify-between gap-4 border-t border-line2 px-5 py-3 first:border-t-0">
                                    <div className="flex min-w-0 flex-col gap-0.5">
                                        <span className="flex items-center gap-2 font-medium">
                                            {account.name}
                                            {account.disabled && <StatusTag tone="warn">Desativada</StatusTag>}
                                            {!account.considerBalance && <StatusTag tone="neutral">Fora do total</StatusTag>}
                                        </span>
                                        <span className="text-12 text-muted">
                                            {formatAccountType(account.type)} · {account.currency} · Saldo inicial <span className="tabular-nums">{formatMoney(account.openingBalance)}</span>
                                        </span>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        <RowAction
                                            label="Editar"
                                            accessibleName={`Editar ${account.name}`}
                                            onClick={() => {
                                                setDialog({ mode: 'edit', account });
                                            }}
                                        />
                                        <RowAction
                                            label={account.disabled ? 'Reativar' : 'Desativar'}
                                            accessibleName={`${account.disabled ? 'Reativar' : 'Desativar'} ${account.name}`}
                                            onClick={() => {
                                                toggle(account);
                                            }}
                                        />
                                        <RowAction
                                            label="Excluir"
                                            accessibleName={`Excluir ${account.name}`}
                                            danger
                                            onClick={() => {
                                                setDialog({ mode: 'delete', account });
                                            }}
                                        />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )
                }
            </QueryState>
            {dialog?.mode === 'create' && <AccountDialog account={null} onClose={close} />}
            {dialog?.mode === 'edit' && <AccountDialog key={dialog.account.id} account={dialog.account} onClose={close} />}
            {dialog?.mode === 'delete' && (
                <AccountDeletionDialog
                    account={dialog.account}
                    onClose={close}
                    onDisableInstead={
                        dialog.account.disabled
                            ? undefined
                            : () => {
                                  toggle(dialog.account);
                              }
                    }
                />
            )}
        </>
    );
}

/**
 * Desativa ou reativa uma conta, conforme a situação atual. Sem confirmação: as duas ações
 * se desfazem uma com a outra e não mudam nenhum saldo (desktop-mvp-plan §5.1). O aviso
 * lembra o que desativar preserva, para que ninguém desative achando que perdeu o histórico.
 *
 * @return A ação de alternar a conta.
 */
function useToggleAccount(): (account: AccountResponse) => void {
    const disable = useCoreMutation('accounts.disable');
    const enable = useCoreMutation('accounts.enable');
    return (account) => {
        const mutation = account.disabled ? enable : disable;
        mutation.mutate(
            { id: account.id },
            {
                onSuccess: () => {
                    toast.success(account.disabled ? `Conta ${account.name} reativada.` : `Conta ${account.name} desativada. Ela continua nos extratos e relatórios.`);
                },
                onError: (error) => {
                    toast.error(describeError(error.error).message);
                },
            },
        );
    };
}

/**
 * Campo do formulário de cada campo que o núcleo pode apontar numa recusa de conta.
 */
const ACCOUNT_FIELD_BY_CORE_FIELD: Readonly<Partial<Record<string, keyof AccountFormValues>>> = {
    name: 'name',
    type: 'type',
    currencyLabel: 'currency',
    considerBalance: 'considerBalance',
    openingBalance: 'openingBalance',
};

/**
 * Criar ou editar conta: nome, tipo, moeda, saldo inicial e se entra no total.
 *
 * @param props.account Conta a editar, ou `null` para criar uma.
 * @param props.onClose Fecha o diálogo.
 * @return O diálogo com o formulário.
 */
function AccountDialog({ account, onClose }: { readonly account: AccountResponse | null; readonly onClose: () => void }): ReactNode {
    const { profile } = useActiveProfile();
    /**
     * Valida pelo `readAccountForm`, que aplica o schema das rotas de conta, e entrega ao envio
     * o conteúdo já montado — o que foi validado é exatamente o que vai ao núcleo.
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

    const submit = form.handleSubmit(async (content) => {
        setGeneralError(null);
        try {
            if (account === null) {
                await create.mutateAsync({ ...content, profileId: profile.id });
            } else {
                await update.mutateAsync({ ...content, id: account.id });
            }
            toast.success(account === null ? `Conta ${content.name} criada.` : `Conta ${content.name} salva.`);
            onClose();
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
    });

    return (
        <FormDialog
            open
            onClose={onClose}
            title={account === null ? 'Nova conta' : `Editar ${account.name}`}
            description="O saldo inicial é o que a conta já tinha antes do primeiro mês registrado."
            submitLabel={account === null ? 'Criar conta' : 'Salvar'}
            pending={create.isPending || update.isPending}
            error={generalError}
            onSubmit={(event) => {
                void submit(event);
            }}
        >
            <Field id="account-name" label="Nome" error={errors.name}>
                <Input id="account-name" placeholder="Ex.: Nubank" autoFocus {...fieldAria('account-name', errors.name)} {...form.register('name')} />
            </Field>
            <div className="grid grid-cols-2 items-start gap-3">
                <Field id="account-type" label="Tipo" error={errors.type}>
                    <Controller
                        control={form.control}
                        name="type"
                        render={({ field }) => (
                            <Select
                                value={field.value}
                                onValueChange={(value) => {
                                    const type = ACCOUNT_TYPES.find((candidate) => candidate === value);
                                    if (type !== undefined) {
                                        field.onChange(type);
                                    }
                                }}
                            >
                                <SelectTrigger id="account-type" className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {ACCOUNT_TYPES.map((type) => (
                                        <SelectItem key={type} value={type}>
                                            {formatAccountType(type)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    />
                </Field>
                <Field id="account-currency" label="Moeda da conta" error={errors.currency}>
                    <Controller
                        control={form.control}
                        name="currency"
                        render={({ field }) => (
                            <Select value={field.value} onValueChange={field.onChange}>
                                <SelectTrigger id="account-currency" className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {currencyOptionsWith(account?.currency ?? profile.currency).map((option) => (
                                        <SelectItem key={option.code} value={option.code}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    />
                </Field>
            </div>
            <Field
                id="account-opening-balance"
                label={`Saldo inicial (${profile.currency})`}
                error={errors.openingBalance}
                hint={account === null ? undefined : 'Mudar o saldo inicial recalcula os saldos de todos os meses da conta.'}
            >
                <Input
                    id="account-opening-balance"
                    inputMode="decimal"
                    placeholder={formatMoney({ amount: 0, currency: profile.currency })}
                    className="text-right tabular-nums"
                    {...fieldAria('account-opening-balance', errors.openingBalance, account !== null)}
                    {...form.register('openingBalance')}
                />
            </Field>
            <div className="flex items-start gap-2 text-14">
                <input id="account-consider" type="checkbox" className="mt-1 accent-accent" aria-describedby="account-consider-hint" {...form.register('considerBalance')} />
                <div className="flex flex-col gap-0.5">
                    <label htmlFor="account-consider">Considerar no total</label>
                    <p id="account-consider-hint" className="text-12 text-muted">
                        Fora do total, a conta continua nas listas e nos relatórios, mas não soma no consolidado nem no previsto do perfil.
                    </p>
                </div>
            </div>
        </FormDialog>
    );
}
