import {
    cashPeriodOf,
    changesSeries,
    contributionProfileId,
    currentDate,
    describeError,
    destinationAccountOptions,
    destinationKey,
    feedsGoal,
    formChangesSeries,
    formatTransactionType,
    goalChoices,
    matchNameSuggestions,
    movesProfile,
    movesToDestination,
    newTransactionForm,
    NO_PARTNER_CONTEXT,
    parseMoneyInput,
    parseSourceKey,
    paymentMethodSource,
    previewTransactionValue,
    readTransactionForm,
    recalculationNotice,
    reportRejection,
    sourceKey,
    subCategoryOptions,
    suggestedSourceOption,
    TRANSACTION_FIELD_BY_CORE_FIELD,
    TRANSACTION_FIELDS,
    transactionFormFrom,
    transactionSourceOptions,
    useAccounts,
    useCategoryTree,
    useCoreMutation,
    useCreditCards,
    useGoalOptions,
    useInvoiceChoice,
    useRecurrences,
    usePartners,
    useTags,
    useTransactionNameSuggestions,
    useTransferTargets,
    withdrawsFromGoal,
    type EditScope,
    type PartnerContext,
    type PaymentMethod,
    type TransactionFormTarget,
    type TransactionFormValues,
    type TransactionSubmission,
} from '@finance/client';
import type { ProfileResponse, RecurrenceResponse, TransactionNameSuggestionResponse, TransactionResponse } from '@finance/core';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActiveProfile } from '../shell/ActiveProfile.tsx';
import { ModalHeader, useCloseModal } from '../shell/Screen.tsx';
import { useReferenceMonth } from '../shell/useReferenceMonth.ts';
import { useThemeColor } from '../theme/ThemeRoot.tsx';
import { AppText } from '../ui/AppText.tsx';
import { Button } from '../ui/Button.tsx';
import { FormGroup, FormRow, RowInput, RowSelect, Segmented, toFieldErrors } from '../ui/form.tsx';
import { RowDate, RowMultiSelect, RowSearchSelect } from '../ui/pickers.tsx';
import { RepeatRow, ScopeSheet, SeriesReviewSheet } from './series.tsx';
import type { SelectOption } from '../ui/Select.tsx';

/** Tipos na ordem do mockup `MobileLancamento`, com os rótulos curtos que cabem na linha. */
const TYPES: readonly SelectOption<TransactionFormValues['type']>[] = [
    { value: 'income', label: 'Receita' },
    { value: 'expense', label: 'Despesa' },
    { value: 'transference', label: 'Transf.' },
    { value: 'investment', label: 'Invest.' },
];

/** Atalho "Débito / Crédito" da despesa nova (desktop-mvp-plan Fase 15.2). */
const METHODS: readonly SelectOption<PaymentMethod>[] = [
    { value: 'debit', label: 'Débito' },
    { value: 'credit', label: 'Crédito' },
];

/** "Guardar" ou "Retirar" numa transferência com meta (desktop-mvp-plan Fase 13.3). */
const GOAL_DIRECTIONS: readonly SelectOption<'save' | 'withdraw'>[] = [
    { value: 'save', label: 'Guardar' },
    { value: 'withdraw', label: 'Retirar' },
];

/** Valor do item "Sem meta"/"Sem sócio" nas escolhas; o campo fica vazio sem escolha. */
const NONE = 'none';

/** Cor do valor em destaque pelo sentido. */
const PREVIEW_TONE = { in: 'text-in', out: 'text-out', transfer: 'text-ink', none: 'text-ink' } as const;

/**
 * Passo da gravação de uma série (database-design §4.12): a escolha do escopo, na edição de uma
 * ocorrência, e a revisão do que entra, sai ou muda, de onde "Voltar" retorna ao escopo quando ele
 * veio antes.
 */
type PendingSave =
    | { readonly step: 'scope'; readonly submission: TransactionSubmission }
    | { readonly step: 'review'; readonly submission: TransactionSubmission; readonly scope: EditScope | null; readonly from: 'form' | 'scope' };

