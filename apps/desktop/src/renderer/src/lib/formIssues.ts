import { formatMoneyForInput, type MoneyInputRejection } from '@finance/client';
import { MONEY_MAX_AMOUNT } from '@finance/core';
import type { z } from 'zod';

/*
 * Tradução dos problemas de validação para as mensagens dos formulários. Os formulários
 * validam com os schemas da camada Request do núcleo (desktop-shell-design §5.4); este módulo
 * só transforma o problema apontado pelo schema na frase que aparece abaixo do campo, para
 * que todo formulário do app fale do mesmo jeito sobre o mesmo erro.
 */

/**
 * Natureza do campo, que decide a frase de um problema de faixa (`too_small`/`too_big`): o
 * mesmo código do Zod significa "nome em branco" num texto e "fora do teto" num valor.
 */
export type FieldKind = 'name' | 'money' | 'nonNegativeMoney' | 'dayOfMonth' | 'choice';

/** Campo da tela que corresponde a um caminho da entrada da rota. */
export interface FieldTarget<F extends string> {
    readonly field: F;
    /** Nome do campo com artigo, para compor a frase ("o nome da conta"). */
    readonly label: string;
    readonly kind: FieldKind;
}

/**
 * Sinal que o campo de dinheiro aceita, para a mensagem do teto não sugerir um valor que o
 * campo recusaria (um limite de cartão negativo, por exemplo).
 */
export type MoneySign = 'signed' | 'nonNegative';

/** Mensagem por campo; só os campos com problema aparecem. */
export type FormErrors<F extends string> = Partial<Record<F, string>>;

/**
 * Mensagem do teto de valor monetário, com o número escrito como o usuário o digitaria.
 * Regra de negócio (Dinheiro): o valor fica entre −1 trilhão e 1 trilhão (`MONEY_MAX_AMOUNT`).
 *
 * @param currencyCode Moeda do valor; define as casas decimais do teto (`1.000.000.000.000,00`).
 * @param sign Sinal que o campo aceita; só o campo que aceita negativo fala em "positivo ou
 * negativo", senão quem segue a mensagem e digita um negativo recebe outro erro.
 * @return A frase que aparece abaixo do campo de dinheiro.
 */
export function moneyLimitMessage(currencyCode: string, sign: MoneySign): string {
    const limit = formatMoneyForInput({ amount: MONEY_MAX_AMOUNT, currency: currencyCode });
    return sign === 'signed' ? `Use um valor de até ${limit}, positivo ou negativo.` : `Use um valor de até ${limit}.`;
}

/**
 * Mensagem do valor que o `parseMoneyInput` recusou. O campo vazio não tem mensagem: nos
 * cadastros, valor em branco é zero (saldo inicial, limite), e quem chama decide isso.
 *
 * @param reason Motivo da recusa.
 * @param currencyCode Moeda do valor; define as casas com que o teto aparece na mensagem.
 * @param sign Sinal que o campo aceita, para a mensagem do teto não sugerir um valor recusado.
 * @return A frase que aparece abaixo do campo, ou `undefined` para o campo vazio.
 */
export function moneyInputMessage(reason: MoneyInputRejection, currencyCode: string, sign: MoneySign): string | undefined {
    if (reason === 'empty') {
        return undefined;
    }
    return reason === 'tooLarge' ? moneyLimitMessage(currencyCode, sign) : 'Digite um valor como 1.234,56.';
}

/** Frase do dia do mês fora da faixa, a mesma para fechamento e vencimento. */
export const DAY_OF_MONTH_MESSAGE = 'Use um dia de 1 a 31.';

/**
 * Lê um dia do mês digitado. Só aceita algarismos: `1.5` ou `10a` não podem virar `1` ou `10`
 * em silêncio, porque o dia decide em que fatura cada compra cai.
 *
 * @param raw Texto do campo.
 * @return O dia como número, ou `null` quando o texto não é um número inteiro; a faixa 1–31
 * fica com o schema do núcleo, que é quem a define.
 */
export function parseDayOfMonth(raw: string): number | null {
    const trimmed = raw.trim();
    return /^\d{1,2}$/.test(trimmed) ? Number(trimmed) : null;
}

/**
 * Mensagem em pt-BR de um problema do schema. A do Zod é em inglês e técnica ("Too small:
 * expected string to have >=1 characters"); a tela fala com o usuário.
 *
 * @param issue Problema apontado pelo schema.
 * @param target Campo do problema, com o rótulo e a natureza que escolhem a frase.
 * @param currencyCode Moeda dos valores do formulário; define as casas com que o teto aparece.
 * @return A frase que aparece abaixo do campo.
 */
export function issueMessage(issue: z.core.$ZodIssue, target: FieldTarget<string>, currencyCode: string): string {
    const range = issue.code === 'too_small' || issue.code === 'too_big';
    switch (target.kind) {
        case 'name':
            if (issue.code === 'too_small') {
                return `Informe ${target.label}.`;
            }
            if (issue.code === 'too_big') {
                return `Use no máximo ${String(issue.maximum)} caracteres.`;
            }
            break;
        case 'money':
            // O teto já é recusado pelo `parseMoneyInput`; este caso só existe para o schema do
            // núcleo e o formulário nunca darem mensagens diferentes para o mesmo valor.
            if (range) {
                return moneyLimitMessage(currencyCode, 'signed');
            }
            break;
        case 'nonNegativeMoney':
            if (issue.code === 'too_small' && issue.minimum === 0) {
                return `Use zero ou um valor positivo para ${target.label}.`;
            }
            if (range) {
                return moneyLimitMessage(currencyCode, 'nonNegative');
            }
            break;
        case 'dayOfMonth':
            if (range) {
                return DAY_OF_MONTH_MESSAGE;
            }
            break;
        case 'choice':
            break;
    }
    // Escolhas fechadas e formatos que a tela já garante só caem aqui se o formulário e a
    // rota saírem de sincronia.
    return `Confira ${target.label}.`;
}

/**
 * Junta os problemas do schema às mensagens que o formulário já apurou (valor ou dia que nem
 * chegou a ser lido). O primeiro erro de cada campo vence: é o que o usuário precisa
 * corrigir primeiro, e uma pilha de frases sobre o mesmo campo só confundiria.
 *
 * @param issues Problemas apontados pelo schema.
 * @param fieldByPath Campo da tela de cada caminho da entrada da rota.
 * @param currencyCode Moeda dos valores do formulário.
 * @param initial Erros já apurados pelo formulário antes do schema.
 * @return A mensagem de cada campo com problema.
 * @throws {Error} Quando o schema aponta um caminho que o formulário não tem, um erro de
 * montagem: o formulário e a rota saíram de sincronia.
 */
export function collectIssues<F extends string>(
    issues: readonly z.core.$ZodIssue[],
    fieldByPath: Readonly<Record<string, FieldTarget<F>>>,
    currencyCode: string,
    initial: FormErrors<F>,
): FormErrors<F> {
    const errors: FormErrors<F> = { ...initial };
    for (const issue of issues) {
        const path = issue.path.join('.');
        const target = fieldByPath[path];
        if (target === undefined) {
            throw new Error(`o formulário não tem campo para o caminho "${path}"`);
        }
        errors[target.field] ??= issueMessage(issue, target, currencyCode);
    }
    return errors;
}
