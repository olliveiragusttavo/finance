import { formatMoneyForInput, parseMoneyInput } from '@finance/client';
import type { CoreInput, GoalResponse } from '@finance/core';
import { goalContentShape } from '@finance/core/requests';
import { z } from 'zod';
import { collectIssues, moneyInputMessage, type FieldTarget, type FormErrors } from '../lib/formIssues.ts';

/*
 * Formulário de meta (mockup `DesktopMetas`; desktop-mvp-plan Fase 9.3). Valida com o schema do
 * conteúdo de `goals.create` e `goals.update`, para que a mensagem da tela e a recusa do núcleo
 * nunca discordem (desktop-shell-design §5.4). Fica fora do componente para ter teste sem DOM.
 */

/** Conteúdo da meta, comum à criação e à edição: falta o perfil para criar e o id para editar. */
export type GoalContent = Omit<CoreInput<'goals.update'>, 'id'>;

/** Valores do formulário, como estão nos campos. */
export interface GoalFormValues {
    readonly name: string;
    /** Valor-alvo digitado em pt-BR (`4.000,00`). */
    readonly value: string;
    /** Data-alvo `YYYY-MM-DD`; vazio é a meta sem prazo. */
    readonly targetDate: string;
}

/** Campo do formulário. */
export type GoalField = keyof GoalFormValues;

/** Todos os campos, na ordem do diálogo; o teste confere que nenhum ficou de fora. */
export const GOAL_FIELDS = ['name', 'value', 'targetDate'] as const satisfies readonly GoalField[];

/** Resultado da leitura: o conteúdo pronto para o núcleo, ou os erros. */
export type GoalFormResult = { readonly ok: true; readonly content: GoalContent } | { readonly ok: false; readonly errors: FormErrors<GoalField> };

/** O mesmo schema do conteúdo que as rotas de meta aplicam. */
const goalContentSchema = z.strictObject(goalContentShape);

/** Campo da tela de cada caminho do schema, com o nome usado na mensagem. */
const FIELD_BY_PATH: Readonly<Record<string, FieldTarget<GoalField>>> = {
    name: { field: 'name', label: 'o nome da meta', kind: 'name' },
    value: { field: 'value', label: 'o valor-alvo', kind: 'money' },
    targetDate: { field: 'targetDate', label: 'a data-alvo', kind: 'choice' },
};

/**
 * Valores iniciais de "Nova meta". Função, e não constante, para que cada abertura do diálogo
 * receba um objeto próprio, sem estado compartilhado entre formulários. O valor começa vazio, e não em `0,00`,
 * porque o alvo precisa ser maior que zero e um zero pré-preenchido seria um valor inválido
 * pronto para salvar; a data vazia é a meta sem prazo, que é válida (database-design §4.11).
 *
 * @return Os campos em branco de uma meta nova.
 */
export function emptyGoalForm(): GoalFormValues {
    return { name: '', value: '', targetDate: '' };
}

/**
 * @param goal Meta a editar.
 * @return Os campos preenchidos, com o valor escrito como o usuário o digitaria.
 */
export function goalFormFrom(goal: GoalResponse): GoalFormValues {
    return { name: goal.name, value: formatMoneyForInput(goal.value), targetDate: goal.targetDate ?? '' };
}

/**
 * Lê o formulário de meta.
 * Regra de negócio (Metas, database-design §4.11): o valor-alvo é maior que zero e a data-alvo é
 * opcional — em branco, a meta não tem prazo (reserva de emergência).
 *
 * O valor recusado pelo `parseMoneyInput` não interrompe a leitura: o schema roda com um valor
 * neutro no lugar dele, para que os erros dos outros campos apareçam no mesmo envio.
 *
 * @param values Valores dos campos.
 * @param profileCurrency Moeda do perfil ativo; define as casas do valor.
 * @return O conteúdo da meta, ou a mensagem de cada campo com problema.
 * @throws {Error} Quando o schema aponta um caminho que o formulário não tem.
 */
export function readGoalForm(values: GoalFormValues, profileCurrency: string): GoalFormResult {
    const initial: FormErrors<GoalField> = {};
    const amount = parseMoneyInput(values.value, profileCurrency);
    if (!amount.ok) {
        initial.value = moneyInputMessage(amount.reason, profileCurrency, 'nonNegative') ?? 'Informe o valor-alvo.';
    } else if (amount.amount <= 0) {
        initial.value = 'Use um valor-alvo maior que zero.';
    }
    const content: GoalContent = {
        name: values.name,
        value: amount.ok && amount.amount > 0 ? amount.amount : 1,
        targetDate: values.targetDate.trim() === '' ? null : values.targetDate,
    };
    const parsed = goalContentSchema.safeParse(content);
    if (parsed.success && Object.keys(initial).length === 0) {
        // O nome sai aparado, como o núcleo o grava.
        return { ok: true, content: { ...content, name: parsed.data.name } };
    }
    return { ok: false, errors: collectIssues(parsed.success ? [] : parsed.error.issues, FIELD_BY_PATH, profileCurrency, initial) };
}
