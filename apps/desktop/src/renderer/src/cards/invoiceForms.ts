import { formatMoney, parseMoneyInput } from '@finance/client';
import { LocalDate, type AccountResponse, type CoreInput, type MoneyResponse } from '@finance/core';
import { createTransactionRequest, payInvoiceRequest } from '@finance/core/requests';
import { collectIssues, moneyInputMessage, type FieldTarget, type FormErrors } from '../lib/formIssues.ts';

/*
 * Formulários de pagamento da fatura (desktop-mvp-plan Fase 8): pagar a fatura inteira e o
 * pagamento parcial. Validam com os schemas das rotas que vão chamar — `invoices.pay` e
 * `transactions.create` —, para que a mensagem da tela e a recusa do núcleo nunca discordem
 * (desktop-shell-design §5.4).
 */

/** Mensagem da data em branco, a mesma nos dois formulários. */
const EMPTY_DATE_MESSAGE = 'Informe a data do pagamento.';

/** Id válido no formato, usado só para validar os outros campos sem escolha feita. */
const PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000000';

/** Data válida no formato, usada só para validar os outros campos sem data. */
const PLACEHOLDER_DATE = '2000-01-01';

/**
 * Mês de uma data digitada, para a prévia do saldo enquanto o usuário escolhe a data: a
 * prévia lê o extrato do mês do pagamento, e um campo incompleto não pode virar consulta.
 *
 * @param date Texto do campo de data.
 * @return A competência `YYYY-MM`, ou `null` quando o texto não é uma data válida.
 */
export function periodOfDate(date: string): string | null {
    try {
        return LocalDate.parse(date).period.toString();
    } catch {
        return null;
    }
}

/** Valores do formulário de pagar a fatura, como estão nos campos. */
export interface PayInvoiceFormValues {
    /** `YYYY-MM-DD` do campo de data; vazio enquanto nada foi escolhido. */
    readonly paymentDate: string;
}

/** Campo do formulário de pagar. */
export type PayInvoiceField = keyof PayInvoiceFormValues;

/** Todos os campos de pagar, na ordem do diálogo. */
export const PAY_INVOICE_FIELDS = ['paymentDate'] as const satisfies readonly PayInvoiceField[];

/** Resultado da leitura do formulário de pagar: a entrada da rota, ou os erros. */
export type PayInvoiceFormResult = { readonly ok: true; readonly input: CoreInput<'invoices.pay'> } | { readonly ok: false; readonly errors: FormErrors<PayInvoiceField> };

/** Campo da tela de cada caminho do `payInvoiceRequest`. */
const PAY_FIELD_BY_PATH: Readonly<Record<string, FieldTarget<PayInvoiceField>>> = {
    paymentDate: { field: 'paymentDate', label: 'a data do pagamento', kind: 'choice' },
};

/**
 * Lê o formulário de pagar a fatura inteira.
 * Regra de negócio (Fatura): a data do pagamento decide o extrato da conta pagadora que
 * absorve a fatura (database-design §4.7), então é obrigatória.
 *
 * @param values Valores dos campos.
 * @param invoiceId Fatura a pagar.
 * @return A entrada de `invoices.pay`, ou a mensagem do campo com problema.
 * @throws {Error} Quando o schema aponta um caminho que o formulário não tem.
 */
export function readPayInvoiceForm(values: PayInvoiceFormValues, invoiceId: string): PayInvoiceFormResult {
    if (values.paymentDate.trim() === '') {
        return { ok: false, errors: { paymentDate: EMPTY_DATE_MESSAGE } };
    }
    const input = { invoiceId, paymentDate: values.paymentDate };
    const parsed = payInvoiceRequest.safeParse(input);
    // A moeda só compõe frases de valor, que este formulário não tem.
    return parsed.success ? { ok: true, input } : { ok: false, errors: collectIssues(parsed.error.issues, PAY_FIELD_BY_PATH, 'BRL', {}) };
}

/** Nome do lançamento que registra o pagamento parcial; o extrato completa com a fatura. */
export const PARTIAL_PAYMENT_NAME = 'Pagamento parcial';

/** Valores do formulário de pagamento parcial, como estão nos campos. */
export interface PartialPaymentFormValues {
    /** Valor pago, digitado em pt-BR. */
    readonly amount: string;
    /** `YYYY-MM-DD`; vazio enquanto nada foi escolhido. */
    readonly paymentDate: string;
    /** Conta de onde o dinheiro saiu; vazio enquanto nada foi escolhido. */
    readonly accountId: string;
    /** Subcategoria do lançamento, que toda transação exige (database-design §4.13). */
    readonly subCategoryId: string;
}

/** Campo do formulário de pagamento parcial. */
export type PartialPaymentField = keyof PartialPaymentFormValues;

/** Todos os campos do pagamento parcial, na ordem do diálogo; o teste confere que nenhum ficou de fora. */
export const PARTIAL_PAYMENT_FIELDS = ['amount', 'paymentDate', 'accountId', 'subCategoryId'] as const satisfies readonly PartialPaymentField[];

/** Resultado da leitura do pagamento parcial: a entrada da rota, ou os erros. */
export type PartialPaymentFormResult =
    | { readonly ok: true; readonly input: CoreInput<'transactions.create'> }
    | { readonly ok: false; readonly errors: FormErrors<PartialPaymentField> };

