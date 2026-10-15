import { fixedSeriesHorizon, type RecurrenceFrequency } from '../recurrence/RecurrenceSchedule.ts';
import { LocalDate } from '../shared/LocalDate.ts';
import { foldName, REGISTRY_NAME_MAX_LENGTH } from '../shared/names.ts';
import type { ImportOptions, ImportRow } from './ImportRow.ts';

/** Tamanho máximo do nome de um lançamento, o `CHECK` de `transactions.name` (database-design §4.13). */
const TRANSACTION_NAME_MAX_LENGTH = 100;

/** Maior quantidade de parcelas que uma série aceita, a mesma do lançamento manual. */
const MAX_INSTALLMENTS = 360;

/** Menor quantidade de linhas com data da compra para sugerir o fechamento de um cartão. */
const CLOSING_SAMPLE_MIN = 3;

/** `#palavra` da observação: letras, números e sublinhado, em qualquer alfabeto. */
const HASHTAG = /#([\p{L}\p{N}_]+)/gu;

/** Sufixo " 3/10" que o app de origem acrescenta ao nome de cada parcela. */
const INSTALLMENT_SUFFIX = /\s+\d{1,3}\s*\/\s*\d{1,3}$/;

/**
 * Por que uma linha não pode ser importada. São só as regras do conteúdo; as do formato (data ou
 * número ilegível, campo vazio) o client aponta antes de a linha chegar aqui.
 */
export type ImportIssueReason =
    | 'name-invalid'
    | 'account-invalid'
    | 'credit-card-invalid'
    | 'category-missing'
    | 'category-invalid'
    | 'destination-missing'
    | 'destination-equals-origin'
    | 'tag-invalid';

/** Linha recusada, com o motivo. */
export interface ImportIssue {
    readonly line: number;
    readonly reason: ImportIssueReason;
}

/** Linha aceita, como será gravada. */
export interface PlannedRow {
    readonly row: ImportRow;
    /** Nome gravado: sem o sufixo de parcela quando a linha entra num parcelamento. */
    readonly name: string;
    /** `due_date` gravado: o vencimento na conta, a data da compra no cartão (import-design §5.4). */
    readonly date: LocalDate;
    /** Pagamento gravado, já com o "pagas até hoje" aplicado. */
    readonly paymentDate: LocalDate | null;
    /** Cartão da compra; `null` fora do cartão (o cartão só vale em despesa). */
    readonly creditCard: string | null;
    /** Tags da coluna e, com a opção, das `#palavras` — sem repetição. */
    readonly tags: readonly string[];
    /** Número da ocorrência na série; `null` no lançamento avulso. */
    readonly occurrence: number | null;
}

/** Linhas que viram uma recorrência do app (import-design §5.5). */
export interface PlannedSeries {
    readonly kind: 'fixed' | 'installments';
    readonly frequency: RecurrenceFrequency;
    /** Total de parcelas; `null` na fixa. */
    readonly installments: number | null;
    /** Fim da fixa — a última ocorrência quando ela vence antes do horizonte; `null` = sem fim. */
    readonly endAt: LocalDate | null;
    /** Ocorrências, em ordem crescente de número; a última é a referência da série. */
    readonly occurrences: readonly PlannedRow[];
}

/** Conta citada no arquivo, como origem, destino ou pagadora de cartão. */
export interface ImportAccountUse {
    readonly name: string;
    readonly rows: number;
}

/** Cartão citado no arquivo, com o que a revisão sugere para criá-lo. */
export interface ImportCreditCardUse {
    readonly name: string;
    readonly rows: number;
    /** Conta mais comum nas linhas do cartão — a pagadora sugerida. */
    readonly payingAccount: string;
    /** Dia mais comum nos vencimentos das compras. */
    readonly dueDay: number;
    /** Fechamento provável pelas datas de compra; `null` sem amostra suficiente. */
    readonly closingDay: number | null;
}

/** De onde sai o dinheiro de uma linha, pelos nomes do arquivo. */
export type ImportSource =
    | { readonly kind: 'account'; readonly name: string }
    | { readonly kind: 'creditCard'; readonly name: string };

/** Categoria e subcategoria usadas por uma conta ou cartão do arquivo. */
export interface ImportCategoryUse {
    readonly source: ImportSource;
    readonly category: string;
    readonly subCategory: string;
    readonly rows: number;
}

