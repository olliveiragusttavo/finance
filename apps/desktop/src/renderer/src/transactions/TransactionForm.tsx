import {
    destinationAccountOptions,
    formatDayMonth,
    formatMonthShort,
    formatTransactionType,
    invoiceChoices,
    invoiceReopenWarning,
    parseMoneyInput,
    previewTransactionValue,
    recalculationNotice,
    TRANSACTION_TYPE_ORDER,
    transactionSourceOptions,
    useAccounts,
    useCategoryTree,
    useCoreMutation,
    useCreditCards,
    useGoalOptions,
    useInvoicesByCard,
    useInvoiceSuggestion,
    useRecurrences,
    useTags,
    type EditScope,
    type SourceOption,
} from '@finance/client';
import {
    feedsGoal,
    movesToDestination,
    type AccountInPeriodResponse,
    type CategoryBranchResponse,
    type CreditCardInPeriodResponse,
    type GoalOptionResponse,
    type RecurrenceResponse,
    type TagResponse,
    type TransactionResponse,
} from '@finance/core';
import { useId, useState, type ReactNode } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { toast } from 'sonner';
import { periodOfDate } from '@/cards/invoiceForms';
import { Skeleton } from '@/components/states';
import { Field, fieldAria, toFieldErrors } from '@/components/form';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import { reportRejection } from '@/registry/coreErrorField';
import { StatusTag } from '@/registry/registryUi';
import { useActiveProfile } from '@/shell/activeProfile';
import { currentDate, shiftPeriod } from '@/shell/referenceMonth';
import { useReferenceMonth } from '@/shell/useReferenceMonth';
import { TagPicker, SubCategoryPicker } from './pickers.tsx';
import { RepeatSection } from './RepeatSection.tsx';
import { ScopeDialog } from './ScopeDialog.tsx';
import { SeriesReviewDialog } from './SeriesReviewDialog.tsx';
import {
    cashPeriodOf,
    changesSeries,
    formChangesSeries,
    newTransactionForm,
    parseSourceKey,
    readTransactionForm,
    sourceKey,
    TRANSACTION_FIELDS,
    transactionFormFrom,
    type TransactionErrorField,
    type TransactionFormTarget,
    type TransactionFormValues,
    type TransactionSubmission,
} from './transactionForm.ts';

/** Campo do formulário de cada campo que o núcleo aponta numa recusa. */
const FIELD_BY_CORE_FIELD: Readonly<Partial<Record<string, TransactionErrorField>>> = {
    accountId: 'source',
    creditCardId: 'source',
    invoicePeriod: 'invoicePeriod',
    destinationAccountId: 'destinationAccountId',
    subCategoryId: 'subCategoryId',
    tagIds: 'tagIds',
    goalId: 'goalId',
    dueDate: 'dueDate',
    paymentDate: 'paymentDate',
    name: 'name',
    value: 'amount',
};

/**
 * Valor do item "Sem meta" no `Select`, que não aceita item de valor vazio; o campo do
 * formulário continua vazio sem meta.
 */
const NO_GOAL = 'none';

/** O que o formulário faz e para onde volta. */
export interface TransactionFormProps {
    /** Lançamento editado; `null` num lançamento novo. */
    readonly transaction: TransactionResponse | null;
    /** Origem sugerida num lançamento novo (`sourceKey`), como o filtro de conta da tela. */
    readonly initialSource?: string | undefined;
    /** Fecha o diálogo, depois de salvar ou ao desistir. */
    readonly onClose: () => void;
    /** Recebe o lançamento gravado, para a tela selecioná-lo na tabela. */
    readonly onSaved?: ((saved: TransactionResponse) => void) | undefined;
    /** Abre a confirmação de excluir; só na edição. */
    readonly onDelete?: (() => void) | undefined;
}

/** Edição de uma ocorrência, como o envio a lê. */
type UpdateSubmission = Extract<TransactionSubmission, { route: 'transactions.update' }>;