/** Os cadastros que o formulário precisa, do perfil do lançamento. */
interface Registries {
    readonly accounts: NonNullable<ReturnType<typeof useAccounts>['data']>['accounts'];
    readonly otherProfileAccounts: NonNullable<ReturnType<typeof useTransferTargets>['data']>;
    readonly creditCards: NonNullable<ReturnType<typeof useCreditCards>['data']>['creditCards'];
    readonly categories: NonNullable<ReturnType<typeof useCategoryTree>['data']>;
    readonly tags: NonNullable<ReturnType<typeof useTags>['data']>;
    readonly goals: NonNullable<ReturnType<typeof useGoalOptions>['data']>;
}

/**
 * @param profileId Perfil do lançamento.
 * @return Os cadastros do perfil, ou `null` enquanto algum carrega — as mesmas consultas do
 * formulário do desktop.
 */
function useRegistries(profileId: string): Registries | null {
    const { period } = useReferenceMonth();
    const accounts = useAccounts({ profileId, period });
    const otherProfileAccounts = useTransferTargets({ profileId });
    const creditCards = useCreditCards({ profileId, period });
    const categories = useCategoryTree({ profileId });
    const tags = useTags({ profileId });
    const goals = useGoalOptions({ profileId });
    if (accounts.data === undefined || otherProfileAccounts.data === undefined || creditCards.data === undefined || categories.data === undefined || tags.data === undefined || goals.data === undefined) {
        return null;
    }
    return {
        accounts: accounts.data.accounts,
        otherProfileAccounts: otherProfileAccounts.data,
        creditCards: creditCards.data.creditCards,
        categories: categories.data,
        tags: tags.data,
        goals: goals.data,
    };
}

/**
 * @param profile Perfil do lançamento.
 * @param registries Contas e cartões do perfil.
 * @return A origem do débito padrão do perfil, a de um lançamento novo.
 */
function debitSource(profile: ProfileResponse, registries: Registries): string {
    const chosen = paymentMethodSource({ method: 'debit', defaults: profile, options: transactionSourceOptions({ accounts: registries.accounts, creditCards: registries.creditCards, current: null }) });
    return chosen === null ? '' : sourceKey(chosen);
}

/**
 * Lançamento novo ou edição (mockup `MobileLancamento`; mobile-mvp-plan, Fase 10): espera os
 * cadastros do perfil para abrir o formulário já com a conta padrão no débito.
 *
 * @param props.transaction Lançamento editado; `null` no novo.
 * @return A tela.
 */
export function TransactionFormScreen({ transaction }: { readonly transaction: TransactionResponse | null }): ReactNode {
    const { profile } = useActiveProfile();
    const registries = useRegistries(transaction?.profileId ?? profile.id);
    const recurring = transaction?.recurrenceId !== null && transaction !== null;
    const recurrences = useRecurrences(recurring ? { profileId: transaction.profileId } : null);
    const recurrence = recurring ? (recurrences.data?.find((item) => item.id === transaction.recurrenceId) ?? null) : null;
    const title = transaction === null ? 'Novo lançamento' : 'Editar lançamento';
    if (registries === null || (recurring && recurrences.data === undefined)) {
        return (
            <View className="flex-1 bg-bg">
                <ModalHeader title={title} />
                <AppText className="p-4 text-13 text-muted">Abrindo…</AppText>
            </View>
        );
    }
    return <LoadedForm transaction={transaction} recurrence={recurrence} initialSource={transaction === null ? debitSource(profile, registries) : ''} title={title} />;
}

/**
 * O formulário com os cadastros carregados. Valida pelo `readTransactionForm` do `client` — o
 * mesmo do desktop, que aplica o schema da rota — e reproduz as regras de tela do desktop: o
 * atalho débito/crédito e o nome sugerido só no lançamento novo (Fase 15.2), a fatura sugerida pela
 * data da compra, o destino só em transferência e investimento, a meta só onde ela é alimentada e
 * o sócio só num aporte em perfil empresarial. Criar uma série e editar uma ocorrência passam pela
 * revisão e, na edição, pela escolha do escopo, como no desktop (Fase 11).
 *
 * @param props.transaction Lançamento editado; `null` no novo.
 * @param props.recurrence Série da ocorrência editada; `null` no lançamento avulso.
 * @param props.initialSource Origem do lançamento novo (o débito padrão).
 * @param props.title Título do cabeçalho.
 * @return O formulário.
 */
