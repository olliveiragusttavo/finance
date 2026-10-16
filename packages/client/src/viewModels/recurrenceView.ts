import { Currency, LocalDate, Money, YearMonth } from '@finance/core';
import type { AccountResponse, MoneyResponse, OccurrencePreviewResponse, PlannedOccurrenceResponse, RecurrenceResponse, SeriesPlanResponse, TransactionResponse } from '@finance/core';
import { formatDate, formatMonthAbbreviation, formatMonthShort } from '../format/dates.ts';
import { formatMoney } from '../format/money.ts';

/*
 * Apresentação das recorrências (database-design §4.12; desktop-mvp-plan Fase 9.1; mockups
 * `DesktopTransacoes`, `MobileParcelar` e `MobileEscopo`). No
 * `client` porque o celular mostra as mesmas séries, os mesmos escopos, a mesma prévia e o mesmo
 * diálogo de revisão.
 */

/** Frequência de uma série, como o núcleo a devolve. */
export type RecurrenceFrequency = RecurrenceResponse['frequency'];

/** Frequências na ordem do seletor: a mensal, a mais comum, primeiro. */
export const RECURRENCE_FREQUENCY_ORDER: readonly RecurrenceFrequency[] = ['monthly', 'weekly', 'yearly', 'daily'];

/** Nome de cada frequência, no masculino de "lançamento mensal" e no seletor ("Mensal"). */
const FREQUENCY_LABELS: Readonly<Record<RecurrenceFrequency, string>> = { daily: 'diária', weekly: 'semanal', monthly: 'mensal', yearly: 'anual' };

/**
 * @param frequency Frequência da série.
 * @param capitalized `true` para o seletor ("Mensal"); senão minúscula, para compor frases.
 * @return O nome da frequência.
 */
export function formatFrequency(frequency: RecurrenceFrequency, capitalized = false): string {
    const label = FREQUENCY_LABELS[frequency];
    return capitalized ? label.charAt(0).toUpperCase() + label.slice(1) : label;
}

/**
 * Coluna "Rec." da tabela (mockup `DesktopTransacoes`): "3/12" numa parcela, "Fixa" numa série
 * fixa, nada num lançamento avulso.
 *
 * @param transaction Lançamento.
 * @param recurrence Série dele, quando há; ausente enquanto a lista de séries carrega.
 * @return O texto da coluna, ou `null` sem série.
 */
export function formatRecurrenceTag(transaction: Pick<TransactionResponse, 'recurrenceId' | 'occurrence'>, recurrence: RecurrenceResponse | undefined): string | null {
    if (transaction.recurrenceId === null) {
        return null;
    }
    if (recurrence?.kind === 'installments' && recurrence.installments !== null && transaction.occurrence !== null) {
        return `${String(transaction.occurrence)}/${String(recurrence.installments)}`;
    }
    return recurrence?.kind === 'fixed' ? 'Fixa' : 'Rec.';
}

/**
 * Subtítulo do painel de edição (mockup `DesktopTransacoes`: "Despesa · parcela 3 de 12 (valor
 * total R$ 4.800,00)"; `MobileEscopo`: "fixa mensal").
 *
 * @param transaction Ocorrência editada.
 * @param recurrence Série dela.
 * @return A descrição da posição da ocorrência na série.
 */
export function describeOccurrence(transaction: Pick<TransactionResponse, 'occurrence'>, recurrence: RecurrenceResponse): string {
    if (recurrence.kind === 'installments' && recurrence.installments !== null) {
        const total = recurrence.total === null ? '' : ` (valor total ${formatMoney(recurrence.total, 'absolute')})`;
        return `parcela ${String(transaction.occurrence ?? 1)} de ${String(recurrence.installments)}${total}`;
    }
    const until = recurrence.endAt === null ? '' : ` até ${formatDate(recurrence.endAt)}`;
    return `fixa ${formatFrequency(recurrence.frequency)}${until}`;
}

/** A quais ocorrências da série a edição ou a exclusão se aplica. */
export type EditScope = 'single' | 'future' | 'all';