/**
 * Onde o salvar de uma série está: na escolha do escopo ou no diálogo de revisão
 * (database-design §4.12). A revisão guarda de onde veio, para o "Voltar" voltar um
 * passo, e o escopo escolhido — `null` na criação, que não tem escopo.
 */
type PendingSave =
    | { readonly step: 'scope'; readonly submission: UpdateSubmission }
    | { readonly step: 'review'; readonly submission: TransactionSubmission; readonly scope: EditScope | null; readonly from: 'form' | 'scope' };

/**
 * Formulário de lançamento (desktop-mvp-plan Fase 9; mockup `DesktopTransacoes`). O mesmo
 * formulário serve ao diálogo de lançamento (`TransactionDialog`) da tela de Transações e do
 * "+ Lançamento" das outras telas, para que lançar seja igual de qualquer lugar. Espera os cadastros que as escolhas
 * oferecem antes de montar, para que os valores iniciais já caiam em opções existentes.
 *
 * @param props O lançamento, a origem sugerida e o que fazer ao salvar, fechar e excluir.
 * @return O formulário, ou o esqueleto dele enquanto os cadastros carregam.
 */
export function TransactionForm(props: TransactionFormProps): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const accounts = useAccounts({ profileId: profile.id, period });
    const creditCards = useCreditCards({ profileId: profile.id, period });
    const categories = useCategoryTree({ profileId: profile.id });
    const tags = useTags({ profileId: profile.id });
    const goals = useGoalOptions({ profileId: profile.id });
    const recurring = props.transaction !== null && props.transaction.recurrenceId !== null;
    // A série só é esperada na edição de uma ocorrência: ela preenche "Repetir" e decide se o
    // salvar pergunta o escopo.
    const recurrences = useRecurrences(recurring ? { profileId: profile.id } : null);
    if (accounts.data === undefined || creditCards.data === undefined || categories.data === undefined || tags.data === undefined || goals.data === undefined || (recurring && recurrences.data === undefined)) {
        return (
            <div role="status" aria-busy="true" aria-label="Carregando o formulário" className="flex flex-col gap-3">
                <Skeleton className="h-9" />
                <Skeleton className="h-16" />
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
            </div>
        );
    }
    return (
        <LoadedTransactionForm
            {...props}
            profileId={profile.id}
            currency={profile.currency}
            accounts={accounts.data.accounts}
            creditCards={creditCards.data.creditCards}
            categories={categories.data}
            tags={tags.data}
            goals={goals.data}
            recurrence={recurrences.data?.find((recurrence) => recurrence.id === props.transaction?.recurrenceId) ?? null}
        />
    );
}

/** Cadastros que o formulário oferece nas escolhas. */
interface FormRegistries {
    readonly profileId: string;
    /** Moeda do perfil: a de todo valor digitado (database-design §4.13). */
    readonly currency: string;
    readonly accounts: readonly AccountInPeriodResponse[];
    readonly creditCards: readonly CreditCardInPeriodResponse[];
    readonly categories: readonly CategoryBranchResponse[];
    readonly tags: readonly TagResponse[];
    /** Metas do perfil, para o campo "Meta" das receitas e transferências. */
    readonly goals: readonly GoalOptionResponse[];
    /** Série do lançamento editado; `null` num lançamento novo ou avulso. */
    readonly recurrence: RecurrenceResponse | null;
}

/**
 * O formulário com os cadastros carregados.
 * Regra de negócio (Contas e Cartões, desktop-mvp-plan §5.1): conta e cartão desativados não
 * são escolha de lançamento novo; na edição, a origem e o destino atuais continuam.
 * Regra de negócio (Cartão, database-design §4.7): a compra no cartão cai na fatura sugerida pela
 * data, que se pode trocar; escolher uma paga a reabre, e o formulário avisa antes.
 *
 * @param props O formulário e os cadastros.
 * @return O formulário.
 */