/** Fatura que recebe o pagamento parcial. */
export interface PartialPaymentTarget {
    readonly profileId: string;
    readonly creditCardId: string;
    /** Competência `YYYY-MM` da fatura. */
    readonly invoicePeriod: string;
    /** Valor a pagar da fatura, em módulo; o parcial precisa ser menor que ele. */
    readonly amountDue: MoneyResponse;
}

/** Campo da tela de cada caminho do `createTransactionRequest` que o formulário preenche. */
const PARTIAL_FIELD_BY_PATH: Readonly<Record<string, FieldTarget<PartialPaymentField>>> = {
    value: { field: 'amount', label: 'o valor pago', kind: 'money' },
    dueDate: { field: 'paymentDate', label: 'a data do pagamento', kind: 'choice' },
    paymentDate: { field: 'paymentDate', label: 'a data do pagamento', kind: 'choice' },
    destinationAccountId: { field: 'accountId', label: 'a conta que pagou', kind: 'choice' },
    subCategoryId: { field: 'subCategoryId', label: 'a subcategoria', kind: 'choice' },
};

/**
 * Contas que podem ter feito o pagamento parcial. Regra de negócio (Contas, desktop-mvp-plan
 * §5.1): conta desativada some das escolhas de novos lançamentos, e o pagamento parcial é um
 * lançamento novo — o núcleo recusaria a conta desativada como destino.
 *
 * @param accounts Contas do perfil.
 * @return As contas ativas, na ordem da lista de contas.
 */
export function partialPaymentAccountOptions(accounts: readonly AccountResponse[]): readonly AccountResponse[] {
    return accounts.filter((account) => !account.disabled);
}

/**
 * @param options Contas oferecidas.
 * @param payingAccountId Conta pagadora do cartão.
 * @return A pagadora do cartão, que é quem costuma pagar a fatura; a primeira ativa quando ela
 * está desativada; vazio sem conta ativa.
 */
export function defaultPartialPaymentAccount(options: readonly AccountResponse[], payingAccountId: string): string {
    return options.find((account) => account.id === payingAccountId)?.id ?? options[0]?.id ?? '';
}

/**
 * Lê o pagamento parcial e monta o lançamento que o registra.
 * Regra de negócio (Fatura, database-design §4.7): pagar só uma parte é lançar uma
 * transferência na fatura, com a conta que pagou como destino e valor **negativo** — a regra de
 * sinal inverte a direção, o dinheiro sai da conta e abate a fatura —, e ela nasce paga, porque
 * registra um pagamento já feito. Por isso o valor digitado é positivo e o sinal é posto aqui.
 * Regra da tela (desktop-mvp-plan Fase 8): o parcial é menor que o valor a pagar. Igual ou
 * maior deixaria a fatura zerada ou credora e ainda "em aberto"; quitar o total é "Pagar
 * fatura", que a vincula ao extrato.
 *
 * @param values Valores dos campos.
 * @param target Fatura que recebe o pagamento.
 * @return A entrada de `transactions.create`, ou a mensagem de cada campo com problema.
 * @throws {Error} Quando o schema aponta um caminho que o formulário não tem.
 */
export function readPartialPaymentForm(values: PartialPaymentFormValues, target: PartialPaymentTarget): PartialPaymentFormResult {
    const { currency } = target.amountDue;
    const amount = parseMoneyInput(values.amount, currency);
    const initial: FormErrors<PartialPaymentField> = {};
    if (!amount.ok) {
        initial.amount = moneyInputMessage(amount.reason, currency, 'nonNegative') ?? 'Informe o valor pago.';
    } else if (amount.amount <= 0) {
        initial.amount = 'Use um valor maior que zero.';
    } else if (amount.amount >= target.amountDue.amount) {
        initial.amount = `A fatura tem ${formatMoney(target.amountDue, 'absolute')} a pagar; para quitar tudo, use "Pagar fatura".`;
    }
    if (values.paymentDate.trim() === '') {
        initial.paymentDate = EMPTY_DATE_MESSAGE;
    }
    if (values.accountId === '') {
        initial.accountId = 'Escolha a conta que pagou.';
    }
    if (values.subCategoryId === '') {
        initial.subCategoryId = 'Escolha a subcategoria do lançamento.';
    }
    const date = values.paymentDate.trim() === '' ? PLACEHOLDER_DATE : values.paymentDate;
    const input: CoreInput<'transactions.create'> = {
        profileId: target.profileId,
        type: 'transference',
        source: { kind: 'creditCard', creditCardId: target.creditCardId, invoicePeriod: target.invoicePeriod },
        destinationAccountId: values.accountId === '' ? PLACEHOLDER_ID : values.accountId,
        subCategoryId: values.subCategoryId === '' ? PLACEHOLDER_ID : values.subCategoryId,
        name: PARTIAL_PAYMENT_NAME,
        value: amount.ok ? 0 - amount.amount : 0,
        dueDate: date,
        paymentDate: date,
    };
    // Os campos vazios já têm a frase acima; o schema valida o resto com um valor neutro no
    // lugar, para que os erros de todos os campos apareçam no mesmo envio.
    const parsed = createTransactionRequest.safeParse(input);
    if (parsed.success && Object.keys(initial).length === 0) {
        return { ok: true, input };
    }
    return { ok: false, errors: collectIssues(parsed.success ? [] : parsed.error.issues, PARTIAL_FIELD_BY_PATH, currency, initial) };
}