/** Tudo o que a revisão mostra e o que o `ImportService` grava (import-design §6). */
export interface ImportAnalysis {
    readonly standalone: readonly PlannedRow[];
    readonly series: readonly PlannedSeries[];
    readonly issues: readonly ImportIssue[];
    /** Ocorrências futuras das fixas descartadas por "manter as futuras" desmarcado. */
    readonly droppedFuture: number;
    readonly accounts: readonly ImportAccountUse[];
    readonly creditCards: readonly ImportCreditCardUse[];
    readonly categories: readonly ImportCategoryUse[];
    /** `#palavras` das observações das linhas aceitas, mesmo com a opção desmarcada. */
    readonly hashtags: { readonly rows: number; readonly names: readonly string[] };
    readonly paid: number;
    readonly pending: number;
}

/** Linha aceita antes de saber se entra numa série. */
interface Accepted {
    readonly row: ImportRow;
    readonly creditCard: string | null;
    readonly paymentDate: LocalDate | null;
    readonly tags: readonly string[];
}

/**
 * Analisa as linhas de um arquivo: recusa as que não podem ser gravadas, agrupa as séries,
 * numera as ocorrências e calcula o que a revisão pergunta. É pura e é a **mesma** chamada pela
 * tela de revisão e pelo `ImportService`, para que os números que o usuário aprovou sejam os
 * gravados (import-design §2).
 *
 * @param rows Linhas lidas pelo client, na ordem do arquivo.
 * @param options Escolhas da revisão.
 * @param today "Hoje" do usuário: dá o horizonte das fixas e o "pagas até hoje".
 * @return A análise; vazia em tudo quando não há linhas.
 */
export function analyzeImport(rows: readonly ImportRow[], options: ImportOptions, today: LocalDate): ImportAnalysis {
    const issues: ImportIssue[] = [];
    const accepted: Accepted[] = [];
    for (const row of rows) {
        const reason = issueOf(row);
        if (reason !== null) {
            issues.push({ line: row.line, reason });
            continue;
        }
        const tags = tagsOf(row, options.hashtagsAsTags);
        if (tags.some((tag) => tag.length > REGISTRY_NAME_MAX_LENGTH)) {
            issues.push({ line: row.line, reason: 'tag-invalid' });
            continue;
        }
        accepted.push({
            row,
            creditCard: row.type === 'expense' ? row.creditCard : null,
            paymentDate: row.paymentDate ?? (options.pastDueAsPaid && !today.isBefore(row.dueDate) ? row.dueDate : null),
            tags,
        });
    }

    const standalone: PlannedRow[] = [];
    const groups = new Map<string, Accepted[]>();
    for (const item of accepted) {
        const key = options.groupSeries ? seriesKeyOf(item) : null;
        if (key === null) {
            standalone.push(plannedStandalone(item));
            continue;
        }
        const group = groups.get(key);
        if (group === undefined) {
            groups.set(key, [item]);
        } else {
            group.push(item);
        }
    }

    const horizon = fixedSeriesHorizon(today);
    const series: PlannedSeries[] = [];
    let droppedFuture = 0;
    for (const group of groups.values()) {
        const built = buildSeries(group, horizon, options.keepFutureOccurrences);
        standalone.push(...built.standalone);
        droppedFuture += built.dropped;
        if (built.series !== null) {
            series.push(built.series);
        }
    }
    standalone.sort((a, b) => a.row.line - b.row.line);

    const planned = [...standalone, ...series.flatMap((item) => item.occurrences)];
    const paid = planned.filter((item) => item.paymentDate !== null).length;
    return {
        standalone,
        series,
        issues,
        droppedFuture,
        accounts: accountUses(planned),
        creditCards: creditCardUses(planned),
        categories: categoryUses(planned),
        hashtags: hashtagsOf(planned),
        paid,
        pending: planned.length - paid,
    };
}

/**
 * @param row Linha do arquivo.
 * @return O motivo pelo qual a linha não pode ser gravada, ou `null` quando pode — as mesmas
 * regras do cadastro e do lançamento, conferidas antes para que uma linha ruim não desfaça a
 * importação inteira.
 */