/** Uma opção do diálogo de escopo. */
export interface ScopeChoice {
    readonly scope: EditScope;
    /** "Somente esta", "Esta e as futuras", "Todas". */
    readonly label: string;
    /** "Só a de out/2026", "De out/2026 em diante", "A série inteira, inclusive meses passados". */
    readonly detail: string;
    /** Quantas ocorrências vivas o escopo alcança. */
    readonly count: number;
}

/**
 * Opções do diálogo de escopo (mockup `MobileEscopo`). Só a escolha: o que cada escopo exclui,
 * cria e altera — com as pagas e os saldos que mudam — vem depois, no diálogo de revisão
 * (`describeSeriesPlan`).
 * Regra de negócio (Recorrências, database-design §4.12): "futuras" é a editada e as de número
 * maior, nunca pela data — uma ocorrência movida para depois da editada continua anterior a ela.
 *
 * @param params.edited Ocorrência editada ou excluída.
 * @param params.occurrences Ocorrências vivas da série (`recurrences.occurrences`).
 * @return As três opções, na ordem do mockup.
 */
export function scopeChoices(params: { readonly edited: TransactionResponse; readonly occurrences: readonly TransactionResponse[] }): readonly ScopeChoice[] {
    const { edited } = params;
    const month = formatMonthShort(LocalDate.parse(edited.dueDate).period.toString());
    const all = params.occurrences.some((transaction) => transaction.id === edited.id) ? params.occurrences : [edited, ...params.occurrences];
    const number = edited.occurrence ?? 1;
    const sets: Readonly<Record<EditScope, readonly TransactionResponse[]>> = {
        single: [edited],
        future: all.filter((transaction) => transaction.id === edited.id || (transaction.occurrence ?? 1) >= number),
        all,
    };
    const details: Readonly<Record<EditScope, readonly [string, string]>> = {
        single: ['Somente esta', `Só a de ${month}`],
        future: ['Esta e as futuras', `De ${month} em diante`],
        all: ['Todas', 'A série inteira, inclusive meses passados'],
    };
    return (['single', 'future', 'all'] as const).map((scope) => ({
        scope,
        label: details[scope][0],
        detail: details[scope][1],
        count: sets[scope].length,
    }));
}

/**
 * @param transactions Ocorrências do escopo.
 * @param accounts Contas do perfil.
 * @param action Editar ou excluir.
 * @return "3 ocorrências já pagas serão excluídas. Os saldos de jul, ago e set/2026 da conta
 * Nubank vão mudar.", ou `null` sem ocorrência paga.
 */
function paidWarning(transactions: readonly TransactionResponse[], accounts: readonly Pick<AccountResponse, 'id' | 'name'>[], action: 'edit' | 'delete'): string | null {
    const paid = transactions.filter((transaction) => transaction.paid);
    if (paid.length === 0) {
        return null;
    }
    const verb = action === 'delete' ? (paid.length === 1 ? 'será excluída' : 'serão excluídas') : paid.length === 1 ? 'será alterada' : 'serão alteradas';
    const months = joinMonths([...new Set(paid.map((transaction) => transaction.container.period))].sort());
    const accountIds = [...new Set(paid.flatMap((transaction) => [transaction.container.kind === 'statement' ? transaction.container.accountId : null, transaction.destinationAccountId]))];
    const names = accountIds.flatMap((id) => accounts.find((account) => account.id === id)?.name ?? []);
    const where = names.length === 0 ? '' : names.length === 1 ? ` da conta ${names[0] ?? ''}` : ` das contas ${joinWords(names)}`;
    const count = paid.length === 1 ? '1 ocorrência já paga' : `${String(paid.length)} ocorrências já pagas`;
    return `${count} ${verb}. ${months.plural ? 'Os saldos' : 'O saldo'} de ${months.text}${where} ${months.plural || names.length > 1 ? 'vão' : 'vai'} mudar.`;
}

/**
 * @param periods Competências `YYYY-MM`, em ordem.
 * @return "jul, ago e set/2026" quando estão no mesmo ano; "nov/2026 e jan/2027" quando não.
 */
function joinMonths(periods: readonly string[]): { readonly text: string; readonly plural: boolean } {
    const years = new Set(periods.map((period) => YearMonth.parse(period).year));
    const last = periods.at(-1) ?? '';
    const text = years.size === 1
        ? joinWords([...periods.slice(0, -1).map(formatMonthAbbreviation), formatMonthShort(last)])
        : joinWords(periods.map(formatMonthShort));
    return { text, plural: periods.length > 1 };
}

