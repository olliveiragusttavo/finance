import { formatMoneyForInput, parseMoneyInput } from '@finance/client';
import type { AccountResponse, CoreInput, CreditCardResponse } from '@finance/core';
import { creditCardContentShape } from '@finance/core/requests';
import { z } from 'zod';
import { collectIssues, DAY_OF_MONTH_MESSAGE, moneyInputMessage, parseDayOfMonth, type FieldTarget, type FormErrors } from '../lib/formIssues.ts';

/**
 * Conteúdo do cadastro do cartão, comum à criação e à edição: o que falta para virar a
 * entrada de `creditCards.create` é o perfil, e para `creditCards.update` é o id.
 */
export type CreditCardContent = Omit<CoreInput<'creditCards.update'>, 'id'>;

/**
 * Valores do formulário de cartão como estão nos campos. Limite e dias são texto: o limite é
 * digitado em pt-BR, e um dia lido como número ao digitar viraria `NaN` com o campo vazio.
 */
export interface CreditCardFormValues {
    readonly name: string;
    /** Conta que paga as faturas; vazio enquanto nada foi escolhido. */
    readonly accountId: string;
    readonly limit: string;
    readonly closingDay: string;
    readonly dueDay: string;
}

/** Campo do formulário, para apontar onde está cada erro. */
export type CreditCardField = keyof CreditCardFormValues;

/** Todos os campos, na ordem do diálogo; o teste confere que nenhum ficou de fora. */
export const CREDIT_CARD_FIELDS = ['name', 'accountId', 'limit', 'closingDay', 'dueDay'] as const satisfies readonly CreditCardField[];

/** Resultado da leitura do formulário: o conteúdo pronto para o núcleo, ou os erros. */
export type CreditCardFormResult =
    | { readonly ok: true; readonly content: CreditCardContent }
    | { readonly ok: false; readonly errors: FormErrors<CreditCardField> };

/** O mesmo schema do conteúdo que `creditCards.create` e `creditCards.update` aplicam. */
const creditCardContentSchema = z.strictObject(creditCardContentShape);

/** Campo da tela de cada caminho do schema, com o nome usado na mensagem. */
const FIELD_BY_PATH: Readonly<Record<string, FieldTarget<CreditCardField>>> = {
    name: { field: 'name', label: 'o nome do cartão', kind: 'name' },
    accountId: { field: 'accountId', label: 'a conta pagadora', kind: 'choice' },
    limit: { field: 'limit', label: 'o limite', kind: 'nonNegativeMoney' },
    closingDay: { field: 'closingDay', label: 'o dia de fechamento', kind: 'dayOfMonth' },
    dueDay: { field: 'dueDay', label: 'o dia de vencimento', kind: 'dayOfMonth' },
};

/** Id válido no formato, usado só para validar os outros campos sem conta escolhida. */
const PLACEHOLDER_ACCOUNT_ID = '00000000-0000-4000-8000-000000000000';

/** Primeiro dia que não existe em todo mês: fevereiro tem 28 nos anos comuns. */
const FIRST_DAY_NOT_IN_EVERY_MONTH = 29;

/**
 * @param defaultAccountId Conta sugerida como pagadora (a primeira ativa), ou vazio quando o
 * perfil não tem conta ativa.
 * @return Os campos em branco.
 */
export function emptyCreditCardForm(defaultAccountId: string): CreditCardFormValues {
    return { name: '', accountId: defaultAccountId, limit: '', closingDay: '', dueDay: '' };
}

/**
 * @param creditCard Cartão a editar, como `creditCards.list` o devolve.
 * @return Os campos preenchidos com o cadastro, com o limite escrito como o usuário o digitaria.
 */
export function creditCardFormFrom(creditCard: CreditCardResponse): CreditCardFormValues {
    return {
        name: creditCard.name,
        accountId: creditCard.accountId,
        limit: formatMoneyForInput(creditCard.limit),
        closingDay: String(creditCard.closingDay),
        dueDay: String(creditCard.dueDay),
    };
}

/**
 * Contas que podem pagar o cartão. Regra de negócio (Contas, desktop-mvp-plan §5.1): conta
 * desativada some das escolhas de cartões novos. Na edição, a conta que já paga o cartão fica
 * na lista mesmo desativada — o núcleo aceita mantê-la, e sem ela o campo apareceria vazio e
 * o cartão trocaria de conta sem o usuário pedir.
 *
 * @param accounts Contas do perfil.
 * @param currentAccountId Conta pagadora atual, na edição; `null` num cartão novo.
 * @return As contas que o campo oferece, na ordem da lista de contas.
 */