function issueOf(row: ImportRow): ImportIssueReason | null {
    if (!fits(row.name, TRANSACTION_NAME_MAX_LENGTH)) {
        return 'name-invalid';
    }
    if (!fits(row.account, REGISTRY_NAME_MAX_LENGTH)) {
        return 'account-invalid';
    }
    if (row.type === 'expense' && row.creditCard !== null && !fits(row.creditCard, REGISTRY_NAME_MAX_LENGTH)) {
        return 'credit-card-invalid';
    }
    if (row.type === 'transference') {
        if (row.destination === null || row.destination.trim().length === 0) {
            return 'destination-missing';
        }
        if (!fits(row.destination, REGISTRY_NAME_MAX_LENGTH)) {
            return 'account-invalid';
        }
        // Regra de negócio (Transferência): origem e destino são contas diferentes, como no
        // lançamento manual (`destination-equals-origin`).
        return foldName(row.destination) === foldName(row.account) ? 'destination-equals-origin' : null;
    }
    if (row.category === null || row.subCategory === null || row.category.trim().length === 0 || row.subCategory.trim().length === 0) {
        return 'category-missing';
    }
    return fits(row.category, REGISTRY_NAME_MAX_LENGTH) && fits(row.subCategory, REGISTRY_NAME_MAX_LENGTH) ? null : 'category-invalid';
}

/**
 * @param text Texto da linha.
 * @param maxLength Limite da coluna.
 * @return `true` quando o texto aparado tem de 1 ao limite de caracteres.
 */
function fits(text: string, maxLength: number): boolean {
    const length = text.trim().length;
    return length > 0 && length <= maxLength;
}

/**
 * Regra de negócio (Importação, import-design §5.2): as tags vêm da coluna própria e, com a
 * opção, das `#palavras` da observação; a mesma tag escrita duas vezes conta uma.
 *
 * @param row Linha do arquivo.
 * @param hashtagsAsTags Se as `#palavras` viram tags.
 * @return Os nomes das tags, aparados e sem repetição, na ordem em que aparecem.
 */
function tagsOf(row: ImportRow, hashtagsAsTags: boolean): readonly string[] {
    const names = [...row.tags, ...(hashtagsAsTags ? hashtagsIn(row.description) : [])];
    const seen = new Map<string, string>();
    for (const raw of names) {
        const name = raw.trim();
        if (name.length > 0 && !seen.has(foldName(name))) {
            seen.set(foldName(name), name);
        }
    }
    return [...seen.values()];
}

/**
 * @param text Observação da linha.
 * @return As `#palavras` do texto, sem o `#`.
 */
function hashtagsIn(text: string | null): readonly string[] {
    return text === null ? [] : [...text.matchAll(HASHTAG)].map((match) => match[1] ?? '').filter((name) => name.length > 0);
}

/**
 * Regra de negócio (Importação, import-design §5.5): são da mesma série as linhas com o mesmo
 * tipo, nome, conta ou cartão, destino e frequência; no parcelamento, também o mesmo total e a
 * mesma data da compra — duas compras iguais em datas diferentes são duas séries.
 *
 * @param item Linha aceita.
 * @return A chave da série, ou `null` quando a linha é avulsa — sem repetição, ou com parcela
 * que não cabe numa série (total fora de 2 a 360, número fora de 1 ao total).
 */
function seriesKeyOf(item: Accepted): string | null {
    const { row } = item;
    const { repetition } = row;
    const source = item.creditCard === null ? `a:${foldName(row.account)}` : `c:${foldName(item.creditCard)}`;
    const base = [row.type, source, foldName(row.destination ?? '')];
    switch (repetition.kind) {
        case 'none':
            return null;
        case 'fixed':
            return JSON.stringify(['fixed', ...base, repetition.frequency, foldName(row.name)]);
        case 'installments': {
            const { installment, installments } = repetition;
            if (installment === null || installments === null || !Number.isInteger(installment) || !Number.isInteger(installments)
                || installments < 2 || installments > MAX_INSTALLMENTS || installment < 1 || installment > installments) {
                return null;
            }
            return JSON.stringify(['installments', ...base, repetition.frequency, foldName(installmentName(row.name)), installments, row.purchaseDate?.toString() ?? '']);
        }
    }
}

/**
 * @param name Nome da linha.
 * @return O nome sem o sufixo " 3/10"; o próprio nome quando sobraria vazio.
 */
function installmentName(name: string): string {
    const stripped = name.trim().replace(INSTALLMENT_SUFFIX, '');
    return stripped.length > 0 ? stripped : name.trim();
}

/**
 * A data segue a mesma regra da ocorrência de série (`recordedDateOf`), porque depende do que a
 * linha é no arquivo, e não de ela ter sido agrupada: a fixa ou a parcela que ficou avulsa (sem
 * agrupar, número repetido, parcela fora do total) continua sendo fixa ou parcela.
 *
 * @param item Linha aceita.
 * @return A linha como lançamento avulso, com o nome intocado.
 */
