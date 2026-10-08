import { formatMoneyForInput, parseMoneyInput, type RecurrenceFrequency, type SourceOption } from '@finance/client';
import { movesToDestination, type CoreInput, type RecurrenceResponse, type TransactionResponse, type TransactionType } from '@finance/core';
import { createTransactionRequest, updateTransactionRequest } from '@finance/core/requests';
import type { z } from 'zod';
import { periodOfDate } from '../cards/invoiceForms.ts';
import { collectIssues, moneyInputMessage, type FieldTarget, type FormErrors } from '../lib/formIssues.ts';

/*
 * Formulário de lançamento (desktop-mvp-plan Fase 9; mockup `DesktopTransacoes`). Valida com os
 * schemas de `transactions.create` e `transactions.update`, para que a mensagem da tela e a
 * recusa do núcleo nunca discordem (desktop-shell-design §5.4). Fica fora do componente para que
 * as regras de leitura tenham teste sem DOM.
 */

/** Valores do formulário, como estão nos campos. */
export interface TransactionFormValues {
    readonly type: TransactionType;
    /** Valor digitado em pt-BR, sem sinal; o sinal vem de `inverted`. */
    readonly amount: string;
    /** Botão "±": inverte o efeito do tipo — estorno numa despesa, pagamento parcial numa transferência na fatura. */
    readonly inverted: boolean;
    readonly name: string;
    readonly description: string;
    /** Data `YYYY-MM-DD`: vencimento numa conta, data da compra num cartão. */
    readonly dueDate: string;
    readonly paid: boolean;
    /** `YYYY-MM-DD`; só vale com `paid`. */
    readonly paymentDate: string;
    /** Encargos digitados; vazio é zero. */
    readonly charges: string;
    /** Conta ou cartão de origem (`sourceKey`); vazio enquanto nada foi escolhido. */
    readonly source: string;
    /** Competência `YYYY-MM` da fatura escolhida; vazio aceita a sugerida pela data da compra. */
    readonly invoicePeriod: string;
    readonly destinationAccountId: string;
    readonly subCategoryId: string;
    readonly tagIds: readonly string[];
    /** "Repetir" (mockup `MobileParcelar`): não repetir, parcelado ou fixo. */
    readonly repeatKind: RepeatKind;
    readonly frequency: RecurrenceFrequency;
    /** Quantidade de parcelas, digitada; só no parcelado. */
    readonly installments: string;
    /** O valor digitado é o total da compra ou o de cada parcela; só no parcelado novo. */
    readonly valueType: 'total' | 'perInstallment';
    /** Última data da série fixa, `YYYY-MM-DD`; vazio repete sem fim. */
    readonly endAt: string;
}

/** Forma da repetição no formulário. */
export type RepeatKind = 'none' | 'installments' | 'fixed';

/** Campo do formulário de lançamento. */
export type TransactionField = keyof TransactionFormValues;

/** Campos que podem ter erro, na ordem do painel; o teste confere que o mapa de caminhos usa só eles. */
export const TRANSACTION_FIELDS = [
    'type',
    'amount',
    'name',
    'subCategoryId',
    'source',
    'invoicePeriod',
    'destinationAccountId',
    'dueDate',
    'charges',
    'paymentDate',
    'tagIds',
    'description',
    'installments',
    'endAt',
] as const satisfies readonly TransactionField[];

/** Campo do formulário com mensagem de erro. */
export type TransactionErrorField = (typeof TRANSACTION_FIELDS)[number];

/** O que o envio chama: criar ou editar, cada um com a entrada da sua rota. */
export type TransactionSubmission =
    | { readonly route: 'transactions.create'; readonly input: CoreInput<'transactions.create'> }
    | { readonly route: 'transactions.update'; readonly input: CoreInput<'transactions.update'> };

/** Resultado da leitura do formulário: a chamada a fazer, ou os erros por campo. */
export type TransactionFormResult = { readonly ok: true; readonly submission: TransactionSubmission } | { readonly ok: false; readonly errors: FormErrors<TransactionErrorField> };

