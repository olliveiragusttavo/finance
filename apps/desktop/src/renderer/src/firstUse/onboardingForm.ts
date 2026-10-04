import { formatMoneyForInput, parseMoneyInput, type MoneyInputRejection } from '@finance/client';
import { MONEY_MAX_AMOUNT, type CoreInput } from '@finance/core';
import { startOnboardingRequest } from '@finance/core/requests';
import type { z } from 'zod';

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
export type OnboardingErrors = Partial<Record<OnboardingField, string>>;

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

/** Moedas oferecidas no primeiro uso, as do mockup; o código é o que o núcleo grava. */
export const CURRENCY_OPTIONS: readonly { readonly code: string; readonly label: string }[] = [
    { code: 'BRL', label: 'BRL — Real' },
    { code: 'USD', label: 'USD — Dólar' },
];

/**
 * Campo do formulário de cada caminho da entrada da rota, com o nome usado na mensagem. É o
 * que liga um problema apontado pelo schema do núcleo (`profile.name`) ao campo da tela.
 */
const FIELD_BY_PATH: Readonly<Record<string, { readonly field: OnboardingField; readonly label: string }>> = {
    'profile.name': { field: 'profileName', label: 'o nome do perfil' },
    'profile.type': { field: 'profileType', label: 'o tipo do perfil' },
    'profile.currency': { field: 'currency', label: 'a moeda' },
    'account.name': { field: 'accountName', label: 'o nome da conta' },
    'account.type': { field: 'accountType', label: 'o tipo da conta' },
    'account.openingBalance': { field: 'openingBalance', label: 'o saldo inicial' },
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
    const balanceError = balance.ok ? undefined : balanceMessage(balance.reason, values.currency);
    const input: OnboardingInput = {
        profile: { name: values.profileName, type: values.profileType, currency: values.currency },
        account: { name: values.accountName, type: values.accountType, openingBalance: balance.ok ? balance.amount : 0 },
    };
    const parsed = startOnboardingRequest.safeParse(input);
    if (parsed.success && balanceError === undefined) {
        return { ok: true, input };
    }
    const errors: OnboardingErrors = balanceError === undefined ? {} : { openingBalance: balanceError };
    for (const issue of parsed.success ? [] : parsed.error.issues) {
        const target = FIELD_BY_PATH[issue.path.join('.')];
        if (target === undefined) {
            throw new Error(`o primeiro uso não tem campo para o caminho "${issue.path.join('.')}"`);
        }
        errors[target.field] ??= issueMessage(issue, target.label, values.currency);
    }
    return { ok: false, errors };
}

/**
 * Mensagem do saldo que o `parseMoneyInput` recusou. O campo vazio não é erro aqui — vale
 * zero, pela regra do cadastro —, por isso só ele não tem mensagem.
 *
 * @param reason Motivo da recusa.
 * @param currencyCode Moeda escolhida; define as casas com que o teto aparece na mensagem.
 * @return A frase que aparece abaixo do campo, ou `undefined` para o campo vazio.
 */
function balanceMessage(reason: MoneyInputRejection, currencyCode: string): string | undefined {
    if (reason === 'empty') {
        return undefined;
    }
    return reason === 'tooLarge' ? moneyLimitMessage(currencyCode) : 'Digite um valor como 1.234,56.';
}

/**
 * Mensagem do teto de valor monetário, com o número escrito como o usuário o digitaria.
 * Regra de negócio (Dinheiro): o valor fica entre −1 trilhão e 1 trilhão (`MONEY_MAX_AMOUNT`).
 *
 * @param currencyCode Moeda escolhida; define as casas decimais do teto (`1.000.000.000.000,00`).
 * @return A frase que aparece abaixo do campo de dinheiro.
 */
function moneyLimitMessage(currencyCode: string): string {
    return `Use um valor de até ${formatMoneyForInput({ amount: MONEY_MAX_AMOUNT, currency: currencyCode })}, positivo ou negativo.`;
}

/**
 * Mensagem em pt-BR de um problema do schema. A do Zod é em inglês e técnica ("Too small:
 * expected string to have >=1 characters"); a tela fala com o usuário.
 *
 * @param issue Problema apontado pelo schema.
 * @param label Nome do campo com artigo, para compor a frase.
 * @param currencyCode Moeda escolhida; define as casas com que o teto de dinheiro aparece.
 * @return A frase que aparece abaixo do campo.
 */
function issueMessage(issue: z.core.$ZodIssue, label: string, currencyCode: string): string {
    // O teto do saldo já é recusado pelo `parseMoneyInput`; este caso só existe para o schema
    // do núcleo e o formulário nunca darem mensagens diferentes para o mesmo valor.
    if ((issue.code === 'too_small' || issue.code === 'too_big') && issue.origin === 'number') {
        return moneyLimitMessage(currencyCode);
    }
    // Os nomes têm limite de tamanho; os demais campos vêm de escolhas fechadas e só caem
    // na frase genérica se o formulário e a rota saírem de sincronia.
    if (issue.code === 'too_small') {
        return `Informe ${label}.`;
    }
    if (issue.code === 'too_big') {
        return `Use no máximo ${String(issue.maximum)} caracteres.`;
    }
    return `Confira ${label}.`;
}