function plannedStandalone(item: Accepted): PlannedRow {
    const { row } = item;
    return {
        row,
        name: row.name.trim(),
        date: recordedDateOf(item, row.repetition.kind === 'installments' ? row.repetition.installment : null),
        paymentDate: item.paymentDate,
        creditCard: item.creditCard,
        tags: item.tags,
        occurrence: null,
    };
}

/** Resultado de montar uma série: ela, as linhas que caíram para avulsas e as descartadas. */
interface BuiltSeries {
    readonly series: PlannedSeries | null;
    readonly standalone: readonly PlannedRow[];
    readonly dropped: number;
}

/**
 * Numera as ocorrências e decide o fim da série (import-design §5.5).
 * Regra de negócio (Importação): a linha que repete um número já ocupado vira avulsa — não há
 * como saber qual das duas é a ocorrência. A fixa termina na última ocorrência do arquivo quando
 * ela vence antes do horizonte; senão continua sem fim, e com "manter as futuras" desmarcado as
 * ocorrências depois do horizonte são descartadas, para o app gerá-las.
 *
 * @param group Linhas com a mesma chave de série, na ordem do arquivo.
 * @param horizon Último dia que uma fixa grava agora.
 * @param keepFuture Se as ocorrências depois do horizonte são mantidas.
 * @return A série (ou `null` se não sobrou ocorrência), as avulsas e quantas foram descartadas.
 */
function buildSeries(group: readonly Accepted[], horizon: LocalDate, keepFuture: boolean): BuiltSeries {
    const first = group[0];
    if (first === undefined) {
        return { series: null, standalone: [], dropped: 0 };
    }
    const { repetition } = first.row;
    if (repetition.kind === 'none') {
        return { series: null, standalone: group.map(plannedStandalone), dropped: 0 };
    }
    const ordered = [...group].sort((a, b) => a.row.dueDate.compare(b.row.dueDate) || a.row.line - b.row.line);
    const start = ordered[0]?.row.dueDate ?? first.row.dueDate;
    const taken = new Map<number, PlannedRow>();
    const standalone: PlannedRow[] = [];
    for (const item of ordered) {
        const occurrence = repetition.kind === 'installments'
            ? installmentOf(item)
            : periodsBetween(repetition.frequency, start, item.row.dueDate) + 1;
        if (taken.has(occurrence)) {
            standalone.push(plannedStandalone(item));
            continue;
        }
        taken.set(occurrence, plannedOccurrence(item, occurrence, repetition.kind === 'installments'));
    }
    const occurrences = [...taken.values()].sort((a, b) => (a.occurrence ?? 0) - (b.occurrence ?? 0));
    if (repetition.kind === 'installments') {
        return {
            series: { kind: 'installments', frequency: repetition.frequency, installments: repetition.installments, endAt: null, occurrences },
            standalone,
            dropped: 0,
        };
    }
    const last = occurrences[occurrences.length - 1];
    const ended = last !== undefined && last.row.dueDate.isBefore(horizon);
    const kept = ended || keepFuture ? occurrences : occurrences.filter((item) => !horizon.isBefore(item.row.dueDate));
    return {
        series: kept.length === 0 ? null : { kind: 'fixed', frequency: repetition.frequency, installments: null, endAt: ended ? last.date : null, occurrences: kept },
        standalone,
        dropped: occurrences.length - kept.length,
    };
}

/**
 * @param item Linha de um parcelamento, já conferida por `seriesKeyOf`.
 * @return O número da parcela.
 */
function installmentOf(item: Accepted): number {
    const { repetition } = item.row;
    return repetition.kind === 'installments' && repetition.installment !== null ? repetition.installment : 1;
}

/**
 * Distância entre duas datas na unidade da frequência, arredondada para baixo: o mês que falta no
 * arquivo vira um número pulado, que o complemento não recria (database-design §4.12).
 *
 * @param frequency Frequência da série.
 * @param from Vencimento da primeira linha.
 * @param to Vencimento da linha.
 * @return Quantos períodos inteiros há entre as duas datas.
 */
function periodsBetween(frequency: RecurrenceFrequency, from: LocalDate, to: LocalDate): number {
    const days = to.toEpochDay() - from.toEpochDay();
    switch (frequency) {
        case 'daily':
            return days;
        case 'weekly':
            return Math.floor(days / 7);
        case 'monthly':
            return from.period.monthsUntil(to.period);
        case 'yearly':
            return Math.floor(from.period.monthsUntil(to.period) / 12);
    }
}

