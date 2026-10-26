import { formatMoneyForInput, parseMoneyInput } from '@finance/client';
import type { AccountResponse, CoreInput } from '@finance/core';
import { accountContentShape } from '@finance/core/requests';
import { z } from 'zod';
import { collectIssues, moneyInputMessage, type FieldTarget, type FormErrors } from '../lib/formIssues.ts';

/**
 * Conteúdo do cadastro da conta, comum à criação e à edição: o que falta para virar a entrada
 * de `accounts.create` é o perfil, e para `accounts.update` é o id.
 */
export type AccountContent = Omit<CoreInput<'accounts.update'>, 'id'>;

/**
 * Valores do formulário de conta como estão nos campos. O saldo inicial é texto porque o
 * usuário digita em pt-BR (`1.234,56`) e só o `parseMoneyInput` sabe lê-lo.
 */
export interface AccountFormValues {
    readonly name: string;
    readonly type: AccountContent['type'];
    /** Moeda da conta no mundo real; só rótulo (database-design §4.4). */
    readonly currency: string;
    readonly considerBalance: boolean;
    readonly openingBalance: string;
}

/** Campo do formulário, para apontar onde está cada erro. */
export type AccountField = keyof AccountFormValues;

/** Todos os campos, na ordem do diálogo; o teste confere que nenhum ficou de fora. */
export const ACCOUNT_FIELDS = ['name', 'type', 'currency', 'considerBalance', 'openingBalance'] as const satisfies readonly AccountField[];

/** Resultado da leitura do formulário: o conteúdo pronto para o núcleo, ou os erros. */
export type AccountFormResult = { readonly ok: true; readonly content: AccountContent } | { readonly ok: false; readonly errors: FormErrors<AccountField> };

/** O mesmo schema do conteúdo que `accounts.create` e `accounts.update` aplicam. */
const accountContentSchema = z.strictObject(accountContentShape);

/** Campo da tela de cada caminho do schema, com o nome usado na mensagem. */
const FIELD_BY_PATH: Readonly<Record<string, FieldTarget<AccountField>>> = {
    name: { field: 'name', label: 'o nome da conta', kind: 'name' },
    type: { field: 'type', label: 'o tipo da conta', kind: 'choice' },
    currencyLabel: { field: 'currency', label: 'a moeda', kind: 'choice' },
    considerBalance: { field: 'considerBalance', label: 'se a conta entra no total', kind: 'choice' },
    openingBalance: { field: 'openingBalance', label: 'o saldo inicial', kind: 'money' },
};

/**
 * Formulário de conta nova. Corrente, na moeda do perfil e somando no total é o caso comum;
 * os mesmos padrões do schema (database-design §4.4).
 *
 * @param profileCurrency Moeda do perfil ativo, a moeda padrão da conta.
 * @return Os campos em branco.
 */
export function emptyAccountForm(profileCurrency: string): AccountFormValues {
    return { name: '', type: 'checking', currency: profileCurrency, considerBalance: true, openingBalance: '' };
}

/**
 * @param account Conta a editar, como `accounts.list` a devolve.
 * @return Os campos preenchidos com o cadastro, com o saldo escrito como o usuário o digitaria.
 */
export function accountFormFrom(account: AccountResponse): AccountFormValues {
    return {
        name: account.name,
        type: account.type,
        currency: account.currency,
        considerBalance: account.considerBalance,
        openingBalance: formatMoneyForInput(account.openingBalance),
    };
}

/**
 * Lê o formulário de conta e o valida com o schema de conteúdo das rotas de conta, para que a
 * mensagem da tela e a recusa do núcleo nunca discordem (desktop-shell-design §5.4).
 * Regra de negócio (Contas): saldo inicial em branco é zero, o padrão do cadastro
 * (database-design §4.4). O saldo está na moeda do **perfil**, e não na da conta: a moeda da
 * conta é só rótulo, e todo valor gravado está na moeda do perfil (database-design §4.1).
 *
 * O saldo recusado pelo `parseMoneyInput` não interrompe a leitura: o schema roda com zero no
 * lugar dele, para que os erros dos outros campos apareçam no mesmo envio.
 *
 * @param values Valores dos campos, como o usuário os deixou.
 * @param profileCurrency Moeda do perfil ativo; define as casas do saldo.
 * @return O conteúdo do cadastro, ou a mensagem de cada campo com problema.
 * @throws {Error} Quando o schema aponta um caminho que o formulário não tem.
 */
export function readAccountForm(values: AccountFormValues, profileCurrency: string): AccountFormResult {
    const balance = parseMoneyInput(values.openingBalance, profileCurrency);
    const balanceError = balance.ok ? undefined : moneyInputMessage(balance.reason, profileCurrency, 'signed');
    const content: AccountContent = {
        name: values.name,
        type: values.type,
        currencyLabel: values.currency,
        considerBalance: values.considerBalance,
        openingBalance: balance.ok ? balance.amount : 0,
    };
    const parsed = accountContentSchema.safeParse(content);
    if (parsed.success && balanceError === undefined) {
        // O nome sai aparado, como o núcleo o grava, para que a lista não mostre espaços.
        return { ok: true, content: { ...content, name: parsed.data.name } };
    }
    const initial: FormErrors<AccountField> = balanceError === undefined ? {} : { openingBalance: balanceError };
    return { ok: false, errors: collectIssues(parsed.success ? [] : parsed.error.issues, FIELD_BY_PATH, profileCurrency, initial) };
}
