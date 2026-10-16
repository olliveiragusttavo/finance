import { describeError, describeGoalDeletion, describeGoalFundingChange, formatMoney, useAccounts, useCoreMutation } from '@finance/client';
import type { GoalProgressResponse, GoalResponse } from '@finance/core';
import { useState, type ReactNode } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { toast } from 'sonner';
import { Combobox } from '@/components/Combobox';
import { Field, fieldAria, toFieldErrors } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { reportRejection } from '@/registry/coreErrorField';
import { FormDialog } from '@/registry/registryUi';
import { cn } from '@/lib/cn';
import { useActiveProfile } from '@/shell/activeProfile';
import { useReferenceMonth } from '@/shell/useReferenceMonth';
import { emptyGoalForm, GOAL_FIELDS, goalFormFrom, readGoalForm, type GoalContent, type GoalFormValues } from './goalForm.ts';

/** Campo do formulário de cada campo que o núcleo pode apontar numa recusa de meta. */
const GOAL_FIELD_BY_CORE_FIELD: Readonly<Partial<Record<string, keyof GoalFormValues>>> = {
    name: 'name',
    accountId: 'accountId',
    value: 'value',
    targetDate: 'targetDate',
};

/** Os dois tipos de meta, com o rótulo do seletor e a explicação do diálogo. */
const FUNDING_KINDS: readonly { readonly kind: GoalFormValues['fundingKind']; readonly label: string; readonly description: string }[] = [
    { kind: 'transactions', label: 'Por lançamentos', description: 'O progresso soma as receitas e transferências vinculadas à meta e já pagas; a transferência de retirada desconta.' },
    { kind: 'account', label: 'Saldo de uma conta', description: 'O progresso é o saldo consolidado de hoje de uma conta de investimento; nenhum lançamento é vinculado.' },
];

/**
 * Criar ou editar meta: nome, tipo, valor-alvo e data-alvo opcional (brief §3, Meta). Segue o
 * diálogo dos cadastros (`FormDialog`), para que salvar, cancelar e a recusa do núcleo se
 * comportem como nas outras telas.
 * Regra de negócio (Metas, desktop-mvp-plan Fase 13.3): a meta é por lançamentos ou vinculada a
 * uma conta de investimento, e o tipo se troca na edição; trocar para a vinculada a conta desfaz
 * os vínculos, e o diálogo avisa quantos antes de salvar.
 *
 * @param props.goal Meta a editar, com quantos lançamentos estão vinculados, ou `null` para criar uma.
 * @param props.onClose Fecha o diálogo.
 * @param props.onCreated Recebe a meta criada, para a tela abri-la.
 * @return O diálogo com o formulário.
 */