/**
 * @param words Palavras.
 * @return "a", "a e b", "a, b e c".
 */
function joinWords(words: readonly string[]): string {
    return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} e ${words.at(-1) ?? ''}`;
}

/** O que o diálogo de revisão confirma. */
export type ReviewAction = 'create' | 'edit' | 'delete';

/** Uma ocorrência na lista do diálogo de revisão: só a data e a situação (desktop-mvp-plan Fase 9.2). */
export interface ReviewRow {
    readonly key: string;
    /** "05/12/2026". */
    readonly date: string;
    readonly paid: boolean;
    /** "Paga" ou "Em aberto". */
    readonly status: string;
    /** Editada à mão depois de criada: a lista marca, para o usuário saber o que perde. */
    readonly editedByHand: boolean;
}

/** Um grupo do diálogo de revisão, por tipo de alteração. */
export interface ReviewGroup {
    readonly kind: 'deleted' | 'created' | 'updated';
    /** "11 transações serão excluídas". */
    readonly title: string;
    readonly rows: readonly ReviewRow[];
}

/** O diálogo de revisão inteiro. */
export interface SeriesReview {
    /** O que será feito com as séries, em frases. */
    readonly summary: readonly string[];
    /** Pagas excluídas ou alteradas e edições feitas à mão que se perdem; vazio quando não há. */
    readonly warnings: readonly string[];
    /** Só os grupos com alguma ocorrência, na ordem excluídas, criadas, alteradas. */
    readonly groups: readonly ReviewGroup[];
}

/** Linhas de cada grupo antes do "e mais n transações" (desktop-mvp-plan Fase 9.2). */
export const REVIEW_VISIBLE_ROWS = 5;

/** Verbos de cada grupo, no singular e no plural. */
const GROUP_VERBS: Readonly<Record<ReviewGroup['kind'], readonly [string, string]>> = {
    deleted: ['será excluída', 'serão excluídas'],
    created: ['será criada', 'serão criadas'],
    updated: ['será alterada', 'serão alteradas'],
};

/**
 * Diálogo de revisão (database-design §4.12): antes de gravar a criação, a edição ou a
 * exclusão de uma transação recorrente, o usuário vê o que será feito com as séries e quais
 * ocorrências serão excluídas, criadas e alteradas, para confirmar sabendo exatamente o que
 * muda.
 * Regra de negócio (Recorrências, database-design §4.12): mudar a periodicidade ou o tipo
 * encerra a série e cria outra sem vínculo com as anteriores, e as futuras saem mesmo pagas —
 * o diálogo diz as duas coisas, e quantas das excluídas tinham sido editadas à mão.
 *
 * @param params.plan Plano do núcleo (`recurrences.planCreate`, `planUpdate` ou `planDelete`).
 * @param params.action O que o diálogo confirma; muda as frases da série encerrada.
 * @param params.accounts Contas do perfil, para os nomes no aviso das pagas.
 * @return O resumo, os avisos e os grupos.
 */
export function describeSeriesPlan(params: {
    readonly plan: SeriesPlanResponse;
    readonly action: ReviewAction;
    readonly accounts: readonly Pick<AccountResponse, 'id' | 'name'>[];
}): SeriesReview {
    const { plan, accounts } = params;
    const groups = (['deleted', 'created', 'updated'] as const).flatMap((kind): ReviewGroup[] => {
        const items = plan[kind];
        if (items.length === 0) {
            return [];
        }
        const [singular, plural] = GROUP_VERBS[kind];
        const title = items.length === 1 ? `1 transação ${singular}` : `${String(items.length)} transações ${plural}`;
        return [{ kind, title, rows: items.map(reviewRow) }];
    });
    const lostEdits = plan.deleted.filter((item) => item.editedByHand).length;
    const warnings = [
        paidWarning(plan.deleted.map((item) => item.transaction), accounts, 'delete'),
        paidWarning(plan.updated.map((item) => item.transaction), accounts, 'edit'),
        lostEdits === 0
            ? null
            : lostEdits === 1
              ? '1 transação editada manualmente será excluída, e o que foi alterado nela se perde.'
              : `${String(lostEdits)} transações editadas manualmente serão excluídas, e o que foi alterado nelas se perde.`,
    ].filter((warning) => warning !== null);
    return { summary: summaryOf(plan, params.action), warnings, groups };
}

/**
 * @param hidden Quantas linhas do grupo ficaram de fora.
 * @return "e mais 1 transação", "e mais 6 transações", ou `null` quando todas aparecem.
 */
export function formatHiddenRows(hidden: number): string | null {
    if (hidden <= 0) {
        return null;
    }
    return hidden === 1 ? 'e mais 1 transação' : `e mais ${String(hidden)} transações`;
}

/**
 * @param plan Plano do núcleo.
 * @param action O que o diálogo confirma.
 * @return As frases do que será feito com as séries.
 */
function summaryOf(plan: SeriesPlanResponse, action: ReviewAction): readonly string[] {
    const { seriesBefore: before, seriesAfter: after, newSeries } = plan;
    if (before === null) {
        if (newSeries === null) {
            return [];
        }
        const created = [`Será criada uma série ${seriesLabel(newSeries)}.`];
        return newSeries.kind === 'fixed' ? [...created, 'As próximas transações entram conforme o tempo passa, sempre até 12 meses à frente.'] : created;
    }
    if (newSeries !== null) {
        return [
            'As transações futuras desta série serão removidas.',
            after === null
                ? `A série ${seriesLabel(before)} atual será excluída, porque começava nesta transação.`
                : `A série ${KIND_LABELS[before.kind]} atual será encerrada ${endPhrase(after)}.`,
            `Será criada uma nova série ${seriesLabel(newSeries)}, começando nesta transação.`,
            'A nova série não terá vínculo com as transações anteriores: a sequência atual se perde.',
        ];
    }
    if (after === null) {
        return ['A série será excluída, inclusive as transações passadas.'];
    }
    if (before.installments !== after.installments) {
        return [action === 'delete' ? `A série será encerrada ${endPhrase(after)}.` : `A série passa de ${String(before.installments)} para ${String(after.installments)} parcelas.`];
    }
    if (before.endAt !== after.endAt) {
        return [action === 'delete' ? `A série será encerrada ${endPhrase(after)}.` : `O término da série passa de ${endLabel(before)} para ${endLabel(after)}.`];
    }
    return [];
}

/** Nome de cada forma de série, para compor frases. */
const KIND_LABELS: Readonly<Record<RecurrenceResponse['kind'], string>> = { installments: 'parcelada', fixed: 'fixa' };

/**
 * @param recurrence Série.
 * @return "parcelada mensal em 4x", "fixa semanal, sem término", "fixa mensal até 31/12/2026".
 */
function seriesLabel(recurrence: RecurrenceResponse): string {
    const frequency = formatFrequency(recurrence.frequency);
    if (recurrence.kind === 'installments') {
        return `parcelada ${frequency} em ${String(recurrence.installments ?? 0)}x`;
    }
    return recurrence.endAt === null ? `fixa ${frequency}, sem término` : `fixa ${frequency} até ${formatDate(recurrence.endAt)}`;
}

/**
 * @param recurrence Série encerrada.
 * @return "em 04/12/2026" na fixa, "na parcela 2" na parcelada.
 */
function endPhrase(recurrence: RecurrenceResponse): string {
    if (recurrence.kind === 'installments') {
        return `na parcela ${String(recurrence.installments ?? 0)}`;
    }
    return recurrence.endAt === null ? 'sem término' : `em ${formatDate(recurrence.endAt)}`;
}

/**
 * @param recurrence Série fixa.
 * @return A data do término, ou "sem término".
 */
function endLabel(recurrence: RecurrenceResponse): string {
    return recurrence.endAt === null ? 'sem término' : formatDate(recurrence.endAt);
}

/**
 * @param item Ocorrência do plano.
 * @return A linha da lista.
 */
function reviewRow(item: PlannedOccurrenceResponse): ReviewRow {
    const { transaction } = item;
    return { key: transaction.id, date: formatDate(transaction.dueDate), paid: transaction.paid, status: transaction.paid ? 'Paga' : 'Em aberto', editedByHand: item.editedByHand };
}

/** Uma linha da prévia das parcelas. */
export interface RepeatPreviewRow {
    readonly key: number;
    /** "1/12" numa parcelada; a data numa fixa. */
    readonly label: string;
    /** "fatura nov/2026" num cartão; a data numa conta parcelada; vazio numa fixa. */
    readonly detail: string;
    readonly amount: string;
}

/** A prévia da repetição como o mockup `MobileParcelar` a mostra. */
export interface RepeatPreview {
    /** "R$ 1.200,00 em 12x de R$ 100,00", "R$ 2.300,00 todo mês, sem fim". */
    readonly headline: string;
    /** As primeiras linhas. */
    readonly rows: readonly RepeatPreviewRow[];
    /** "Ver as 8 restantes, até out/2027"; `null` quando todas cabem. */
    readonly more: string | null;
    /** A regra do arredondamento, quando a divisão não fecha; senão `null`. */
    readonly note: string | null;
}

/** Linhas mostradas antes do "Ver as N restantes", como no mockup. */
const PREVIEW_ROWS = 4;

/** Advérbio de cada frequência no resumo da série fixa. */
const EVERY: Readonly<Record<RecurrenceFrequency, string>> = { daily: 'todo dia', weekly: 'toda semana', monthly: 'todo mês', yearly: 'todo ano' };

/**
 * Prévia da repetição (mockup `MobileParcelar`), a partir de `recurrences.preview` — a mesma
 * conta que a criação faz, para que a prévia nunca discorde do que é gravado.
 * Regra de negócio (Parcelamento, database-design §4.12): no "valor total", a diferença do
 * arredondamento vai para a 1ª parcela, e a prévia diz isso quando acontece.
 *
 * @param params.occurrences Ocorrências previstas.
 * @param params.repeat Repetição pedida.
 * @return O resumo, as primeiras linhas e o que ficou de fora.
 */
export function describeRepeatPreview(params: {
    readonly occurrences: readonly OccurrencePreviewResponse[];
    readonly repeat: { readonly kind: 'installments' | 'fixed'; readonly frequency: RecurrenceFrequency; readonly endAt?: string | null };
}): RepeatPreview {
    const { occurrences, repeat } = params;
    const first = occurrences[0];
    const last = occurrences.at(-1);
    if (first === undefined || last === undefined) {
        return { headline: '', rows: [], more: null, note: null };
    }
    const installments = repeat.kind === 'installments';
    const rows = occurrences.slice(0, PREVIEW_ROWS).map((occurrence) => ({
        key: occurrence.occurrence,
        label: installments ? `${String(occurrence.occurrence)}/${String(occurrences.length)}` : formatDate(occurrence.dueDate),
        detail: occurrence.invoicePeriod === null ? (installments ? formatDate(occurrence.dueDate) : '') : `fatura ${formatMonthShort(occurrence.invoicePeriod)}`,
        amount: formatMoney(occurrence.value, 'absolute'),
    }));
    const rest = occurrences.length - rows.length;
    const lastPeriod = last.invoicePeriod ?? LocalDate.parse(last.dueDate).period.toString();
    const more = rest > 0 ? `Ver ${rest === 1 ? 'a restante' : `as ${String(rest)} restantes`}, até ${formatMonthShort(lastPeriod)}` : null;
    if (installments) {
        // Soma com `Money` e arredonda uma vez, como as outras somas do app (database-design §3.7).
        const currency = Currency.of(first.value.currency);
        const sum = occurrences.reduce((acc, occurrence) => acc.add(Money.of(occurrence.value.amount, currency)), Money.zero(currency)).rounded();
        const total: MoneyResponse = { amount: sum.amount, currency: currency.code };
        const uneven = occurrences.some((occurrence) => occurrence.value.amount !== last.value.amount);
        return {
            headline: `${formatMoney(total, 'absolute')} em ${String(occurrences.length)}x de ${formatMoney(last.value, 'absolute')}`,
            rows,
            more,
            note: uneven ? 'A divisão não fecha: a diferença do arredondamento vai para a 1ª parcela.' : null,
        };
    }
    const until = repeat.endAt === null || repeat.endAt === undefined ? ', sem fim' : ` até ${formatDate(repeat.endAt)}`;
    return { headline: `${formatMoney(first.value, 'absolute')} ${EVERY[repeat.frequency]}${until}`, rows, more, note: null };
}