/**
 * A data segue `recordedDateOf`, a mesma da linha avulsa, para que agrupar ou não as linhas
 * nunca mude a data gravada.
 *
 * @param item Linha da série.
 * @param occurrence Número da ocorrência; no parcelamento, também desloca a data da compra.
 * @param installments Se a série é um parcelamento, cujo nome perde o sufixo " 3/10".
 * @return A ocorrência planejada.
 */
function plannedOccurrence(item: Accepted, occurrence: number, installments: boolean): PlannedRow {
    const { row } = item;
    return {
        row,
        name: installments ? installmentName(row.name) : row.name.trim(),
        date: recordedDateOf(item, installments ? occurrence : null),
        paymentDate: item.paymentDate,
        creditCard: item.creditCard,
        tags: item.tags,
        occurrence,
    };
}

/**
 * Data gravada em `due_date`, a mesma para a linha agrupada numa série e para a que ficou avulsa.
 * Sem uma regra única, a fixa avulsa no cartão levava a data em que a série foi criada e aparecia
 * anos antes na lista do mês, e a parcela avulsa ficava toda na data da primeira compra.
 * Regra de negócio (Importação, import-design §5.4): no cartão, a data da compra é a Data da
 * compra da linha, e na parcela *n*, a data da compra mais *n* − 1 meses; na conta, sem data da
 * compra e nas fixas (cuja "Lançamento" é a criação da série), é o Vencimento.
 *
 * @param item Linha aceita.
 * @param installment Número da parcela, que desloca a data da compra; `null` ou um número que não
 * é inteiro positivo usam a data da compra como está, porque não há de onde deduzir o deslocamento.
 * @return A data a gravar em `due_date`.
 */
function recordedDateOf(item: Accepted, installment: number | null): LocalDate {
    const { row } = item;
    const purchase = row.purchaseDate;
    if (item.creditCard === null || purchase === null || row.repetition.kind === 'fixed') {
        return row.dueDate;
    }
    if (installment === null || !Number.isInteger(installment) || installment < 1) {
        return purchase;
    }
    return LocalDate.clampedTo(purchase.period.plusMonths(installment - 1), purchase.day);
}

/**
 * Conta valores pelo nome, guardando a primeira grafia vista — "Banco Inter" e "banco inter" são
 * a mesma conta, e a tela mostra como o arquivo escreveu primeiro.
 */
class NameTally {
    private readonly counts = new Map<string, { name: string; count: number }>();

    /**
     * @param name Nome visto numa linha.
     */
    public add(name: string): void {
        const key = foldName(name);
        const current = this.counts.get(key);
        this.counts.set(key, { name: current?.name ?? name.trim(), count: (current?.count ?? 0) + 1 });
    }

    /**
     * @return Os nomes com a contagem, na ordem em que apareceram.
     */
    public entries(): readonly { readonly name: string; readonly count: number }[] {
        return [...this.counts.values()];
    }

    /**
     * @return O nome mais visto (o primeiro, no empate); `null` sem nenhum.
     */
    public mode(): string | null {
        let best: { name: string; count: number } | null = null;
        for (const entry of this.counts.values()) {
            if (best === null || entry.count > best.count) {
                best = entry;
            }
        }
        return best?.name ?? null;
    }
}

/**
 * @param planned Linhas aceitas.
 * @return As contas citadas — origem, destino ou pagadora —, com quantas linhas citam cada uma.
 */
function accountUses(planned: readonly PlannedRow[]): readonly ImportAccountUse[] {
    const tally = new NameTally();
    for (const { row } of planned) {
        tally.add(row.account);
        if (row.type === 'transference' && row.destination !== null) {
            tally.add(row.destination);
        }
    }
    return tally.entries().map(({ name, count }) => ({ name, rows: count }));
}

/**
 * Regra de negócio (Importação, import-design §5.1): o vencimento do cartão é o dia mais comum
 * nos vencimentos das compras; a pagadora sugerida, a conta mais comum nas linhas dele.
 *
 * @param planned Linhas aceitas.
 * @return Os cartões citados, com o que a revisão sugere para cada um.
 */