/** Para quem o formulário grava: um lançamento novo no perfil, ou a edição de um existente. */
export type TransactionFormTarget =
    | { readonly mode: 'create'; readonly profileId: string; readonly currency: string }
    | { readonly mode: 'update'; readonly transaction: TransactionResponse; readonly recurrence: RecurrenceResponse | null };

/**
 * Chave da origem no campo "Conta ou cartão": um `Select` só com os dois grupos, como no mockup.
 *
 * @param option Conta ou cartão.
 * @return `account:<id>` ou `creditCard:<id>`.
 */
export function sourceKey(option: Pick<SourceOption, 'kind' | 'id'>): string {
    return `${option.kind}:${option.id}`;
}

/** Origem lida do campo "Conta ou cartão". */
export type ParsedSource = { readonly kind: 'account'; readonly accountId: string } | { readonly kind: 'creditCard'; readonly creditCardId: string };

/**
 * @param key Valor do campo "Conta ou cartão".
 * @return A origem, ou `null` enquanto nada foi escolhido.
 */
export function parseSourceKey(key: string): ParsedSource | null {
    if (key.startsWith('account:') && key.length > 'account:'.length) {
        return { kind: 'account', accountId: key.slice('account:'.length) };
    }
    if (key.startsWith('creditCard:') && key.length > 'creditCard:'.length) {
        return { kind: 'creditCard', creditCardId: key.slice('creditCard:'.length) };
    }
    return null;
}

/**
 * Valores de um lançamento novo: despesa, a data de hoje e, quando a tela tem um filtro de conta
 * ou cartão, essa origem — quem filtrou o Nubank e aperta `N` está lançando no Nubank.
 *
 * @param today Hoje, `YYYY-MM-DD`.
 * @param source Origem sugerida (`sourceKey`), ou vazio.
 * @return Os valores iniciais.
 */
export function newTransactionForm(today: string, source: string): TransactionFormValues {
    return {
        type: 'expense',
        amount: '',
        inverted: false,
        name: '',
        description: '',
        dueDate: today,
        paid: false,
        paymentDate: today,
        charges: '',
        source,
        invoicePeriod: '',
        destinationAccountId: '',
        subCategoryId: '',
        tagIds: [],
        repeatKind: 'none',
        frequency: 'monthly',
        installments: '12',
        valueType: 'total',
        endAt: '',
    };
}

/**
 * Valores da edição. O valor aparece em módulo, com o "±" ligado quando é negativo, para que o
 * estorno se leia pelo botão e não por um hífen fácil de perder. Numa ocorrência de série, a
 * repetição vem da série, e o valor é o da ocorrência — por isso "por parcela". Numa fixa, as
 * parcelas começam vazias: se ela virar parcelada, a quantidade é o usuário quem informa, sem
 * sugestão (desktop-mvp-plan Fase 9.2).
 *
 * @param transaction Lançamento editado.
 * @param today Hoje, sugerido como data de pagamento se o usuário marcar "Pago".
 * @param recurrence Série do lançamento; `null` num avulso (ou enquanto a série carrega).
 * @return Os valores iniciais da edição.
 */
export function transactionFormFrom(transaction: TransactionResponse, today: string, recurrence: RecurrenceResponse | null = null): TransactionFormValues {
    const { container, value } = transaction;
    return {
        type: transaction.type,
        amount: formatMoneyForInput({ amount: Math.abs(value.amount), currency: value.currency }),
        inverted: value.amount < 0,
        name: transaction.name,
        description: transaction.description ?? '',
        dueDate: transaction.dueDate,
        paid: transaction.paid,
        paymentDate: transaction.paymentDate ?? today,
        charges: transaction.charges.amount === 0 ? '' : formatMoneyForInput(transaction.charges),
        source: container.kind === 'statement' ? sourceKey({ kind: 'account', id: container.accountId }) : sourceKey({ kind: 'creditCard', id: container.creditCardId }),
        invoicePeriod: container.kind === 'invoice' ? container.period : '',
        destinationAccountId: transaction.destinationAccountId ?? '',
        subCategoryId: transaction.subCategoryId,
        tagIds: transaction.tagIds,
        repeatKind: recurrence?.kind ?? 'none',
        frequency: recurrence?.frequency ?? 'monthly',
        installments: recurrence === null ? '12' : recurrence.installments === null ? '' : String(recurrence.installments),
        valueType: 'perInstallment',
        endAt: recurrence?.endAt ?? '',
    };
}

