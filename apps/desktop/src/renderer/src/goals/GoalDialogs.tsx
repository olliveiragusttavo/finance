import { describeError, describeGoalDeletion, formatMoney, useCoreMutation } from '@finance/client';
import type { GoalProgressResponse, GoalResponse } from '@finance/core';
import { useState, type ReactNode } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { toast } from 'sonner';
import { Field, fieldAria, toFieldErrors } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { reportRejection } from '@/registry/coreErrorField';
import { FormDialog } from '@/registry/registryUi';
import { useActiveProfile } from '@/shell/activeProfile';
import { emptyGoalForm, GOAL_FIELDS, goalFormFrom, readGoalForm, type GoalContent, type GoalFormValues } from './goalForm.ts';

/** Campo do formulário de cada campo que o núcleo pode apontar numa recusa de meta. */
const GOAL_FIELD_BY_CORE_FIELD: Readonly<Partial<Record<string, keyof GoalFormValues>>> = {
    name: 'name',
    value: 'value',
    targetDate: 'targetDate',
};

/**
 * Criar ou editar meta: nome, valor-alvo e data-alvo opcional (brief §3, Meta). Segue o diálogo
 * dos cadastros (`FormDialog`), para que salvar, cancelar e a recusa do núcleo se comportem como
 * nas outras telas.
 *
 * @param props.goal Meta a editar, ou `null` para criar uma.
 * @param props.onClose Fecha o diálogo.
 * @param props.onCreated Recebe a meta criada, para a tela abri-la.
 * @return O diálogo com o formulário.
 */
export function GoalDialog({ goal, onClose, onCreated }: { readonly goal: GoalResponse | null; readonly onClose: () => void; readonly onCreated?: (goal: GoalResponse) => void }): ReactNode {
    const { profile } = useActiveProfile();
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
            description="O progresso é a soma das receitas e transferências vinculadas à meta e já pagas."
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