function LoadedForm(props: { readonly transaction: TransactionResponse | null; readonly recurrence: RecurrenceResponse | null; readonly initialSource: string; readonly title: string }): ReactNode {
    const { transaction, recurrence, initialSource, title } = props;
    const insets = useSafeAreaInsets();
    const close = useCloseModal();
    const placeholder = useThemeColor('muted');
    const today = currentDate(new Date());
    const { profile: activeProfile, profiles } = useActiveProfile();
    const home = profiles.find((item) => item.id === (transaction?.profileId ?? activeProfile.id)) ?? activeProfile;
    // Regra de negócio (Mover para outro perfil): só perfis da mesma moeda, porque o valor não é convertido.
    const profileChoices = profiles.filter((item) => item.currency === home.currency);
    const { currency } = home;
    const creating = transaction === null;
    const target: TransactionFormTarget = creating ? { mode: 'create', currency } : { mode: 'update', transaction, recurrence };
    const partnerContext = useRef<PartnerContext>(NO_PARTNER_CONTEXT);
    /**
     * @param values Valores dos campos.
     * @return Os mesmos valores, ou o erro de cada campo.
     */
    const resolver: Resolver<TransactionFormValues> = (values) => {
        const result = readTransactionForm(values, target, partnerContext.current);
        return result.ok ? { values, errors: {} } : { values: {}, errors: toFieldErrors<TransactionFormValues>(TRANSACTION_FIELDS, result.errors) };
    };
    const form = useForm<TransactionFormValues>({ defaultValues: creating ? newTransactionForm(today, initialSource, activeProfile.id) : transactionFormFrom(transaction, today), resolver });
    const values = form.watch();
    const loaded = useRegistries(values.profileId);
    const owner = profiles.find((item) => item.id === values.profileId) ?? home;
    const { errors } = form.formState;
    const create = useCoreMutation('transactions.create');
    const update = useCoreMutation('transactions.update');
    const [generalError, setGeneralError] = useState<string | null>(null);
    const [details, setDetails] = useState(!creating);
    const [method, setMethod] = useState<PaymentMethod>(initialSource.startsWith('creditCard') ? 'credit' : 'debit');
    const [pendingDefault, setPendingDefault] = useState<string | null>(null);

    const accounts = loaded?.accounts ?? [];
    const creditCards = loaded?.creditCards ?? [];
    const otherProfileAccounts = loaded?.otherProfileAccounts ?? [];
    const options = transactionSourceOptions({ accounts, creditCards, current: transaction?.container ?? null });
    const source = parseSourceKey(values.source);
    const shownMethod: PaymentMethod = source === null ? method : source.kind === 'creditCard' ? 'credit' : 'debit';
    const sourceFilter: PaymentMethod | null = creating && values.type === 'expense' ? shownMethod : null;
    const card = source?.kind === 'creditCard' ? (creditCards.find((creditCard) => creditCard.id === source.creditCardId) ?? null) : null;
    const invoice = useInvoiceChoice({ card, values, transaction, accounts });
    const notice = recalculationNotice({ before: transaction?.container.period ?? null, after: cashPeriodOf(values, invoice.suggestedPeriod), today });
    const nameSuggestions = useTransactionNameSuggestions(creating ? { profileId: values.profileId } : null);
    const nameMatches = matchNameSuggestions({ suggestions: nameSuggestions.data ?? [], query: values.name, type: values.type });
    const [nameFocused, setNameFocused] = useState(false);
    const subCategories = subCategoryOptions(loaded?.categories ?? [], '');
    const partnerProfileId = contributionProfileId(values, profiles, otherProfileAccounts);
    const partners = usePartners(partnerProfileId === null ? null : { profileId: partnerProfileId });
    partnerContext.current = { profileId: partnerProfileId, partnerIds: partners.data?.map((partner) => partner.id) };
    const partnerProfile = profiles.find((item) => item.id === partnerProfileId) ?? null;
    const moved = transaction !== null && movesProfile(values, transaction);

    // Aplica o débito padrão do perfil escolhido assim que os cadastros dele chegam, como o desktop.
    useEffect(() => {
        if (pendingDefault === null || pendingDefault !== values.profileId || loaded === null) {
            return;
        }
        form.setValue('source', debitSource(owner, loaded));
        setPendingDefault(null);
    }, [pendingDefault, values.profileId, loaded, owner, form]);

    const amount = parseMoneyInput(values.amount, currency);
    const charges = parseMoneyInput(values.charges, currency);
    const preview = previewTransactionValue({
        type: values.type,
        value: amount.ok ? (values.inverted ? -amount.amount : amount.amount) : 0,
        charges: charges.ok ? charges.amount : 0,
        currency,
    });

    const sourceChoices: SelectOption<string>[] = [
        ...(sourceFilter === 'credit' ? [] : options.accounts.map((option) => ({ value: sourceKey(option), label: option.name, description: option.disabled ? 'Conta desativada' : 'Conta' }))),
        ...(sourceFilter === 'debit' ? [] : options.creditCards.map((option) => ({ value: sourceKey(option), label: option.name, description: option.disabled ? 'Cartão desativado' : 'Cartão' }))),
    ];
    const destinationChoices: SelectOption<string>[] = destinationAccountOptions({
        accounts,
        originAccountId: source?.kind === 'account' ? source.accountId : null,
        currentDestinationId: transaction?.destinationAccountId ?? null,
        type: values.type,
        otherProfileAccounts,
    }).map((option) => ({ value: destinationKey(option), label: option.name }));
    const categoryChoices: SelectOption<string>[] = subCategories.map((option) => ({ value: option.id, label: option.label }));
    const goalOptions: SelectOption<string>[] = [{ value: NONE, label: 'Sem meta' }, ...goalChoices(loaded?.goals ?? [], transaction?.goalId ?? null).map((choice) => ({ value: choice.id, label: choice.label, description: choice.group }))];
    const partnerOptions: SelectOption<string>[] = [{ value: NONE, label: 'Sem sócio' }, ...(partners.data ?? []).map((partner) => ({ value: partner.id, label: partner.name }))];

    /**
     * @param next Débito ou crédito: a origem passa à conta ou ao cartão padrão do perfil.
     */
    const changeMethod = (next: PaymentMethod): void => {
        const chosen = paymentMethodSource({ method: next, defaults: owner, options });
        setMethod(next);
        form.setValue('source', chosen === null ? '' : sourceKey(chosen));
        form.setValue('invoicePeriod', '');
        form.clearErrors('source');
    };

    /**
     * Copia a categoria e a origem do lançamento sugerido, quando ainda são escolhas válidas.
     *
     * @param suggestion Sugestão tocada.
     */
    const pickName = (suggestion: TransactionNameSuggestionResponse): void => {
        form.setValue('name', suggestion.name);
        setNameFocused(false);
        if (subCategories.some((option) => option.id === suggestion.subCategoryId)) {
            form.setValue('subCategoryId', suggestion.subCategoryId);
            form.clearErrors('subCategoryId');
        }
        const suggested = suggestedSourceOption(suggestion, options);
        if (suggested !== null) {
            setMethod(suggested.kind === 'creditCard' ? 'credit' : 'debit');
            form.setValue('source', sourceKey(suggested));
            form.setValue('invoicePeriod', '');
            form.clearErrors('source');
        }
    };

    /**
     * Troca o perfil do lançamento: o que é do perfil volta a ser escolhido (database-design §3.8).
     *
     * @param next Perfil escolhido.
     */
    const changeProfile = (next: string): void => {
        const original = transaction !== null && next === transaction.profileId ? transactionFormFrom(transaction, today, recurrence) : null;
        form.setValue('profileId', next);
        form.setValue('source', original?.source ?? '');
        if (creating) {
            setMethod('debit');
            setPendingDefault(next);
        }
        form.setValue('invoicePeriod', original?.invoicePeriod ?? '');
        form.setValue('destinationAccountId', original?.destinationAccountId ?? '');
        form.setValue('subCategoryId', original?.subCategoryId ?? '');
        form.setValue('tagIds', original?.tagIds ?? []);
        form.setValue('goalId', original?.goalId ?? '');
        form.setValue('goalWithdrawal', original?.goalWithdrawal ?? false);
        form.setValue('partnerId', original?.partnerId ?? '');
        form.clearErrors();
    };

    const [pending, setPending] = useState<PendingSave | null>(null);

    /**
     * Grava a chamada pronta; numa ocorrência de série, com o escopo escolhido.
     *
     * @param submission Criação ou edição lida do formulário.
     * @param scope Escopo da edição de uma ocorrência; ausente no lançamento avulso.
     */
    const save = async (submission: TransactionSubmission, scope?: EditScope): Promise<void> => {
        setGeneralError(null);
        try {
            if (submission.route === 'transactions.create') {
                await create.mutateAsync(submission.input);
            } else {
                await update.mutateAsync(scope === undefined ? submission.input : { ...submission.input, scope });
            }
            setPending(null);
            close();
        } catch (error) {
            setPending(null);
            reportRejection(
                error,
                TRANSACTION_FIELD_BY_CORE_FIELD,
                (field, message) => {
                    form.setError(field, { type: 'core', message });
                },
                setGeneralError,
            );
        }
    };

    // Regra de negócio (Recorrências, database-design §4.12): criar uma série passa pela revisão;
    // editar uma ocorrência pergunta antes o escopo — menos quando a série muda, o que vale para a
    // editada e as futuras, e quando o perfil muda, o que leva a série inteira: os dois vão direto
    // para a revisão, e juntos não cabem numa edição só.
    const submit = form.handleSubmit(async (current) => {
        const result = readTransactionForm(current, target, partnerContext.current);
        if (!result.ok) {
            return;
        }
        const { submission } = result;
        if (submission.route === 'transactions.create' && submission.input.repeat !== null) {
            setPending({ step: 'review', submission, scope: null, from: 'form' });
            return;
        }
        if (submission.route === 'transactions.update' && recurrence !== null) {
            const seriesChanged = changesSeries(recurrence, submission.input.repeat ?? null);
            if (moved && seriesChanged) {
                setGeneralError('Mude o perfil e a repetição em edições separadas: mudar de perfil leva a série inteira, e mudar a repetição vale para este lançamento e os seguintes.');
                return;
            }
            setPending(moved ? { step: 'review', submission, scope: 'all', from: 'form' } : seriesChanged ? { step: 'review', submission, scope: 'future', from: 'form' } : { step: 'scope', submission });
            return;
        }
        await save(submission);
    });

    const saving = create.isPending || update.isPending;
    return (
        <View className="flex-1 bg-bg">
            <ModalHeader title={title} />
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} contentContainerClassName="gap-3.5 px-4 pt-3.5">
                {creating ? (
                    <Controller
                        control={form.control}
                        name="type"
                        render={({ field }) => (
                            <Segmented
                                label="Tipo"
                                options={TYPES}
                                value={field.value}
                                onChange={(type) => {
                                    field.onChange(type);
                                    form.clearErrors();
                                }}
                            />
                        )}
                    />
                ) : (
                    <AppText className="text-13 text-muted">{formatTransactionType(values.type)} · o tipo não muda depois de lançado</AppText>
                )}

                <View className="items-center gap-1.5 py-1">
                    <View className="flex-row items-center gap-2">
                        <Controller
                            control={form.control}
                            name="amount"
                            render={({ field }) => (
                                <TextInput
                                    accessibilityLabel={errors.amount?.message === undefined ? 'Valor' : `Valor. ${errors.amount.message}`}
                                    autoFocus={creating}
                                    keyboardType="decimal-pad"
                                    placeholder="0,00"
                                    placeholderTextColor={placeholder}
                                    value={field.value}
                                    onChangeText={field.onChange}
                                    onBlur={field.onBlur}
                                    className={`min-h-14 min-w-40 text-center font-sans text-30 font-semibold ${PREVIEW_TONE[preview.direction]}`}
                                />
                            )}
                        />
                        <Controller
                            control={form.control}
                            name="inverted"
                            render={({ field }) => (
                                <Pressable
                                    accessibilityRole="switch"
                                    accessibilityState={{ checked: field.value }}
                                    accessibilityLabel={values.type === 'expense' ? 'Inverter sinal (estorno)' : 'Inverter sinal'}
                                    onPress={() => {
                                        field.onChange(!field.value);
                                    }}
                                    className={`h-11 w-11 items-center justify-center rounded-full border ${field.value ? 'border-accent bg-soft' : 'border-line bg-surface'}`}
                                >
                                    <AppText className="text-20">±</AppText>
                                </Pressable>
                            )}
                        />
                    </View>
                    <AppText className={`text-13 ${PREVIEW_TONE[preview.direction]}`}>
                        {preview.text}
                        {preview.refund ? ' · estorno' : ''}
                    </AppText>
                    {errors.amount?.message !== undefined && <AppText className="text-12 text-danger">{errors.amount.message}</AppText>}
                </View>

                {creating && values.type === 'expense' && <Segmented label="Forma de pagamento" options={METHODS} value={shownMethod} onChange={changeMethod} />}

                <FormGroup>
                    <FormRow first label={values.type === 'expense' || values.type === 'income' ? 'Onde' : 'Origem'} error={errors.source?.message}>
                        <Controller
                            control={form.control}
                            name="source"
                            render={({ field }) => (
                                <RowSearchSelect
                                    label="Conta ou cartão"
                                    options={sourceChoices}
                                    value={field.value === '' ? null : field.value}
                                    placeholder={shownMethod === 'credit' && sourceFilter !== null ? 'Escolha o cartão' : 'Escolha a conta'}
                                    onChange={(next) => {
                                        field.onChange(next);
                                        const container = transaction?.container;
                                        form.setValue('invoicePeriod', container?.kind === 'invoice' && next === sourceKey({ kind: 'creditCard', id: container.creditCardId }) ? container.period : '');
                                    }}
                                />
                            )}
                        />
                    </FormRow>
                    {card !== null && invoice.suggestedPeriod !== null && (
                        <FormRow label="Fatura" error={errors.invoicePeriod?.message}>
                            <Controller
                                control={form.control}
                                name="invoicePeriod"
                                render={({ field }) => (
                                    <RowSelect
                                        label="Fatura"
                                        options={invoice.choices.map((choice) => ({ value: choice.period, label: choice.label }))}
                                        value={field.value === '' ? invoice.suggestedPeriod : field.value}
                                        onChange={(next) => {
                                            field.onChange(next === invoice.suggestedPeriod && creating ? '' : next);
                                        }}
                                    />
                                )}
                            />
                        </FormRow>
                    )}
                    {movesToDestination(values.type) && (
                        <FormRow label="Destino" error={errors.destinationAccountId?.message}>
                            <Controller
                                control={form.control}
                                name="destinationAccountId"
                                render={({ field }) => (
                                    <RowSearchSelect label="Conta de destino" options={destinationChoices} value={field.value === '' ? null : field.value} placeholder="Escolha a conta" onChange={field.onChange} />
                                )}
                            />
                        </FormRow>
                    )}
                    <FormRow label="Categoria" error={errors.subCategoryId?.message}>
                        <Controller
                            control={form.control}
                            name="subCategoryId"
                            render={({ field }) => (
                                <RowSearchSelect label="Categoria" options={categoryChoices} value={field.value === '' ? null : field.value} placeholder="Escolha a categoria" emptyText="Nenhuma subcategoria encontrada." onChange={field.onChange} />
                            )}
                        />
                    </FormRow>
                    <FormRow label={card === null ? 'Data' : 'Data da compra'} error={errors.dueDate?.message}>
                        <Controller control={form.control} name="dueDate" render={({ field }) => <RowDate label={card === null ? 'Data' : 'Data da compra'} value={field.value} onChange={field.onChange} />} />
                    </FormRow>
                    <FormRow label="Nome" error={errors.name?.message}>
                        <Controller
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <RowInput
                                    label="Nome"
                                    error={errors.name?.message}
                                    placeholder="Ex.: Supermercado"
                                    value={field.value}
                                    onChangeText={field.onChange}
                                    onFocus={() => {
                                        setNameFocused(true);
                                    }}
                                    onBlur={() => {
                                        field.onBlur();
                                        setNameFocused(false);
                                    }}
                                />
                            )}
                        />
                    </FormRow>
                    {creating && nameFocused && nameMatches.length > 0 && (
                        <View accessibilityLabel="Nomes já lançados" className="border-t border-line2 bg-surface2">
                            {nameMatches.map((suggestion) => (
                                <Pressable
                                    key={suggestion.name}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Usar ${suggestion.name}`}
                                    onPress={() => {
                                        pickName(suggestion);
                                    }}
                                    className="min-h-11 justify-center px-3.5 active:bg-line2"
                                >
                                    <AppText numberOfLines={1}>{suggestion.name}</AppText>
                                </Pressable>
                            ))}
                        </View>
                    )}
                    {card === null && (
                        <FormRow label={values.type === 'income' ? 'Recebido' : 'Pago'}>
                            <Controller
                                control={form.control}
                                name="paid"
                                render={({ field }) => (
                                    <Switch
                                        accessibilityLabel={values.type === 'income' ? 'Recebido' : 'Pago'}
                                        value={field.value}
                                        onValueChange={(paid) => {
                                            field.onChange(paid);
                                            if (paid && values.paymentDate === '') {
                                                form.setValue('paymentDate', today);
                                            }
                                        }}
                                    />
                                )}
                            />
                        </FormRow>
                    )}
                    {card === null && values.paid && (
                        <FormRow label="Data do pagamento" error={errors.paymentDate?.message}>
                            <Controller control={form.control} name="paymentDate" render={({ field }) => <RowDate label="Data do pagamento" value={field.value} onChange={field.onChange} />} />
                        </FormRow>
                    )}
                    {(creating || recurrence !== null) && <RepeatRow form={form} mode={creating ? 'create' : 'edit'} seriesKind={recurrence?.kind ?? null} profileId={values.profileId} currency={currency} />}
                </FormGroup>
                {card !== null && invoice.hint !== null && <AppText className="text-12 text-muted">{invoice.hint}</AppText>}
                {invoice.warning !== null && <AppText accessibilityRole="alert" className="rounded-8 bg-warn-bg px-3 py-2 text-13 text-warn-ink">{invoice.warning}</AppText>}

                <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: details }}
                    onPress={() => {
                        setDetails(!details);
                    }}
                    className="min-h-12.5 flex-row items-center justify-between rounded-12 border border-line bg-surface px-3.5 active:bg-line2"
                >
                    <AppText>Mais detalhes · tags, meta, encargos…</AppText>
                    <AppText className="text-muted">{details ? '▴' : '▾'}</AppText>
                </Pressable>
                {details && (
                    <FormGroup>
                        <FormRow first label="Tags" error={errors.tagIds?.message}>
                            <Controller
                                control={form.control}
                                name="tagIds"
                                render={({ field }) => (
                                    <RowMultiSelect label="Tags" options={(loaded?.tags ?? []).map((tag) => ({ value: tag.id, label: tag.name }))} value={field.value} onChange={field.onChange} emptyText="Nenhuma tag cadastrada; crie em Cadastros › Tags." />
                                )}
                            />
                        </FormRow>
                        {feedsGoal(values.type) && (
                            <FormRow label="Meta" error={errors.goalId?.message}>
                                <Controller
                                    control={form.control}
                                    name="goalId"
                                    render={({ field }) => (
                                        <RowSelect
                                            label="Meta"
                                            options={goalOptions}
                                            value={field.value === '' ? NONE : field.value}
                                            onChange={(next) => {
                                                field.onChange(next === NONE ? '' : next);
                                            }}
                                        />
                                    )}
                                />
                            </FormRow>
                        )}
                        {withdrawsFromGoal(values.type) && values.goalId !== '' && (
                            <FormRow label="Na meta">
                                <Controller
                                    control={form.control}
                                    name="goalWithdrawal"
                                    render={({ field }) => (
                                        <Segmented
                                            label="Guardar ou retirar da meta"
                                            options={GOAL_DIRECTIONS}
                                            value={field.value ? 'withdraw' : 'save'}
                                            onChange={(next) => {
                                                field.onChange(next === 'withdraw');
                                            }}
                                        />
                                    )}
                                />
                            </FormRow>
                        )}
                        {partnerProfile !== null && (
                            <FormRow label={partnerProfile.id === values.profileId ? 'Sócio que aportou' : `Sócio em ${partnerProfile.name}`} error={errors.partnerId?.message}>
                                <Controller
                                    control={form.control}
                                    name="partnerId"
                                    render={({ field }) => (
                                        <RowSelect
                                            label="Sócio que aportou"
                                            options={partnerOptions}
                                            value={field.value === '' || !partnerOptions.some((option) => option.value === field.value) ? NONE : field.value}
                                            onChange={(next) => {
                                                field.onChange(next === NONE ? '' : next);
                                            }}
                                        />
                                    )}
                                />
                            </FormRow>
                        )}
                        <FormRow label={`Encargos (${currency})`} error={errors.charges?.message}>
                            <Controller
                                control={form.control}
                                name="charges"
                                render={({ field }) => <RowInput label="Encargos" error={errors.charges?.message} keyboardType="decimal-pad" placeholder="0,00" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />}
                            />
                        </FormRow>
                        {profileChoices.length > 1 && (
                            <FormRow label="Perfil" error={errors.profileId?.message}>
                                <RowSelect label="Perfil" options={profileChoices.map((item) => ({ value: item.id, label: item.name }))} value={values.profileId} onChange={changeProfile} />
                            </FormRow>
                        )}
                        <FormRow label="Descrição" error={errors.description?.message}>
                            <Controller
                                control={form.control}
                                name="description"
                                render={({ field }) => <RowInput label="Descrição" error={errors.description?.message} placeholder="Opcional" multiline value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />}
                            />
                        </FormRow>
                    </FormGroup>
                )}

                {moved && <AppText className="rounded-8 bg-warn-bg px-3 py-2 text-13 text-warn-ink">Ao salvar, o lançamento sai de {home.name} e vai para {owner.name}, com a conta, a categoria e as tags escolhidas lá.</AppText>}
                {recurrence !== null && (
                    <AppText className="rounded-8 bg-warn-bg px-3 py-2 text-13 text-warn-ink">
                        {moved
                            ? `Mudar de perfil leva a série inteira para ${owner.name}. Antes de salvar, você revisa o que muda.`
                            : formChangesSeries(values, recurrence)
                              ? 'Mudar a repetição vale para este lançamento e os seguintes. Antes de salvar, você revisa o que será excluído e criado.'
                              : 'Ao salvar, perguntaremos: somente esta, esta e as futuras, ou todas. Em “esta e as futuras” e “todas”, você revisa o que muda antes de confirmar.'}
                    </AppText>
                )}
                {notice !== null && <AppText className="rounded-8 bg-warn-bg px-3 py-2 text-13 text-warn-ink">{notice}</AppText>}
                {generalError !== null && <AppText accessibilityRole="alert" className="text-13 text-danger">{generalError}</AppText>}
                {create.isError && generalError === null && Object.keys(errors).length === 0 && <AppText accessibilityRole="alert" className="text-13 text-danger">{describeError(create.error.error).message}</AppText>}

                <Button
                    large
                    label={saving ? 'Salvando…' : 'Salvar'}
                    busy={saving}
                    onPress={() => {
                        void submit();
                    }}
                />
            </ScrollView>
            {transaction !== null && (
                <ScopeSheet
                    open={pending?.step === 'scope'}
                    transaction={transaction}
                    title={`Salvar “${transaction.name}”`}
                    action="edit"
                    pending={update.isPending}
                    error={null}
                    onConfirm={(scope) => {
                        if (pending?.step !== 'scope') {
                            return;
                        }
                        // "Somente esta" grava direto: a revisão só repetiria a linha editada.
                        if (scope === 'single') {
                            void save(pending.submission, scope);
                        } else {
                            setPending({ step: 'review', submission: pending.submission, scope, from: 'scope' });
                        }
                    }}
                    onClose={() => {
                        setPending(null);
                    }}
                />
            )}
            {pending?.step === 'review' && (
                <SeriesReviewSheet
                    open
                    request={
                        pending.submission.route === 'transactions.create'
                            ? { action: 'create', input: pending.submission.input }
                            : { action: 'edit', input: { ...pending.submission.input, scope: pending.scope ?? 'single' } }
                    }
                    accounts={accounts}
                    pending={saving}
                    error={generalError}
                    onConfirm={() => {
                        void save(pending.submission, pending.scope ?? undefined);
                    }}
                    onClose={() => {
                        setPending(pending.from === 'scope' && pending.submission.route === 'transactions.update' ? { step: 'scope', submission: pending.submission } : null);
                    }}
                />
            )}
        </View>
    );
}
