import { describeError, formatAccountType, formatMoney, useCoreMutation } from '@finance/client';
import type { AccountResponse } from '@finance/core';
import { useState, type ReactNode } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { toast } from 'sonner';
import { FormDialog } from '@/components/entityUi';
import { Field, fieldAria, toFieldErrors } from '@/components/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { reportRejection } from '@/lib/coreErrorField';
import { currencyOptionsWith } from '@/lib/currencies';
import { useActiveProfile } from '@/shell/activeProfile';
import { ACCOUNT_FIELDS, accountFormFrom, emptyAccountForm, readAccountForm, type AccountContent, type AccountFormValues } from './accountForm.ts';

/** Tipos de conta, na ordem do primeiro uso. */
const ACCOUNT_TYPES: readonly AccountFormValues['type'][] = ['checking', 'investment'];

/**
 * Desativa ou reativa uma conta, conforme a situação atual. Sem confirmação: as duas ações
 * se desfazem uma com a outra e não mudam nenhum saldo (desktop-mvp-plan §5.1). O aviso
 * lembra o que desativar preserva, para que ninguém desative achando que perdeu o histórico.
 * Fica fora da tela porque o "⋯" do extrato e a alternativa do alerta de exclusão o usam.
 *
 * @return A ação de alternar a conta.
 */
export function useToggleAccount(): (account: AccountResponse) => void {
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
 * Criar ou editar conta: nome, tipo, moeda, saldo inicial e se entra no total. O cadastro da
 * conta fica na própria tela Contas ("+ Nova conta" e "Editar conta", mockup `DesktopContas`)
 * desde que a tela Cadastros saiu (desktop-mvp-plan Fase 13.11); um diálogo só, para que criar e
 * editar validem e expliquem o cadastro do mesmo jeito.
 *
 * @param props.account Conta a editar, ou `null` para criar uma.
 * @param props.onClose Fecha o diálogo.
 * @param props.onCreated Recebe a conta criada, para a tela Contas abrir o extrato dela.
 * @return O diálogo com o formulário.
 */
export function AccountDialog({
    account,
    onClose,
    onCreated,
}: {
    readonly account: AccountResponse | null;
    readonly onClose: () => void;
    readonly onCreated?: (account: AccountResponse) => void;
}): ReactNode {
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
                // Criar antes e avisar depois: dentro de `onCreated?.(…)` a criação não rodaria
                // quando não há quem avisar, porque a chamada opcional não avalia o argumento.
                const created = await create.mutateAsync({ ...content, profileId: profile.id });
                onCreated?.(created);
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