/** Repetição como as rotas a recebem. */
export type RepeatSubmission = NonNullable<CoreInput<'transactions.create'>['repeat']>;

/**
 * @param recurrence Série atual.
 * @param repeat Repetição do formulário.
 * @return `true` quando o formulário muda a série — tipo, frequência, parcelas ou fim. Regra de
 * negócio (Recorrências, database-design §4.12): mudar a série vale sempre para a editada e as
 * futuras, então o salvar pula a escolha do escopo e vai direto para a revisão.
 */
export function changesSeries(recurrence: RecurrenceResponse, repeat: RepeatSubmission | null): boolean {
    if (repeat === null) {
        return false;
    }
    if (repeat.kind !== recurrence.kind || repeat.frequency !== recurrence.frequency) {
        return true;
    }
    return repeat.kind === 'installments' ? repeat.installments !== recurrence.installments : (repeat.endAt ?? null) !== recurrence.endAt;
}

/**
 * Se o formulário, como está, muda a série — para o aviso do formulário dizer o que o salvar
 * vai fazer antes de o usuário apertar o botão.
 *
 * @param values Valores dos campos.
 * @param recurrence Série atual.
 * @return `true` quando a repetição do formulário difere da série (`changesSeries`).
 */
export function formChangesSeries(values: TransactionFormValues, recurrence: RecurrenceResponse): boolean {
    const installments = /^\d{1,3}$/.test(values.installments.trim()) ? Number(values.installments.trim()) : 0;
    return changesSeries(recurrence, repeatOf(values, installments));
}

/** Id válido no formato, usado só para validar os outros campos sem escolha feita. */
const PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000000';

/** Data válida no formato, usada só para validar os outros campos sem data. */
const PLACEHOLDER_DATE = '2000-01-01';

/** Campo da tela de cada caminho das rotas de lançamento. */
const FIELD_BY_PATH: Readonly<Record<string, FieldTarget<TransactionErrorField>>> = {
    type: { field: 'type', label: 'o tipo', kind: 'choice' },
    value: { field: 'amount', label: 'o valor', kind: 'money' },
    name: { field: 'name', label: 'o nome', kind: 'name' },
    description: { field: 'description', label: 'a descrição', kind: 'choice' },
    subCategoryId: { field: 'subCategoryId', label: 'a categoria', kind: 'choice' },
    'source.accountId': { field: 'source', label: 'a conta', kind: 'choice' },
    'source.creditCardId': { field: 'source', label: 'o cartão', kind: 'choice' },
    'source.invoicePeriod': { field: 'invoicePeriod', label: 'a fatura', kind: 'choice' },
    destinationAccountId: { field: 'destinationAccountId', label: 'a conta de destino', kind: 'choice' },
    dueDate: { field: 'dueDate', label: 'a data', kind: 'choice' },
    paymentDate: { field: 'paymentDate', label: 'a data do pagamento', kind: 'choice' },
    charges: { field: 'charges', label: 'os encargos', kind: 'nonNegativeMoney' },
    tagIds: { field: 'tagIds', label: 'as tags', kind: 'choice' },
    'repeat.installments': { field: 'installments', label: 'as parcelas', kind: 'choice' },
    'repeat.endAt': { field: 'endAt', label: 'o fim', kind: 'choice' },
};

/** Faixa de parcelas que a rota aceita (`repeatSchema`). */
const INSTALLMENTS_RANGE = { min: 2, max: 360 } as const;