export function payingAccountOptions(accounts: readonly AccountResponse[], currentAccountId: string | null): readonly AccountResponse[] {
    return accounts.filter((account) => !account.disabled || account.id === currentAccountId);
}

/**
 * Aviso do fechamento num dia que não existe em todo mês. Regra de negócio (Cartão de
 * crédito, database-design §4.5): dia inexistente vira o último dia do mês — um cartão que
 * fecha no dia 31 fecha em 30/04 e em 28/02 —, e o dia gravado continua o digitado. O aviso
 * existe porque quem cadastra "31" pode esperar que abril pule o fechamento.
 *
 * @param closingDay Dia de fechamento como está no campo.
 * @return A explicação para dias 29 a 31; `null` para os demais e para texto que não é dia.
 */
export function closingDayWarning(closingDay: string): string | null {
    const day = parseDayOfMonth(closingDay);
    if (day === null || day < FIRST_DAY_NOT_IN_EVERY_MONTH || day > 31) {
        return null;
    }
    return `Nos meses sem o dia ${String(day)}, a fatura fecha no último dia do mês.`;
}

/**
 * Lê um dia digitado e diz o que mostrar quando ele não é um número.
 *
 * @param raw Texto do campo.
 * @param label Nome do campo com artigo, para a frase do campo vazio.
 * @return O dia (ou 1, que deixa o schema validar os outros campos) e a mensagem, quando há.
 */
function readDay(raw: string, label: string): { readonly day: number; readonly error: string | undefined } {
    const day = parseDayOfMonth(raw);
    if (day !== null) {
        return { day, error: undefined };
    }
    return { day: 1, error: raw.trim() === '' ? `Informe ${label}.` : DAY_OF_MONTH_MESSAGE };
}

/**
 * Lê o formulário de cartão e o valida com o schema de conteúdo das rotas de cartão, para que
 * a mensagem da tela e a recusa do núcleo nunca discordem (desktop-shell-design §5.4).
 * Regra de negócio (Cartão de crédito): limite é zero ou positivo, e fechamento e vencimento
 * são dias de 1 a 31 (database-design §4.5). O limite está na moeda do perfil.
 *
 * Campos que nem chegam a ser lidos (limite ou dia que não é número, conta não escolhida) não
 * interrompem a leitura: o schema roda com um valor neutro no lugar, para que os erros dos
 * outros campos apareçam no mesmo envio.
 *
 * @param values Valores dos campos, como o usuário os deixou.
 * @param profileCurrency Moeda do perfil ativo; define as casas do limite.
 * @return O conteúdo do cadastro, ou a mensagem de cada campo com problema.
 * @throws {Error} Quando o schema aponta um caminho que o formulário não tem.
 */
export function readCreditCardForm(values: CreditCardFormValues, profileCurrency: string): CreditCardFormResult {
    const limit = parseMoneyInput(values.limit, profileCurrency);
    const closing = readDay(values.closingDay, 'o dia de fechamento');
    const due = readDay(values.dueDay, 'o dia de vencimento');
    const initial: FormErrors<CreditCardField> = {};
    if (values.accountId === '') {
        initial.accountId = 'Escolha a conta que paga as faturas.';
    }
    if (!limit.ok) {
        initial.limit = moneyInputMessage(limit.reason, profileCurrency, 'nonNegative') ?? 'Informe o limite do cartão.';
    }
    if (closing.error !== undefined) {
        initial.closingDay = closing.error;
    }
    if (due.error !== undefined) {
        initial.dueDay = due.error;
    }
    const content: CreditCardContent = {
        accountId: values.accountId,
        name: values.name,
        limit: limit.ok ? limit.amount : 0,
        closingDay: closing.day,
        dueDay: due.day,
    };
    // A conta vazia é recusada pelo id do domínio com uma frase técnica; o aviso de cima já a
    // cobre, então o schema valida o resto com o campo fora do caminho.
    const parsed = creditCardContentSchema.safeParse(values.accountId === '' ? { ...content, accountId: PLACEHOLDER_ACCOUNT_ID } : content);
    if (parsed.success && Object.keys(initial).length === 0) {
        return { ok: true, content: { ...content, name: parsed.data.name } };
    }
    return { ok: false, errors: collectIssues(parsed.success ? [] : parsed.error.issues, FIELD_BY_PATH, profileCurrency, initial) };
}