function creditCardUses(planned: readonly PlannedRow[]): readonly ImportCreditCardUse[] {
    const byCard = new Map<string, PlannedRow[]>();
    for (const item of planned) {
        if (item.creditCard !== null) {
            const key = foldName(item.creditCard);
            byCard.set(key, [...(byCard.get(key) ?? []), item]);
        }
    }
    return [...byCard.values()].flatMap((items) => {
        const first = items[0];
        if (first === undefined || first.creditCard === null) {
            return [];
        }
        const accounts = new NameTally();
        const dueDays = new NameTally();
        for (const { row } of items) {
            accounts.add(row.account);
            dueDays.add(String(row.dueDate.day));
        }
        return [{
            name: first.creditCard.trim(),
            rows: items.length,
            payingAccount: accounts.mode() ?? first.row.account.trim(),
            dueDay: Number(dueDays.mode() ?? first.row.dueDate.day),
            closingDay: closingDaySuggestion(items),
        }];
    });
}

/**
 * Sugere o dia de fechamento pelas compras avulsas cuja data veio da Data da compra — a fixa grava
 * o vencimento e não diz nada do fechamento: a compra antes do fechamento cai
 * numa fatura e a do dia do fechamento em diante, na seguinte (database-design §4.5). Escolhe o
 * dia que separa as duas faturas com menos exceções, porque o banco às vezes lança uma compra
 * num ciclo diferente. É só a sugestão — o usuário confirma o dia (import-design §5.1).
 *
 * @param items Linhas de um cartão.
 * @return O dia de fechamento provável, ou `null` com menos de três compras com data.
 */
function closingDaySuggestion(items: readonly PlannedRow[]): number | null {
    const samples = items
        .filter((item) => item.occurrence === null && item.row.purchaseDate !== null && item.row.repetition.kind !== 'fixed')
        .map((item) => ({ day: item.date.day, offset: item.date.period.monthsUntil(item.row.dueDate.period) }));
    if (samples.length < CLOSING_SAMPLE_MIN) {
        return null;
    }
    const offsets = new Map<number, number>();
    for (const { offset } of samples) {
        offsets.set(offset, (offsets.get(offset) ?? 0) + 1);
    }
    // O par de faturas consecutivas com mais compras: as de antes e as de depois do fechamento.
    let low = 0;
    let lowCount = -1;
    for (const offset of offsets.keys()) {
        const count = (offsets.get(offset) ?? 0) + (offsets.get(offset + 1) ?? 0);
        if (count > lowCount || (count === lowCount && offset < low)) {
            low = offset;
            lowCount = count;
        }
    }
    let best = 1;
    let bestErrors = Number.POSITIVE_INFINITY;
    for (let closing = 1; closing <= 31; closing++) {
        const errors = samples.filter(({ day, offset }) => (day < closing ? offset !== low : offset !== low + 1)).length;
        if (errors < bestErrors) {
            best = closing;
            bestErrors = errors;
        }
    }
    return best;
}

/**
 * @param planned Linhas aceitas.
 * @return Cada par categoria › subcategoria usado por cada conta ou cartão, com quantas linhas o
 * usam. Transferência fica de fora: usa a categoria padrão escolhida na revisão.
 */
function categoryUses(planned: readonly PlannedRow[]): readonly ImportCategoryUse[] {
    const uses = new Map<string, ImportCategoryUse>();
    for (const item of planned) {
        const { row } = item;
        if (row.type === 'transference' || row.category === null || row.subCategory === null) {
            continue;
        }
        const source: ImportSource = item.creditCard === null ? { kind: 'account', name: row.account.trim() } : { kind: 'creditCard', name: item.creditCard.trim() };
        const key = JSON.stringify([source.kind, foldName(source.name), foldName(row.category), foldName(row.subCategory)]);
        const current = uses.get(key);
        uses.set(key, current === undefined
            ? { source, category: row.category.trim(), subCategory: row.subCategory.trim(), rows: 1 }
            : { ...current, rows: current.rows + 1 });
    }
    return [...uses.values()];
}

/**
 * @param planned Linhas aceitas.
 * @return Quantas linhas têm `#palavras` na observação e quais, sem repetição.
 */
function hashtagsOf(planned: readonly PlannedRow[]): { readonly rows: number; readonly names: readonly string[] } {
    const names = new NameTally();
    let rows = 0;
    for (const { row } of planned) {
        const found = hashtagsIn(row.description);
        if (found.length > 0) {
            rows++;
            found.forEach((name) => { names.add(name); });
        }
    }
    return { rows, names: names.entries().map(({ name }) => name) };
}
