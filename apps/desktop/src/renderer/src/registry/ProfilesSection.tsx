import { formatProfileSummary, formatProfileType, useCoreMutation } from '@finance/client';
import type { ProfileResponse } from '@finance/core';
import { useState, type ReactNode } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { toast } from 'sonner';
import { Field, fieldAria, toFieldErrors } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { currencyOptionsWith } from '@/lib/currencies';
import { useActiveProfile } from '@/shell/activeProfile';
import { reportRejection } from './coreErrorField.ts';
import { emptyProfileForm, PROFILE_FIELDS, profileFormFrom, readProfileForm, type ProfileContent, type ProfileFormValues } from './profileForm.ts';
import { FormDialog, RowAction, SectionHeader, StatusTag } from './registryUi.tsx';

/** Tipos de perfil, na ordem do primeiro uso. */
const PROFILE_TYPES: readonly ProfileFormValues['type'][] = ['personal', 'business'];

/** Diálogo aberto na seção: criar ou editar um perfil. */
type ProfileDialogState = { readonly mode: 'create' } | { readonly mode: 'edit'; readonly profile: ProfileResponse };

/** Aviso do perfil empresarial: sócios ficam fora do MVP (desktop-mvp-plan §1). */
const BUSINESS_WITHOUT_PARTNERS = 'Perfil empresarial: o cadastro de sócios e o relatório por sócio chegam numa próxima versão do app.';

/**
 * Perfis em Cadastros (desktop-mvp-plan Fase 6): lista, criar e editar. Não há exclusão no
 * MVP — o núcleo não tem rota para ela, e apagar um perfil apagaria todo o histórico dele.
 *
 * @return A seção de perfis.
 */
export function ProfilesSection(): ReactNode {
    const { profile: active, profiles, switchTo } = useActiveProfile();
    const [dialog, setDialog] = useState<ProfileDialogState | null>(null);
    const close = (): void => {
        setDialog(null);
    };

    return (
        <>
            <SectionHeader
                title="Perfis"
                description="Cada perfil tem as próprias contas, cartões e categorias, numa moeda só."
                actions={
                    <Button
                        onClick={() => {
                            setDialog({ mode: 'create' });
                        }}
                    >
                        + Novo perfil
                    </Button>
                }
            />
            <ul aria-label="Perfis" className="rounded-10 border border-line bg-surface">
                {profiles.map((profile) => (
                    <li key={profile.id} className="flex items-center justify-between gap-4 border-t border-line2 px-5 py-3 first:border-t-0">
                        <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="flex items-center gap-2 font-medium">
                                {profile.name}
                                {profile.id === active.id && <StatusTag tone="neutral">Em uso</StatusTag>}
                            </span>
                            <span className="text-12 text-muted">{formatProfileSummary(profile)}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            {profile.id !== active.id && (
                                <RowAction
                                    label="Abrir"
                                    accessibleName={`Abrir ${profile.name}`}
                                    onClick={() => {
                                        switchTo(profile.id);
                                    }}
                                />
                            )}
                            <RowAction
                                label="Editar"
                                accessibleName={`Editar ${profile.name}`}
                                onClick={() => {
                                    setDialog({ mode: 'edit', profile });
                                }}
                            />
                        </div>
                    </li>
                ))}
            </ul>
            {profiles.some((profile) => profile.type === 'business') && <p className="rounded-8 bg-soft px-3 py-2.5 text-13 text-soft-ink">{BUSINESS_WITHOUT_PARTNERS}</p>}
            {dialog?.mode === 'create' && <ProfileDialog profile={null} onClose={close} />}
            {dialog?.mode === 'edit' && <ProfileDialog key={dialog.profile.id} profile={dialog.profile} onClose={close} />}
        </>
    );
}

/** Campo do formulário de cada campo que o núcleo pode apontar numa recusa de perfil. */
const PROFILE_FIELD_BY_CORE_FIELD: Readonly<Partial<Record<string, keyof ProfileFormValues>>> = { name: 'name', type: 'type', currency: 'currency' };