/**
 * Lê o formulário e monta a chamada de criação ou de edição.
 * Regra de negócio (Transações, database-design §4.13): o valor é lançado positivo e o tipo dá a
 * direção; o "±" o grava negativo, invertendo o efeito (estorno, devolução). Encargos são sempre
 * custo da origem, então não têm sinal. Pago e data de pagamento andam juntos (brief §3).
 * Regra de negócio (Transferência): transferência e investimento exigem a conta de destino, e só
 * eles têm uma — o destino escolhido antes de trocar o tipo não vai junto.
 * Regra de negócio (Cartão, database-design §4.7): sem fatura escolhida vale a sugerida pela data
 * da compra; na edição no mesmo cartão a fatura atual vai explícita, porque a sugestão nunca é
 * recalculada depois.
 * Regra da tela: o valor é maior que zero — um lançamento de zero não move dinheiro nenhum.
 *
 * @param values Valores dos campos.
 * @param target Perfil do lançamento novo, ou o lançamento editado (que fornece o que o painel
 * não edita: sócio, meta e moeda de origem).
 * @return A chamada a fazer, ou a mensagem de cada campo com problema.
 * @throws {Error} Quando o schema aponta um caminho que o formulário não tem.
 */
export function readTransactionForm(values: TransactionFormValues, target: TransactionFormTarget): TransactionFormResult {
    const currency = target.mode === 'create' ? target.currency : target.transaction.value.currency;
    const initial: FormErrors<TransactionErrorField> = {};
    const amount = parseMoneyInput(values.amount, currency);
    if (!amount.ok) {
        initial.amount = moneyInputMessage(amount.reason, currency, 'nonNegative') ?? 'Informe o valor.';
    } else if (amount.amount < 0) {
        initial.amount = 'Digite o valor sem sinal; para estorno, use o botão ±.';
    } else if (amount.amount === 0) {
        initial.amount = 'Use um valor maior que zero.';
    }
    const charges = values.charges.trim() === '' ? ({ ok: true, amount: 0 } as const) : parseMoneyInput(values.charges, currency);
    if (!charges.ok) {
        initial.charges = moneyInputMessage(charges.reason, currency, 'nonNegative') ?? 'Digite um valor como 1.234,56.';
    } else if (charges.amount < 0) {
        initial.charges = 'Use zero ou um valor positivo para os encargos.';
    }
    const source = parseSourceKey(values.source);
    if (source === null) {
        initial.source = 'Escolha a conta ou o cartão.';
    }
    const needsDestination = movesToDestination(values.type);
    if (needsDestination && values.destinationAccountId === '') {
        initial.destinationAccountId = 'Escolha a conta de destino.';
    }
    if (values.subCategoryId === '') {
        initial.subCategoryId = 'Escolha a categoria.';
    }
    if (values.dueDate.trim() === '') {
        initial.dueDate = 'Informe a data.';
    }
    const paid = values.paid && source?.kind !== 'creditCard';
    if (paid && values.paymentDate.trim() === '') {
        initial.paymentDate = 'Informe a data do pagamento.';
    }
    const recurring = target.mode === 'create' || target.recurrence !== null;
    const installments = /^\d{1,3}$/.test(values.installments.trim()) ? Number(values.installments.trim()) : null;
    if (recurring && values.repeatKind === 'installments' && (installments === null || installments < INSTALLMENTS_RANGE.min || installments > INSTALLMENTS_RANGE.max)) {
        initial.installments = `Use de ${String(INSTALLMENTS_RANGE.min)} a ${String(INSTALLMENTS_RANGE.max)} parcelas.`;
    }
    const repeat = recurring ? repeatOf(values, installments ?? INSTALLMENTS_RANGE.min) : null;

    const dueDate = values.dueDate.trim() === '' ? PLACEHOLDER_DATE : values.dueDate;
    const content = {
        type: values.type,
        source: toSource(source, values.invoicePeriod),
        subCategoryId: values.subCategoryId === '' ? PLACEHOLDER_ID : values.subCategoryId,
        destinationAccountId: needsDestination ? (values.destinationAccountId === '' ? PLACEHOLDER_ID : values.destinationAccountId) : null,
        name: values.name,
        description: values.description.trim() === '' ? null : values.description,
        value: amount.ok ? (values.inverted ? 0 - amount.amount : amount.amount) : 0,
        charges: charges.ok ? charges.amount : 0,
        dueDate,
        paymentDate: paid ? (values.paymentDate.trim() === '' ? PLACEHOLDER_DATE : values.paymentDate) : null,
        tagIds: [...values.tagIds],
    };
    const submission: TransactionSubmission =
        target.mode === 'create'
            ? { route: 'transactions.create', input: { profileId: target.profileId, ...content, repeat } }
            : {
                  route: 'transactions.update',
                  input: {
                      id: target.transaction.id,
                      ...content,
                      partnerId: target.transaction.partnerId,
                      goalId: target.transaction.goalId,
                      originCurrency: target.transaction.originCurrency,
                      conversionRate: target.transaction.conversionRate,
                      repeat,
                  },
              };
    // Os campos vazios já têm a frase acima; o schema valida o resto com um valor neutro no
    // lugar, para que os erros de todos os campos apareçam no mesmo envio.
    const parsed = submission.route === 'transactions.create' ? createTransactionRequest.safeParse(submission.input) : updateTransactionRequest.safeParse(submission.input);
    if (parsed.success && Object.keys(initial).length === 0) {
        return { ok: true, submission };
    }
    return { ok: false, errors: collectIssues(parsed.success ? [] : parsed.error.issues.map(withTagPath), FIELD_BY_PATH, currency, initial) };
}