export function GoalDialog({ goal, onClose, onCreated }: { readonly goal: GoalProgressResponse | null; readonly onClose: () => void; readonly onCreated?: (goal: GoalResponse) => void }): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const accounts = useAccounts({ profileId: profile.id, period });
    // Regra de negócio (Metas): só conta de investimento guarda o dinheiro da meta; a desativada
    // continua oferecida, porque o saldo dela ainda existe.
    const investments = (accounts.data?.accounts ?? []).filter((account) => account.type === 'investment');
    /**
     * Valida pelo `readGoalForm`, que aplica o schema das rotas de meta, e entrega ao envio o
     * conteúdo já montado — o que foi validado é exatamente o que vai ao núcleo.
     *
     * @param values Valores dos campos.
     * @return O conteúdo da meta, ou o erro de cada campo no formato do react-hook-form.
     */
    const resolver: Resolver<GoalFormValues, unknown, GoalContent> = (values) => {
        const result = readGoalForm(values, profile.currency);
        return result.ok ? { values: result.content, errors: {} } : { values: {}, errors: toFieldErrors<GoalFormValues>(GOAL_FIELDS, result.errors) };
    };
    const form = useForm<GoalFormValues, unknown, GoalContent>({ defaultValues: goal === null ? emptyGoalForm() : goalFormFrom(goal), resolver });
    const create = useCoreMutation('goals.create');
    const update = useCoreMutation('goals.update');
    const [generalError, setGeneralError] = useState<string | null>(null);
    const { errors } = form.formState;
    const fundingKind = form.watch('fundingKind');
    const unlinkWarning = goal !== null && goal.funding.kind === 'transactions' && fundingKind === 'account' ? describeGoalFundingChange(goal) : null;

    const submit = form.handleSubmit(async (content) => {
        setGeneralError(null);
        try {
            if (goal === null) {
                const created = await create.mutateAsync({ ...content, profileId: profile.id });
                onCreated?.(created);
            } else {
                await update.mutateAsync({ ...content, id: goal.id });
            }
            toast.success(goal === null ? `Meta ${content.name} criada.` : `Meta ${content.name} salva.`);
            onClose();
        } catch (error) {
            reportRejection(
                error,
                GOAL_FIELD_BY_CORE_FIELD,
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
            title={goal === null ? 'Nova meta' : `Editar ${goal.name}`}
            description={FUNDING_KINDS.find((item) => item.kind === fundingKind)?.description ?? ''}
            submitLabel={goal === null ? 'Criar meta' : 'Salvar'}
            pending={create.isPending || update.isPending}
            error={generalError}
            onSubmit={(event) => {
                void submit(event);
            }}
        >
            <Field id="goal-name" label="Nome" error={errors.name}>
                <Input id="goal-name" placeholder="Ex.: Viagem Floripa" autoFocus {...fieldAria('goal-name', errors.name)} {...form.register('name')} />
            </Field>
            <Controller
                control={form.control}
                name="fundingKind"
                render={({ field }) => (
                    <div role="radiogroup" aria-label="Tipo da meta" className="grid grid-cols-2 gap-0.5 rounded-8 bg-surface2 p-0.5 text-13 ring-1 ring-line">
                        {FUNDING_KINDS.map((item) => (
                            <button
                                key={item.kind}
                                type="button"
                                role="radio"
                                aria-checked={field.value === item.kind}
                                className={cn('rounded-6 px-2 py-1.5 text-ink2', field.value === item.kind && 'bg-surface font-semibold text-ink ring-1 ring-line')}
                                onClick={() => {
                                    field.onChange(item.kind);
                                }}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                )}
            />
            {fundingKind === 'account' && (
                <Field
                    id="goal-account"
                    label="Conta de investimento"
                    error={errors.accountId}
                    hint={investments.length === 0 ? 'Nenhuma conta de investimento; crie uma em Cadastros › Contas.' : undefined}
                >
                    <Controller
                        control={form.control}
                        name="accountId"
                        render={({ field }) => (
                            <Combobox
                                id="goal-account"
                                options={investments.map((account) => ({ value: account.id, label: account.disabled ? `${account.name} (desativada)` : account.name }))}
                                value={field.value}
                                onChange={field.onChange}
                                disabled={investments.length === 0}
                                placeholder="Escolha a conta"
                                searchLabel="Buscar conta"
                                emptyText="Nenhuma conta encontrada."
                                aria={fieldAria('goal-account', errors.accountId, investments.length === 0)}
                            />
                        )}
                    />
                </Field>
            )}
            {unlinkWarning !== null && (
                <p role="note" className="rounded-6 bg-warn-bg px-2.5 py-2 text-13 text-warn-ink">
                    {unlinkWarning}
                </p>
            )}
            <div className="grid grid-cols-2 items-start gap-3">
                <Field id="goal-value" label={`Valor-alvo (${profile.currency})`} error={errors.value}>
                    <Input
                        id="goal-value"
                        inputMode="decimal"
                        placeholder={formatMoney({ amount: 0, currency: profile.currency })}
                        className="text-right tabular-nums"
                        {...fieldAria('goal-value', errors.value)}
                        {...form.register('value')}
                    />
                </Field>
                <Field id="goal-target-date" label="Data-alvo (opcional)" error={errors.targetDate} hint="Em branco, a meta não tem prazo.">
                    <Input id="goal-target-date" type="date" className="tabular-nums" {...fieldAria('goal-target-date', errors.targetDate, true)} {...form.register('targetDate')} />
                </Field>
            </div>
        </FormDialog>
    );
}

/**
 * Confirmação de excluir a meta. Diz quantos lançamentos perdem o vínculo e que eles continuam
 * existindo (`describeGoalDeletion`), em vez de um aviso genérico (brief §4, regra 9).
 *
 * @param props.goal Meta a excluir.
 * @param props.onClose Fecha o alerta, depois de excluir ou ao desistir.
 * @return O alerta.
 */
export function DeleteGoalDialog({ goal, onClose }: { readonly goal: GoalProgressResponse; readonly onClose: () => void }): ReactNode {
    const remove = useCoreMutation('goals.delete');
    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
        >
            <DialogContent showCloseButton={false} role="alertdialog">
                <DialogHeader>
                    <DialogTitle>Excluir a meta {goal.name}?</DialogTitle>
                    <DialogDescription>{describeGoalDeletion(goal)}</DialogDescription>
                </DialogHeader>
                {remove.error !== null && (
                    <p role="alert" className="text-13 text-danger">
                        {describeError(remove.error.error).message}
                    </p>
                )}
                <DialogFooter>
                    <Button type="button" variant="outline" autoFocus onClick={onClose}>
                        Cancelar
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        disabled={remove.isPending}
                        onClick={() => {
                            remove.mutate(
                                { id: goal.id },
                                {
                                    onSuccess: () => {
                                        toast.success(`Meta ${goal.name} excluída.`);
                                        onClose();
                                    },
                                },
                            );
                        }}
                    >
                        {remove.isPending ? 'Excluindo…' : 'Excluir meta'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/**
 * Arquiva ou reativa uma meta, conforme a situação atual (desktop-mvp-plan Fase 13.4). Sem
 * confirmação, como desativar uma conta: as duas ações se desfazem uma com a outra e não mexem nos
 * vínculos nem no progresso. O aviso diz isso, para que ninguém arquive achando que perdeu o que
 * guardou.
 *
 * @return A ação de alternar o arquivamento da meta.
 */
export function useToggleGoalArchive(): (goal: GoalResponse) => void {
    const archive = useCoreMutation('goals.archive');
    const unarchive = useCoreMutation('goals.unarchive');
    return (goal) => {
        const mutation = goal.archived ? unarchive : archive;
        mutation.mutate(
            { id: goal.id },
            {
                onSuccess: () => {
                    toast.success(goal.archived ? `Meta ${goal.name} reativada.` : `Meta ${goal.name} arquivada. Os lançamentos continuam vinculados a ela.`);
                },
                onError: (error) => {
                    toast.error(describeError(error.error).message);
                },
            },
        );
    };
}
