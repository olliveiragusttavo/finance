import { parseMoneyInput } from '@finance/client';
import type { CoreInput } from '@finance/core';
import { startOnboardingRequest } from '@finance/core/requests';
import { collectIssues, moneyInputMessage, type FieldTarget, type FormErrors } from '../lib/formIssues.ts';

/** Entrada da rota `onboarding.start`, o que o formulário entrega ao núcleo. */
export type OnboardingInput = CoreInput<'onboarding.start'>;

/**
 * Valores do formulário do primeiro uso como estão nos campos. O saldo inicial é texto porque
 * o usuário digita em pt-BR (`1.234,56`) e só o `parseMoneyInput` sabe lê-lo; os demais já
 * têm o tipo da rota, porque vêm de escolhas fechadas.
 */
export interface OnboardingFormValues {
    readonly profileName: string;
    readonly profileType: OnboardingInput['profile']['type'];
    readonly currency: string;
    readonly accountName: string;
    readonly accountType: OnboardingInput['account']['type'];
    readonly openingBalance: string;
}

/** Campo do formulário, para apontar onde está cada erro. */
export type OnboardingField = keyof OnboardingFormValues;

/**
 * Todos os campos, na ordem da tela. Existe para percorrer os erros com o tipo do campo, que
 * `Object.keys` perderia. O `satisfies` recusa nome que não é campo; o teste confere que
 * nenhum campo ficou de fora.
 */
export const ONBOARDING_FIELDS = ['profileName', 'profileType', 'currency', 'accountName', 'accountType', 'openingBalance'] as const satisfies readonly OnboardingField[];

/** Mensagem de erro por campo; só os campos com problema aparecem. */
export type OnboardingErrors = FormErrors<OnboardingField>;

/** Resultado da leitura do formulário: a entrada pronta para o núcleo, ou os erros. */
export type OnboardingFormResult =
    | { readonly ok: true; readonly input: OnboardingInput }
    | { readonly ok: false; readonly errors: OnboardingErrors };

/**
 * Formulário em branco. Pessoal, real e conta corrente são o caso comum de quem instala um
 * app de finanças pessoais no Brasil, e o mockup já os traz marcados.
 */
export const EMPTY_ONBOARDING_FORM: OnboardingFormValues = {
    profileName: '',
    profileType: 'personal',
    currency: 'BRL',
    accountName: '',
    accountType: 'checking',
    openingBalance: '',
};

/**
 * Campo do formulário de cada caminho da entrada da rota, com o nome usado na mensagem. É o
 * que liga um problema apontado pelo schema do núcleo (`profile.name`) ao campo da tela.
 */
const FIELD_BY_PATH: Readonly<Record<string, FieldTarget<OnboardingField>>> = {
    'profile.name': { field: 'profileName', label: 'o nome do perfil', kind: 'name' },
    'profile.type': { field: 'profileType', label: 'o tipo do perfil', kind: 'choice' },
    'profile.currency': { field: 'currency', label: 'a moeda', kind: 'choice' },
    'account.name': { field: 'accountName', label: 'o nome da conta', kind: 'name' },
    'account.type': { field: 'accountType', label: 'o tipo da conta', kind: 'choice' },
    'account.openingBalance': { field: 'openingBalance', label: 'o saldo inicial', kind: 'money' },
};

/**
 * Lê o formulário e o valida com o `startOnboardingRequest`, o mesmo schema que o núcleo
 * aplica na fronteira (desktop-shell-design §5.4): a mensagem de conforto da tela e a recusa
 * do núcleo nunca discordam, e o limite do nome não é repetido aqui.
 * Regra de negócio (Contas): saldo inicial em branco é zero, o padrão do cadastro
 * (database-design §4.4) — quem abre uma conta nova não tem o que digitar.
 * Regra de negócio (Dinheiro): o saldo fica entre −1 trilhão e 1 trilhão (`MONEY_MAX_AMOUNT`).
 *
 * O saldo recusado pelo `parseMoneyInput` não interrompe a leitura: o schema roda com zero no
 * lugar dele, para que os erros dos outros campos apareçam no mesmo envio, e não só depois de
 * o usuário corrigir o saldo.
 *
 * @param values Valores dos campos, como o usuário os deixou.
 * @return A entrada da rota `onboarding.start`, ou a mensagem de cada campo com problema.
 * @throws {Error} Quando o schema aponta um caminho que o formulário não tem, um erro de
 * montagem: o formulário e a rota saíram de sincronia.
 */
export function readOnboardingForm(values: OnboardingFormValues): OnboardingFormResult {
    const balance = parseMoneyInput(values.openingBalance, values.currency);
    const balanceError = balance.ok ? undefined : moneyInputMessage(balance.reason, values.currency, 'signed');
    const input: OnboardingInput = {
        profile: { name: values.profileName, type: values.profileType, currency: values.currency },
        account: { name: values.accountName, type: values.accountType, openingBalance: balance.ok ? balance.amount : 0 },
    };
    const parsed = startOnboardingRequest.safeParse(input);
    if (parsed.success && balanceError === undefined) {
        return { ok: true, input };
    }
    const initial: OnboardingErrors = balanceError === undefined ? {} : { openingBalance: balanceError };
    return { ok: false, errors: collectIssues(parsed.success ? [] : parsed.error.issues, FIELD_BY_PATH, values.currency, initial) };
}
