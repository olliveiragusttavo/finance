import type { CoreInput, ProfileResponse } from '@finance/core';
import { createProfileRequest } from '@finance/core/requests';
import { collectIssues, type FieldTarget, type FormErrors } from '../lib/formIssues.ts';

/** Entrada de `profiles.create`: o cadastro completo do perfil. */
export type ProfileContent = CoreInput<'profiles.create'>;

/** Valores do formulário de perfil; todos vêm de texto ou de escolhas fechadas. */
export interface ProfileFormValues {
    readonly name: string;
    readonly type: ProfileContent['type'];
    readonly currency: string;
}

/** Campo do formulário, para apontar onde está cada erro. */
export type ProfileField = keyof ProfileFormValues;

/** Todos os campos, na ordem do diálogo; o teste confere que nenhum ficou de fora. */
export const PROFILE_FIELDS = ['name', 'type', 'currency'] as const satisfies readonly ProfileField[];

/** Resultado da leitura do formulário: o cadastro pronto para o núcleo, ou os erros. */
export type ProfileFormResult = { readonly ok: true; readonly content: ProfileContent } | { readonly ok: false; readonly errors: FormErrors<ProfileField> };

/** Campo da tela de cada caminho do schema, com o nome usado na mensagem. */
const FIELD_BY_PATH: Readonly<Record<string, FieldTarget<ProfileField>>> = {
    name: { field: 'name', label: 'o nome do perfil', kind: 'name' },
    type: { field: 'type', label: 'o tipo do perfil', kind: 'choice' },
    currency: { field: 'currency', label: 'a moeda', kind: 'choice' },
};

/**
 * Formulário de perfil novo: pessoal em real, o mesmo padrão do primeiro uso.
 *
 * @return Os campos em branco.
 */
export function emptyProfileForm(): ProfileFormValues {
    return { name: '', type: 'personal', currency: 'BRL' };
}

/**
 * @param profile Perfil a editar.
 * @return Os campos preenchidos com o cadastro.
 */
export function profileFormFrom(profile: ProfileResponse): ProfileFormValues {
    return { name: profile.name, type: profile.type, currency: profile.currency };
}

/**
 * Lê o formulário de perfil e o valida com o `createProfileRequest`, o mesmo schema da rota.
 * A edição usa a mesma leitura: o tipo não muda depois de criado (`profiles.update` não o
 * recebe), mas validar o cadastro inteiro mantém uma única fonte para as mensagens.
 * Regra de negócio (Perfis): a moeda só muda enquanto o perfil não tem lançamentos
 * (desktop-mvp-plan §5). Essa recusa não é conferida aqui, porque só o núcleo sabe se há
 * lançamentos; ela volta apontando o campo da moeda.
 *
 * @param values Valores dos campos, como o usuário os deixou.
 * @return O cadastro do perfil, ou a mensagem de cada campo com problema.
 * @throws {Error} Quando o schema aponta um caminho que o formulário não tem.
 */
export function readProfileForm(values: ProfileFormValues): ProfileFormResult {
    const parsed = createProfileRequest.safeParse(values);
    if (parsed.success) {
        return { ok: true, content: { ...values, name: parsed.data.name } };
    }
    return { ok: false, errors: collectIssues(parsed.error.issues, FIELD_BY_PATH, values.currency, {}) };
}