function LoadedTransactionForm({ transaction, initialSource, onClose, onSaved, onDelete, profileId, currency, accounts, creditCards, categories, tags, goals, recurrence }: TransactionFormProps & FormRegistries): ReactNode {
    const id = useId();
    const today = currentDate(new Date());
    const target: TransactionFormTarget = transaction === null ? { mode: 'create', profileId, currency } : { mode: 'update', transaction, recurrence };
    /**
     * Valida pelo `readTransactionForm`, que aplica o schema da rota de criação ou de edição; os
     * valores seguem para o envio, que relê a chamada pronta.
     *
     * @param values Valores dos campos.
     * @return Os mesmos valores, ou o erro de cada campo no formato do react-hook-form.
     */
    const resolver: Resolver<TransactionFormValues> = (values) => {
        const result = readTransactionForm(values, target);
        return result.ok ? { values, errors: {} } : { values: {}, errors: toFieldErrors<TransactionFormValues>(TRANSACTION_FIELDS, result.errors) };
    };
    const form = useForm<TransactionFormValues>({
        defaultValues: transaction === null ? newTransactionForm(today, initialSource ?? '') : transactionFormFrom(transaction, today, recurrence),
        resolver,
    });
    const create = useCoreMutation('transactions.create');
    const update = useCoreMutation('transactions.update');
    const [generalError, setGeneralError] = useState<string | null>(null);
    const { errors } = form.formState;
    const values = form.watch();
    const source = parseSourceKey(values.source);
    const options = transactionSourceOptions({ accounts, creditCards, current: transaction?.container ?? null });
    const card = source?.kind === 'creditCard' ? (creditCards.find((creditCard) => creditCard.id === source.creditCardId) ?? null) : null;
    const invoice = useInvoiceChoice({ card, values, transaction, accounts });
    const notice = recalculationNotice({ before: transaction?.container.period ?? null, after: cashPeriodOf(values, invoice.suggestedPeriod), today });
    /**
     * Id de um campo, único por formulário: nada impede dois formulários no documento ao mesmo
     * tempo, e um id repetido ligaria o rótulo ao campo errado.
     *
     * @param name Nome curto do campo.
     * @return O id do campo.
     */
    const fieldId = (name: string): string => `${id}-${name}`;

    const [pending, setPending] = useState<PendingSave | null>(null);

    /**
     * Grava a chamada pronta. Numa ocorrência de série, com o escopo escolhido no diálogo.
     *
     * @param submission Criação ou edição lida do formulário.
     * @param scope Escopo da edição de uma ocorrência; ausente no lançamento avulso.
     */
    const save = async (submission: TransactionSubmission, scope?: EditScope): Promise<void> => {
        setGeneralError(null);
        try {
            const saved = submission.route === 'transactions.create'
                ? await create.mutateAsync(submission.input)
                : await update.mutateAsync(scope === undefined ? submission.input : { ...submission.input, scope });
            const series = submission.route === 'transactions.create' && submission.input.repeat !== null;
            toast.success(transaction === null ? (series ? `“${saved.name}” lançado com a repetição.` : `“${saved.name}” lançado.`) : `“${saved.name}” salvo.`);
            setPending(null);
            onSaved?.(saved);
            onClose();
        } catch (error) {
            setPending(null);
            reportRejection(
                error,
                FIELD_BY_CORE_FIELD,
                (field, message) => {
                    form.setError(field, { type: 'core', message });
                },
                setGeneralError,
            );
        }
    };

    const submit = form.handleSubmit(async (current) => {
        const result = readTransactionForm(current, target);
        if (!result.ok) {
            return;
        }
        const { submission } = result;
        // Regra de negócio (Recorrências, database-design §4.12):
        // criar ou editar uma série passa pelo diálogo de revisão. Editar uma ocorrência pergunta
        // antes a quais da série a edição se aplica — menos quando a série muda, o que vale sempre
        // para a editada e as futuras.
        if (submission.route === 'transactions.create' && submission.input.repeat !== null) {
            setPending({ step: 'review', submission, scope: null, from: 'form' });
            return;
        }
        if (submission.route === 'transactions.update' && recurrence !== null) {
            setPending(changesSeries(recurrence, submission.input.repeat ?? null) ? { step: 'review', submission, scope: 'future', from: 'form' } : { step: 'scope', submission });
            return;
        }
        await save(submission);
    });

    return (
        <form
            noValidate
            aria-label={transaction === null ? 'Novo lançamento' : `Editar ${transaction.name}`}
            className="flex flex-col gap-3.5 text-13"
            onSubmit={(event) => {
                void submit(event);
            }}
        >
            <Controller control={form.control} name="type" render={({ field }) => <TypeSelector value={field.value} onChange={field.onChange} locked={transaction !== null} />} />
            <AmountField id={fieldId('amount')} form={form} currency={currency} autoFocus={transaction === null} />
            <Field id={fieldId('name')} label="Nome" error={errors.name}>
                <Input id={fieldId('name')} {...fieldAria(fieldId('name'), errors.name)} {...form.register('name')} />
            </Field>
            <Field id={fieldId('category')} label="Categoria" error={errors.subCategoryId}>
                <Controller
                    control={form.control}
                    name="subCategoryId"
                    render={({ field }) => <SubCategoryPicker id={fieldId('category')} tree={categories} value={field.value} onChange={field.onChange} aria={fieldAria(fieldId('category'), errors.subCategoryId)} />}
                />
            </Field>
            <Field id={fieldId('source')} label="Conta ou cartão" error={errors.source}>
                <Controller
                    control={form.control}
                    name="source"
                    render={({ field }) => (
                        <Select
                            value={field.value}
                            onValueChange={(next) => {
                                field.onChange(next);
                                // Trocar de cartão volta para a sugestão; voltar ao cartão atual da
                                // edição devolve a fatura em que o lançamento já está.
                                const container = transaction?.container;
                                form.setValue('invoicePeriod', container?.kind === 'invoice' && next === sourceKey({ kind: 'creditCard', id: container.creditCardId }) ? container.period : '');
                            }}
                        >
                            <SelectTrigger id={fieldId('source')} className="w-full" {...fieldAria(fieldId('source'), errors.source)}>
                                <SelectValue placeholder="Escolha a conta ou o cartão" />
                            </SelectTrigger>
                            <SelectContent>
                                <SourceGroup label="Contas" options={options.accounts} />
                                <SourceGroup label="Cartões" options={options.creditCards} />
                            </SelectContent>
                        </Select>
                    )}
                />
            </Field>
            {card !== null && (
                <Field id={fieldId('invoice')} label="Fatura" error={errors.invoicePeriod} hint={invoice.hint ?? undefined}>
                    <Controller
                        control={form.control}
                        name="invoicePeriod"
                        render={({ field }) => (
                            <Select
                                value={field.value === '' ? (invoice.suggestedPeriod ?? '') : field.value}
                                disabled={invoice.suggestedPeriod === null}
                                onValueChange={(next) => {
                                    // A sugerida fica implícita: acompanha a data enquanto o
                                    // usuário não escolher outra.
                                    field.onChange(next === invoice.suggestedPeriod && transaction === null ? '' : next);
                                }}
                            >
                                <SelectTrigger id={fieldId('invoice')} className="w-full" {...fieldAria(fieldId('invoice'), errors.invoicePeriod, invoice.hint !== null)}>
                                    <SelectValue placeholder="Informe a data da compra" />
                                </SelectTrigger>
                                <SelectContent>
                                    {invoice.choices.map((choice) => (
                                        <SelectItem key={choice.period} value={choice.period}>
                                            {choice.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    />
                </Field>
            )}
            {invoice.warning !== null && (
                <p role="note" className="rounded-6 bg-warn-bg px-2.5 py-2 text-warn-ink">
                    {invoice.warning}
                </p>
            )}
            {movesToDestination(values.type) && (
                <Field id={fieldId('destination')} label="Conta de destino" error={errors.destinationAccountId}>
                    <Controller
                        control={form.control}
                        name="destinationAccountId"
                        render={({ field }) => (
                            <Select value={field.value} onValueChange={field.onChange}>
                                <SelectTrigger id={fieldId('destination')} className="w-full" {...fieldAria(fieldId('destination'), errors.destinationAccountId)}>
                                    <SelectValue placeholder="Escolha a conta de destino" />
                                </SelectTrigger>
                                <SelectContent>
                                    {destinationAccountOptions({
                                        accounts,
                                        originAccountId: source?.kind === 'account' ? source.accountId : null,
                                        currentDestinationId: transaction?.destinationAccountId ?? null,
                                    }).map((option) => (
                                        <SourceItem key={option.id} option={option} />
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    />
                </Field>
            )}
            <div className="grid grid-cols-2 items-start gap-2.5">
                <Field id={fieldId('date')} label={card === null ? 'Data' : 'Data da compra'} error={errors.dueDate}>
                    <Input id={fieldId('date')} type="date" className="tabular-nums" {...fieldAria(fieldId('date'), errors.dueDate)} {...form.register('dueDate')} />
                </Field>
                <Field id={fieldId('charges')} label={`Encargos (${currency})`} error={errors.charges}>
                    <Input
                        id={fieldId('charges')}
                        inputMode="decimal"
                        placeholder="0,00"
                        className="text-right tabular-nums"
                        {...fieldAria(fieldId('charges'), errors.charges)}
                        {...form.register('charges')}
                    />
                </Field>
            </div>
            {card === null && (
                <div className="grid grid-cols-2 items-end gap-2.5">
                    <label className="flex items-center gap-2 pb-2">
                        <input type="checkbox" className="accent-accent" {...form.register('paid')} />
                        Pago
                    </label>
                    {values.paid && (
                        <Field id={fieldId('payment-date')} label="Data do pagamento" error={errors.paymentDate}>
                            <Input id={fieldId('payment-date')} type="date" className="tabular-nums" {...fieldAria(fieldId('payment-date'), errors.paymentDate)} {...form.register('paymentDate')} />
                        </Field>
                    )}
                </div>
            )}
            {(transaction === null || recurrence !== null) && (
                <RepeatSection
                    form={form}
                    idOf={fieldId}
                    mode={transaction === null ? 'create' : 'edit'}
                    seriesKind={recurrence?.kind ?? null}
                    profileId={profileId}
                    currency={currency}
                />
            )}
            <Field id={fieldId('tags')} label="Tags" error={errors.tagIds?.message === undefined ? undefined : { type: 'validate', message: errors.tagIds.message }}>
                <Controller control={form.control} name="tagIds" render={({ field }) => <TagPicker id={fieldId('tags')} tags={tags} value={field.value} onChange={field.onChange} />} />
            </Field>
            {feedsGoal(values.type) && (
                <Field id={fieldId('goal')} label="Meta" error={errors.goalId} hint={goals.length === 0 ? 'Nenhuma meta cadastrada; crie uma na tela Metas.' : undefined}>
                    <Controller
                        control={form.control}
                        name="goalId"
                        render={({ field }) => (
                            <Select
                                value={field.value === '' ? NO_GOAL : field.value}
                                disabled={goals.length === 0}
                                onValueChange={(value) => {
                                    field.onChange(value === NO_GOAL ? '' : value);
                                }}
                            >
                                <SelectTrigger id={fieldId('goal')} className="w-full" {...fieldAria(fieldId('goal'), errors.goalId, goals.length === 0)}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={NO_GOAL}>Sem meta</SelectItem>
                                    {goals.map((goal) => (
                                        <SelectItem key={goal.id} value={goal.id}>
                                            {goal.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    />
                </Field>
            )}
            <Field id={fieldId('description')} label="Descrição" error={errors.description}>
                <textarea
                    id={fieldId('description')}
                    rows={2}
                    className="resize-y rounded-6 border border-line px-2.5 py-2 outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    {...fieldAria(fieldId('description'), errors.description)}
                    {...form.register('description')}
                />
            </Field>
            {recurrence !== null && (
                <p role="note" className="rounded-6 bg-warn-bg px-2.5 py-2 text-warn-ink">
                    {formChangesSeries(values, recurrence)
                        ? 'Mudar a repetição vale para este lançamento e os seguintes. Antes de salvar, você revisa o que será excluído e criado.'
                        : 'Ao salvar, perguntaremos: somente esta, esta e as futuras, ou todas. Depois você revisa o que muda antes de confirmar.'}
                </p>
            )}
            {notice !== null && (
                <p role="note" className="rounded-6 bg-warn-bg px-2.5 py-2 text-warn-ink">
                    {notice}
                </p>
            )}
            {generalError !== null && (
                <p role="alert" className="text-danger">
                    {generalError}
                </p>
            )}
            <DialogFooter>
                {onDelete !== undefined && (
                    <Button type="button" variant="outline" className="font-normal text-danger sm:mr-auto" onClick={onDelete}>
                        Excluir
                    </Button>
                )}
                <Button type="button" variant="outline" onClick={onClose}>
                    Cancelar
                </Button>
                <Button type="submit" disabled={create.isPending || update.isPending}>
                    {create.isPending || update.isPending ? 'Salvando…' : 'Salvar'}
                </Button>
            </DialogFooter>
            {pending?.step === 'scope' && transaction !== null && (
                <ScopeDialog
                    transaction={transaction}
                    title={`Salvar “${transaction.name}”`}
                    action="edit"
                    onConfirm={(scope) => {
                        setPending({ step: 'review', submission: pending.submission, scope, from: 'scope' });
                    }}
                    onClose={() => {
                        setPending(null);
                    }}
                />
            )}
            {pending?.step === 'review' && (
                <SeriesReviewDialog
                    name={pending.submission.input.name}
                    request={
                        pending.submission.route === 'transactions.create'
                            ? { action: 'create', input: pending.submission.input }
                            : { action: 'edit', input: { ...pending.submission.input, scope: pending.scope ?? 'single' } }
                    }
                    accounts={accounts}
                    pending={create.isPending || update.isPending}
                    error={null}
                    onConfirm={() => {
                        void save(pending.submission, pending.scope ?? undefined);
                    }}
                    onClose={() => {
                        // "Voltar" volta um passo: para a escolha do escopo, quando ela veio antes.
                        setPending(pending.from === 'scope' && pending.submission.route === 'transactions.update' ? { step: 'scope', submission: pending.submission } : null);
                    }}
                />
            )}
        </form>
    );
}

/**
 * Rótulo curto de cada tipo no seletor, como no mockup `MobileLancamento` ("Transf.", "Invest."):
 * os quatro nomes inteiros não cabem lado a lado na largura do diálogo. O nome inteiro continua no
 * nome acessível do botão.
 */
const SHORT_TYPE_LABELS: Readonly<Record<TransactionResponse['type'], string>> = {
    expense: 'Despesa',
    income: 'Receita',
    transference: 'Transf.',
    investment: 'Invest.',
};

/**
 * Tipo do lançamento como botões de opção, como o seletor do mockup `MobileLancamento`: os
 * quatro tipos à vista, sem abrir lista. Na edição o seletor continua visível, para mostrar o
 * tipo, mas os outros tipos ficam desabilitados.
 * Regra de negócio (Transação, database-design §4.13): o tipo é fixo desde a criação; o núcleo
 * recusa a troca, e travar aqui evita que o usuário preencha o formulário só para ver o erro.
 *
 * @param props.value Tipo escolhido.
 * @param props.onChange Recebe o tipo escolhido.
 * @param props.locked `true` na edição, quando o tipo já não pode mudar.
 * @return O seletor.
 */
function TypeSelector({ value, onChange, locked }: { readonly value: TransactionResponse['type']; readonly onChange: (type: TransactionResponse['type']) => void; readonly locked: boolean }): ReactNode {
    return (
        <div
            role="radiogroup"
            aria-label="Tipo"
            aria-disabled={locked}
            title={locked ? 'O tipo não muda depois que o lançamento é criado.' : undefined}
            className="grid grid-cols-4 gap-0.5 rounded-8 bg-surface2 p-0.5 ring-1 ring-line"
        >
            {TRANSACTION_TYPE_ORDER.map((type) => (
                <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={type === value}
                    aria-label={formatTransactionType(type)}
                    disabled={locked && type !== value}
                    className={cn('rounded-6 px-1 py-1.5 text-12 text-ink2 disabled:cursor-not-allowed disabled:opacity-50', type === value && 'bg-surface font-semibold text-ink ring-1 ring-line')}
                    onClick={() => {
                        onChange(type);
                    }}
                >
                    {SHORT_TYPE_LABELS[type]}
                </button>
            ))}
        </div>
    );
}

/**
 * Valor com o botão "±" e a prévia do efeito com sinal, como a tabela vai mostrá-lo. A prévia é
 * o que diz se o lançamento entra ou sai — pelo sinal e pela etiqueta, não só pela cor (decisão
 * de interface 7).
 *
 * @param props.id Id do campo.
 * @param props.form O formulário, de onde vêm o valor, o "±", o tipo e os encargos.
 * @param props.currency Moeda do perfil.
 * @param props.autoFocus Foca o valor ao abrir — só no lançamento novo: na edição, aberta pelo
 * clique numa linha, o foco fica na tabela para `↑↓`, `P` e `Del` continuarem valendo.
 * @return O campo de valor.
 */
function AmountField({
    id,
    form,
    currency,
    autoFocus,
}: {
    readonly id: string;
    readonly form: ReturnType<typeof useForm<TransactionFormValues>>;
    readonly currency: string;
    readonly autoFocus: boolean;
}): ReactNode {
    const { errors } = form.formState;
    const [type, amountText, inverted, chargesText] = form.watch(['type', 'amount', 'inverted', 'charges']);
    const amount = parseMoneyInput(amountText, currency);
    const charges = parseMoneyInput(chargesText, currency);
    const magnitude = amount.ok ? Math.abs(amount.amount) : 0;
    const preview = previewTransactionValue({ type, value: inverted ? 0 - magnitude : magnitude, charges: charges.ok ? charges.amount : 0, currency });
    return (
        <Field id={id} label={`Valor (${currency})`} error={errors.amount}>
            <div className="flex items-center gap-2">
                <Input id={id} inputMode="decimal" placeholder="0,00" className="text-right text-15 tabular-nums" autoFocus={autoFocus} {...fieldAria(id, errors.amount)} {...form.register('amount')} />
                <Button
                    type="button"
                    variant="outline"
                    size="icon-lg"
                    aria-label="Inverter sinal (estorno)"
                    aria-pressed={inverted}
                    className={cn(inverted && 'bg-soft text-soft-ink')}
                    onClick={() => {
                        form.setValue('inverted', !inverted);
                    }}
                >
                    ±
                </Button>
            </div>
            <p aria-live="polite" className="flex items-center justify-end gap-2">
                {preview.refund && <StatusTag tone="neutral">estorno</StatusTag>}
                <span className={cn('text-17 font-semibold tabular-nums', magnitude === 0 ? 'text-muted' : preview.direction === 'out' ? 'text-out' : preview.direction === 'in' ? 'text-in' : 'text-ink2')}>
                    {preview.text}
                </span>
            </p>
        </Field>
    );
}

/**
 * Um grupo de origens no campo "Conta ou cartão".
 *
 * @param props.label Título do grupo.
 * @param props.options Contas ou cartões do grupo; o grupo vazio não aparece.
 * @return O grupo.
 */
function SourceGroup({ label, options }: { readonly label: string; readonly options: readonly SourceOption[] }): ReactNode {
    if (options.length === 0) {
        return null;
    }
    return (
        <SelectGroup>
            <SelectLabel>{label}</SelectLabel>
            {options.map((option) => (
                <SourceItem key={option.id} option={option} />
            ))}
        </SelectGroup>
    );
}

/**
 * @param props.option Conta ou cartão; o desativado (oferecido só na edição) leva a marca.
 * @return A opção.
 */
function SourceItem({ option }: { readonly option: SourceOption }): ReactNode {
    return <SelectItem value={sourceKey(option)}>{option.disabled ? `${option.name} (desativado)` : option.name}</SelectItem>;
}

/** A fatura da compra no cartão: a sugerida, as opções da troca e os avisos. */
interface InvoiceChoiceState {
    /** Competência sugerida pela data da compra; `null` fora do cartão ou sem data válida. */
    readonly suggestedPeriod: string | null;
    readonly choices: ReturnType<typeof invoiceChoices>;
    /** "Sugerida pela data da compra: nov/2026, vence 10/11." */
    readonly hint: string | null;
    readonly warning: string | null;
}

/**
 * Consulta a fatura sugerida e as faturas do cartão em volta dela, e monta a escolha da fatura.
 *
 * @param params.card Cartão escolhido; `null` quando a origem é uma conta.
 * @param params.values Valores do formulário (data da compra e fatura escolhida).
 * @param params.transaction Lançamento editado, cuja fatura atual continua oferecida.
 * @param params.accounts Contas do perfil, para o nome da conta pagadora no aviso.
 * @return O estado da escolha.
 */
function useInvoiceChoice(params: {
    readonly card: CreditCardInPeriodResponse | null;
    readonly values: TransactionFormValues;
    readonly transaction: TransactionResponse | null;
    readonly accounts: readonly AccountInPeriodResponse[];
}): InvoiceChoiceState {
    const { card, values, transaction } = params;
    const validDate = periodOfDate(values.dueDate) !== null;
    const suggestion = useInvoiceSuggestion(card !== null && validDate ? { creditCardId: card.id, purchaseDate: values.dueDate } : null);
    const suggestedPeriod = card === null ? null : (suggestion.data?.period ?? null);
    const cycles = useInvoicesByCard(card !== null && suggestedPeriod !== null ? { creditCardId: card.id, from: shiftPeriod(suggestedPeriod, -1) } : null);
    if (card === null || suggestion.data === undefined || suggestedPeriod === null) {
        return { suggestedPeriod: null, choices: [], hint: null, warning: null };
    }
    const container = transaction?.container;
    const currentPeriod = container?.kind === 'invoice' && container.creditCardId === card.id ? container.period : null;
    const invoices = (cycles.data ?? []).flatMap((cycle) => (cycle.invoice === null ? [] : [cycle.invoice]));
    const chosen = values.invoicePeriod === '' ? suggestedPeriod : values.invoicePeriod;
    return {
        suggestedPeriod,
        choices: invoiceChoices({ suggestedPeriod, currentPeriod, invoices }),
        hint: `Sugerida pela data da compra: ${formatMonthShort(suggestedPeriod)}, vence ${formatDayMonth(suggestion.data.dueDate)}.`,
        warning: invoiceReopenWarning({
            invoice: invoices.find((invoice) => invoice.period === chosen) ?? null,
            current: chosen === currentPeriod,
            payingAccountName: params.accounts.find((account) => account.id === card.accountId)?.name ?? '—',
        }),
    };
}
