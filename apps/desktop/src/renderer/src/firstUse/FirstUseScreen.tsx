import { callOrThrow, describeError, formatAccountType, formatMoney, formatProfileType, invalidateAfter, useCoreClient, type CoreCallError } from '@finance/client';
import type { OnboardingResponse } from '@finance/core';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Controller, useForm, type FieldError, type FieldErrors, type Resolver } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import { useDevicePreferences } from '@/lib/devicePreferences';
import { ThemeMenu } from '@/shell/ThemeMenu';
import {
    CURRENCY_OPTIONS,
    EMPTY_ONBOARDING_FORM,
    ONBOARDING_FIELDS,
    readOnboardingForm,
    type OnboardingErrors,
    type OnboardingFormValues,
    type OnboardingInput,
} from './onboardingForm.ts';

/** Tipos de perfil, na ordem do mockup. */
const PROFILE_TYPES: readonly OnboardingFormValues['profileType'][] = ['personal', 'business'];

/** Tipos de conta, na ordem do mockup. */
const ACCOUNT_TYPES: readonly OnboardingFormValues['accountType'][] = ['checking', 'investment'];

/**
 * Primeiro uso (mockup `DesktopPrimeiroUso`; desktop-mvp-plan Fase 5): o banco sem perfil
 * abre aqui, fora do shell, porque toda tela do shell lê dados de um perfil. Cria o perfil e a
 * primeira conta juntos pelo `onboarding.start` — o primeiro uso não pode deixar perfil sem
 * conta — e, ao concluir, o app entra na Visão geral do mês atual.
 *
 * @return A tela de boas-vindas com o formulário e o cartão de "entrar num grupo".
 */
export function FirstUseScreen(): ReactNode {
    return (
        <div className="flex h-full flex-col items-center overflow-y-auto px-8 pt-6 pb-12">
            <header className="flex w-full max-w-260 items-center justify-between">
                <span className="text-17 font-semibold">Finanças</span>
                <ThemeMenu />
            </header>
            <main className="mt-14 flex w-full max-w-260 flex-col gap-7">
                <div className="flex flex-col gap-2">
                    <h1 className="text-30 font-semibold">Vamos começar</h1>
                    <p className="text-15 text-muted">Seus dados ficam só neste aparelho e nos dispositivos que você parear. Não há conta nem nuvem.</p>
                </div>
                <div className="grid grid-cols-5 items-start gap-5">
                    <StartFromScratch />
                    <JoinGroup />
                </div>
            </main>
        </div>
    );
}

/**
 * Valida pelo `readOnboardingForm`, que aplica o schema do núcleo, e entrega ao envio a entrada
 * da rota já montada — o envio não converte nada de novo, então o que foi validado é
 * exatamente o que vai ao núcleo.
 *
 * @param values Valores dos campos.
 * @return A entrada da rota, ou o erro de cada campo no formato do react-hook-form.
 */
const onboardingResolver: Resolver<OnboardingFormValues, unknown, OnboardingInput> = (values) => {
    const result = readOnboardingForm(values);
    return result.ok ? { values: result.input, errors: {} } : { values: {}, errors: toFieldErrors(result.errors) };
};

/**
 * @param errors Mensagem por campo, como o formulário as leu.
 * @return Os mesmos erros no formato do react-hook-form, que os associa aos campos.
 */
function toFieldErrors(errors: OnboardingErrors): FieldErrors<OnboardingFormValues> {
    return ONBOARDING_FIELDS.reduce<FieldErrors<OnboardingFormValues>>((fieldErrors, field) => {
        const message = errors[field];
        return message === undefined ? fieldErrors : { ...fieldErrors, [field]: { type: 'validate', message } };
    }, {});
}

/**
 * Chama o `onboarding.start` e prepara a entrada no app. O perfil criado vira o aberto no
 * aparelho, e a URL e o último mês voltam ao padrão, para que o shell abra na Visão geral do
 * mês atual mesmo que o aparelho guarde a rota ou o mês de um banco anterior. Isso acontece
 * **antes** de invalidar os perfis: é a invalidação que monta o shell, e ele lê as duas coisas
 * ao montar.
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
            window.history.replaceState(null, '', '#/');
            await invalidateAfter(queryClient, 'onboarding.start');
        },
    });
}

/**
 * "Começar do zero": perfil (nome, tipo, moeda) e primeira conta (nome, tipo, saldo inicial).
 * A moeda da conta não é perguntada: a conta nasce na moeda do perfil, o caso comum, e quem
 * precisar de outra muda em Cadastros.
 *
 * @return O cartão com o formulário.
 */