/**
 * @param values Valores dos campos.
 * @param installments Parcelas já lidas (ou a mínima, só para validar o resto).
 * @return A repetição da rota; `null` em "Não repetir".
 */
function repeatOf(values: TransactionFormValues, installments: number): RepeatSubmission | null {
    switch (values.repeatKind) {
        case 'none':
            return null;
        case 'installments':
            return { kind: 'installments', frequency: values.frequency, installments, valueType: values.valueType };
        case 'fixed':
            return { kind: 'fixed', frequency: values.frequency, endAt: values.endAt.trim() === '' ? null : values.endAt };
    }
}

/**
 * @param source Origem escolhida; `null` enquanto vazia.
 * @param invoicePeriod Fatura escolhida, ou vazio para a sugerida.
 * @return A origem no formato da rota; sem escolha, uma conta neutra só para validar o resto.
 */
function toSource(source: ParsedSource | null, invoicePeriod: string): CoreInput<'transactions.update'>['source'] {
    if (source === null) {
        return { kind: 'account', accountId: PLACEHOLDER_ID };
    }
    return source.kind === 'account' ? source : { ...source, invoicePeriod: invoicePeriod === '' ? null : invoicePeriod };
}

/**
 * O schema aponta a tag pelo índice (`tagIds.2`); o formulário tem um campo só para as tags.
 *
 * @param issue Problema do schema.
 * @return O mesmo problema, apontando para `tagIds` quando é de uma tag.
 */
function withTagPath(issue: z.core.$ZodIssue): z.core.$ZodIssue {
    return issue.path[0] === 'tagIds' ? { ...issue, path: ['tagIds'] } : issue;
}

/**
 * Mês em que o lançamento vai pesar com o que está no formulário, para o aviso de recálculo.
 * Regra de negócio (Extrato): numa conta, o mês da data de pagamento, ou do vencimento em aberto
 * (`Transaction.cashDate`); num cartão, o da fatura escolhida ou sugerida (database-design §4.7).
 *
 * @param values Valores dos campos.
 * @param suggestedInvoice Competência sugerida para a compra no cartão; `null` enquanto carrega.
 * @return A competência `YYYY-MM`, ou `null` enquanto a data não é válida.
 */
export function cashPeriodOf(values: TransactionFormValues, suggestedInvoice: string | null): string | null {
    if (parseSourceKey(values.source)?.kind === 'creditCard') {
        return values.invoicePeriod === '' ? suggestedInvoice : values.invoicePeriod;
    }
    return periodOfDate(values.paid ? values.paymentDate : values.dueDate);
}