/**
 * Criar perfil (nome, tipo, moeda) ou editar (nome e moeda). O tipo não muda depois de criado:
 * `profiles.update` não o recebe, e trocar pessoal por empresarial mudaria o que o perfil pode
 * ter (sócios). Regra de negócio (Perfis, desktop-mvp-plan §5): a moeda só muda sem
 * lançamentos; a recusa do núcleo aparece abaixo do campo da moeda.
 *
 * @param props.profile Perfil a editar, ou `null` para criar um.
 * @param props.onClose Fecha o diálogo.
 * @return O diálogo com o formulário.
 */
function ProfileDialog({ profile, onClose }: { readonly profile: ProfileResponse | null; readonly onClose: () => void }): ReactNode {
    const { switchTo } = useActiveProfile();
    /**
     * Valida pelo `readProfileForm`, que aplica o schema da rota de perfil.
     *
     * @param values Valores dos campos.
     * @return O cadastro do perfil, ou o erro de cada campo no formato do react-hook-form.
     */
    const resolver: Resolver<ProfileFormValues, unknown, ProfileContent> = (values) => {
        const result = readProfileForm(values);
        return result.ok ? { values: result.content, errors: {} } : { values: {}, errors: toFieldErrors<ProfileFormValues>(PROFILE_FIELDS, result.errors) };
    };
    const form = useForm<ProfileFormValues, unknown, ProfileContent>({ defaultValues: profile === null ? emptyProfileForm() : profileFormFrom(profile), resolver });
    const create = useCoreMutation('profiles.create');
    const update = useCoreMutation('profiles.update');
    const [generalError, setGeneralError] = useState<string | null>(null);
    const { errors } = form.formState;
    const type = form.watch('type');

    const submit = form.handleSubmit(async (content) => {
        setGeneralError(null);
        try {
            if (profile === null) {
                const created = await create.mutateAsync(content);
                toast.success(`Perfil ${created.name} criado.`, {
                    action: {
                        label: 'Abrir',
                        onClick: () => {
                            switchTo(created.id);
                        },
                    },
                });
            } else {
                await update.mutateAsync({ id: profile.id, name: content.name, currency: content.currency });
                toast.success(`Perfil ${content.name} salvo.`);
            }
            onClose();
        } catch (error) {
            reportRejection(
                error,
                PROFILE_FIELD_BY_CORE_FIELD,
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
            title={profile === null ? 'Novo perfil' : `Editar ${profile.name}`}
            description="Todo valor do perfil é gravado na moeda dele; a moeda só muda enquanto o perfil não tem lançamentos."
            submitLabel={profile === null ? 'Criar perfil' : 'Salvar'}
            pending={create.isPending || update.isPending}
            error={generalError}
            onSubmit={(event) => {
                void submit(event);
            }}
        >
            <Field id="profile-name" label="Nome do perfil" error={errors.name}>
                <Input id="profile-name" placeholder="Ex.: Pessoal" autoFocus {...fieldAria('profile-name', errors.name)} {...form.register('name')} />
            </Field>
            <div className="grid grid-cols-2 items-start gap-3">
                {profile === null ? (
                    <fieldset className="flex flex-col gap-1 text-13">
                        <legend className="text-muted">Tipo</legend>
                        <div className="flex items-center gap-4 pt-1.5">
                            {PROFILE_TYPES.map((option) => (
                                <label key={option} className="flex items-center gap-1.5 text-14">
                                    <input type="radio" value={option} className="accent-accent" {...form.register('type')} />
                                    {formatProfileType(option)}
                                </label>
                            ))}
                        </div>
                    </fieldset>
                ) : (
                    <div className="flex flex-col gap-1 text-13">
                        <span className="text-muted">Tipo</span>
                        <span className="pt-1.5 text-14">{formatProfileType(profile.type)}</span>
                        <span className="text-12 text-muted">O tipo não muda depois de criado.</span>
                    </div>
                )}
                <Field id="profile-currency" label="Moeda" error={errors.currency}>
                    <Controller
                        control={form.control}
                        name="currency"
                        render={({ field }) => (
                            <Select value={field.value} onValueChange={field.onChange}>
                                <SelectTrigger id="profile-currency" className="w-full" {...fieldAria('profile-currency', errors.currency)}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {currencyOptionsWith(profile?.currency ?? null).map((option) => (
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
            {type === 'business' && <p className="rounded-8 bg-soft px-3 py-2.5 text-13 text-soft-ink">{BUSINESS_WITHOUT_PARTNERS}</p>}
        </FormDialog>
    );
}