function StartFromScratch(): ReactNode {
    const form = useForm<OnboardingFormValues, unknown, OnboardingInput>({ defaultValues: EMPTY_ONBOARDING_FORM, resolver: onboardingResolver });
    const start = useStartOnboarding();
    const { errors } = form.formState;
    const currency = form.watch('currency');

    return (
        <section aria-labelledby="start-title" className="col-span-3 flex flex-col gap-4 rounded-12 border border-line bg-surface p-7">
            <h2 id="start-title" className="text-18 font-semibold">
                Começar do zero
            </h2>
            <form
                noValidate
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                    void form.handleSubmit((input) => {
                        start.mutate(input);
                    })(event);
                }}
            >
                <SectionTitle>Perfil</SectionTitle>
                <Field id="profile-name" label="Nome do perfil" error={errors.profileName}>
                    <Input id="profile-name" placeholder="Ex.: Pessoal" autoFocus {...fieldAria('profile-name', errors.profileName)} {...form.register('profileName')} />
                </Field>
                <div className="flex items-start gap-6">
                    <fieldset className="flex flex-col gap-1 text-13">
                        <legend className="text-muted">Tipo</legend>
                        <div className="flex items-center gap-4 pt-1.5">
                            {PROFILE_TYPES.map((type) => (
                                <label key={type} className="flex items-center gap-1.5 text-14">
                                    <input type="radio" value={type} className="accent-accent" {...form.register('profileType')} />
                                    {formatProfileType(type)}
                                </label>
                            ))}
                        </div>
                    </fieldset>
                    <Field id="currency" label="Moeda" error={errors.currency} className="flex-1">
                        <Controller
                            control={form.control}
                            name="currency"
                            render={({ field }) => (
                                <Select value={field.value} onValueChange={field.onChange}>
                                    <SelectTrigger id="currency" className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {CURRENCY_OPTIONS.map((option) => (
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

                <SectionTitle>Primeira conta</SectionTitle>
                <div className="grid grid-cols-4 items-start gap-3">
                    <Field id="account-name" label="Nome" error={errors.accountName} className="col-span-2">
                        <Input id="account-name" placeholder="Ex.: Nubank" {...fieldAria('account-name', errors.accountName)} {...form.register('accountName')} />
                    </Field>
                    <Field id="account-type" label="Tipo" error={errors.accountType}>
                        <Controller
                            control={form.control}
                            name="accountType"
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
                    <Field id="opening-balance" label="Saldo inicial" error={errors.openingBalance}>
                        <Input
                            id="opening-balance"
                            inputMode="decimal"
                            placeholder={formatMoney({ amount: 0, currency })}
                            className="text-right"
                            {...fieldAria('opening-balance', errors.openingBalance)}
                            {...form.register('openingBalance')}
                        />
                    </Field>
                </div>
                <p className="text-13 text-muted">Saldo inicial é o que a conta já tinha antes do primeiro mês registrado.</p>

                {start.isError && (
                    <p role="alert" className="text-13 text-danger">
                        {describeError(start.error.error).message}
                    </p>
                )}
                <div>
                    <Button type="submit" size="lg" disabled={start.isPending} className="text-15">
                        {start.isPending ? 'Criando…' : 'Criar e começar'}
                    </Button>
                </div>
            </form>
        </section>
    );
}

/**
 * "Já usa em outro aparelho?". Regra de produto (desktop-mvp-plan §1): a sincronização fica
 * fora do MVP, mas o cartão aparece, com o botão desabilitado e o porquê, para que quem já
 * tem os dados no celular não comece do zero achando que não existe outro caminho.
 *
 * @return O cartão de entrar num grupo, sem ação.
 */
function JoinGroup(): ReactNode {
    return (
        <section aria-labelledby="join-title" className="col-span-2 flex flex-col gap-4 rounded-12 border border-line bg-surface p-7">
            <h2 id="join-title" className="text-18 font-semibold">
                Já usa em outro aparelho?
            </h2>
            <p className="text-13 text-muted">Entre no grupo do seu celular ou de outro computador para receber os dados.</p>
            <p className="rounded-8 bg-warn-bg px-3 py-2.5 text-13 text-warn-ink">Os dados deste aparelho serão substituídos pelos do grupo.</p>
            <div>
                <Button variant="outline" disabled aria-describedby="join-unavailable" className="border-line text-13 font-normal">
                    Entrar num grupo existente
                </Button>
            </div>
            <p id="join-unavailable" className="text-13 text-ink2">
                A sincronização entre aparelhos chega numa próxima versão do app. Por enquanto, comece do zero aqui.
            </p>
            <p className="text-13 text-muted">Você vai precisar do QR code ou do código de 8 caracteres mostrado no outro aparelho.</p>
        </section>
    );
}

/**
 * Título de grupo de campos ("Perfil", "Primeira conta"), em caixa alta e discreto como no
 * mockup, para separar os dois cadastros sem dividir o cartão.
 *
 * @param props.children Texto do título.
 * @return O título.
 */
function SectionTitle({ children }: { readonly children: string }): ReactNode {
    return <h3 className="text-13 font-semibold tracking-wide text-muted uppercase">{children}</h3>;
}

/**
 * Rótulo, campo e mensagem de erro. O erro fica no texto abaixo do campo, ligado a ele por
 * `aria-describedby`, além da borda: a cor nunca é o único sinal (decisão de interface 7).
 *
 * @param props.id Id do campo, que liga o rótulo e a mensagem a ele.
 * @param props.label Rótulo acima do campo.
 * @param props.error Erro do campo, quando houver.
 * @param props.className Posição do campo na grade do cartão.
 * @param props.children O campo.
 * @return O campo com rótulo e mensagem.
 */
function Field({
    id,
    label,
    error,
    className,
    children,
}: {
    readonly id: string;
    readonly label: string;
    readonly error: FieldError | undefined;
    readonly className?: string;
    readonly children: ReactNode;
}): ReactNode {
    return (
        <div className={cn('flex flex-col gap-1 text-13', className)}>
            <label htmlFor={id} className="text-muted">
                {label}
            </label>
            {children}
            {error?.message !== undefined && (
                <p id={`${id}-error`} className="text-12 text-danger">
                    {error.message}
                </p>
            )}
        </div>
    );
}

/**
 * @param id Id do campo.
 * @param error Erro do campo, quando houver.
 * @return Os atributos que marcam o campo inválido e o ligam à mensagem.
 */
function fieldAria(id: string, error: FieldError | undefined): { readonly 'aria-invalid': boolean; readonly 'aria-describedby': string | undefined } {
    return { 'aria-invalid': error !== undefined, 'aria-describedby': error === undefined ? undefined : `${id}-error` };
}
