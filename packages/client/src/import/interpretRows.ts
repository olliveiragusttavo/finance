import type { CoreInput, ImportTransactionType, RecurrenceFrequency } from '@finance/core';
import { normalizeForSearch } from '../format/searchText.ts';
import { parseDateCell, parseNumberCell, type DateFormat, type DecimalSeparator } from './cellFormats.ts';
import type { ColumnMapping, ImportFieldId, ImportFileKind } from './importFields.ts';
import type { ImportTable } from './importTable.ts';

/** Linha como a rota `imports.run` recebe. */
export type ImportRowInput = CoreInput<'imports.run'>['rows'][number];

/** Por que o client não conseguiu ler uma linha — o formato; o conteúdo, a análise do núcleo confere. */
export type ImportReadProblemReason = 'required-empty' | 'invalid-number' | 'invalid-date' | 'unknown-type';

/** Linha que não pôde ser lida, com o campo culpado. */
export interface ImportReadProblem {
    readonly line: number;
    readonly field: ImportFieldId;
    readonly reason: ImportReadProblemReason;
}

/** As linhas lidas e as que ficaram de fora. */
export interface InterpretedRows {
    readonly rows: readonly ImportRowInput[];
    readonly problems: readonly ImportReadProblem[];
}

/** O que a interpretação precisa da etapa Arquivo. */
export interface InterpretSettings {
    readonly kind: ImportFileKind;
    readonly decimal: DecimalSeparator;
    readonly dateFormat: DateFormat;
}

/** Valores de "sem cartão", "sem destino" e afins no app de origem. */
const EMPTY_MARKS = new Set(['', '-', '—', '–']);

/** Tipo pelo arquivo, nos arquivos de um tipo só. */
const KIND_TYPE: Readonly<Record<Exclude<ImportFileKind, 'mixed'>, ImportTransactionType>> = {
    expenses: 'expense',
    incomes: 'income',
    transfers: 'transference',
};

/**
 * Lê as linhas do arquivo pelos campos ligados (import-design §3 e §4). A linha com campo
 * obrigatório vazio ou com data ou número ilegível sai com o motivo e não chega ao núcleo.
 *
 * @param table Tabela do arquivo.
 * @param mapping Campos ligados às colunas.
 * @param settings Tipo do arquivo e formatos de número e data.
 * @return As linhas lidas, na ordem do arquivo, e os problemas.
 */
export function interpretRows(table: ImportTable, mapping: ColumnMapping, settings: InterpretSettings): InterpretedRows {
    const rows: ImportRowInput[] = [];
    const problems: ImportReadProblem[] = [];
    table.rows.forEach((cells, index) => {
        const result = interpretRow(cells, index + 1, mapping, settings);
        if ('problem' in result) {
            problems.push(result.problem);
        } else {
            rows.push(result.row);
        }
    });
    return { rows, problems };
}

/**
 * @param cells Células da linha.
 * @param line Número da linha de dados (a 1ª é 1).
 * @param mapping Campos ligados.
 * @param settings Tipo e formatos.
 * @return A linha lida, ou o primeiro problema dela.
 */
function interpretRow(
    cells: readonly string[],
    line: number,
    mapping: ColumnMapping,
    settings: InterpretSettings,
): { readonly row: ImportRowInput } | { readonly problem: ImportReadProblem } {
    /**
     * @param field Campo.
     * @return O texto aparado da coluna ligada; `null` sem coluna ou com "-" e vazio.
     */
    const text = (field: ImportFieldId): string | null => {
        const column = mapping[field];
        const cell = column === undefined ? '' : (cells[column] ?? '').trim();
        return EMPTY_MARKS.has(cell) ? null : cell;
    };
    /**
     * @param field Campo.
     * @param reason Motivo.
     * @return O problema da linha.
     */
    const problem = (field: ImportFieldId, reason: ImportReadProblemReason): { readonly problem: ImportReadProblem } => ({ problem: { line, field, reason } });

    const type = settings.kind === 'mixed' ? typeOf(text('type')) : KIND_TYPE[settings.kind];
    if (type === null) {
        return problem('type', text('type') === null ? 'required-empty' : 'unknown-type');
    }
    const name = text('name');
    if (name === null) {
        return problem('name', 'required-empty');
    }
    const valueText = text('value');
    if (valueText === null) {
        return problem('value', 'required-empty');
    }
    const value = parseNumberCell(valueText, settings.decimal);
    if (value === null) {
        return problem('value', 'invalid-number');
    }
    const chargesText = text('charges');
    const charges = chargesText === null ? 0 : parseNumberCell(chargesText, settings.decimal);
    if (charges === null) {
        return problem('charges', 'invalid-number');
    }
    const dates: Partial<Record<'dueDate' | 'paymentDate' | 'purchaseDate', string | null>> = {};
    for (const field of ['dueDate', 'paymentDate', 'purchaseDate'] as const) {
        const cell = parseDateCell(text(field) ?? '', settings.dateFormat);
        if (cell.kind === 'invalid') {
            return problem(field, 'invalid-date');
        }
        dates[field] = cell.kind === 'date' ? cell.date : null;
    }
    const dueDate = dates.dueDate ?? null;
    if (dueDate === null) {
        return problem('dueDate', 'required-empty');
    }
    const transfer = type === 'transference';
    const account = text(settings.kind === 'transfers' ? 'origin' : 'account');
    if (account === null) {
        return problem(settings.kind === 'transfers' ? 'origin' : 'account', 'required-empty');
    }
    const destination = transfer ? text('destination') : null;
    if (transfer && destination === null) {
        return problem('destination', 'required-empty');
    }
    return {
        row: {
            line,
            type,
            name,
            value,
            charges,
            dueDate,
            paymentDate: dates.paymentDate ?? null,
            purchaseDate: dates.purchaseDate ?? null,
            account,
            creditCard: type === 'expense' ? text('creditCard') : null,
            destination,
            category: transfer ? null : text('category'),
            subCategory: transfer ? null : text('subCategory'),
            description: descriptionOf(mapping, cells),
            tags: (text('tags') ?? '').split(/[,;#]/).map((tag) => tag.trim()).filter((tag) => tag !== ''),
            repetition: repetitionOf(text('repetition'), integerOf(text('installment')), integerOf(text('installments'))),
        },
    };
}

/**
 * @param mapping Campos ligados.
 * @param cells Células da linha.
 * @return A observação inteira, com as quebras de linha, ou `null` vazia — aqui o texto não é
 * aparado por linha, porque é texto livre do usuário.
 */
function descriptionOf(mapping: ColumnMapping, cells: readonly string[]): string | null {
    const column = mapping.description;
    const cell = column === undefined ? '' : (cells[column] ?? '').trim();
    return cell === '' ? null : cell;
}

/**
 * Regra de formato (import-design §4): o tipo da linha num arquivo de vários tipos.
 *
 * @param text Célula da coluna de tipo.
 * @return O tipo, ou `null` quando a célula está vazia ou não é reconhecida.
 */
function typeOf(text: string | null): ImportTransactionType | null {
    if (text === null) {
        return null;
    }
    const value = normalizeForSearch(text);
    if (value.startsWith('transf')) {
        return 'transference';
    }
    if (['receita', 'entrada', 'credito', 'income'].some((word) => value.startsWith(word))) {
        return 'income';
    }
    if (['despesa', 'saida', 'debito', 'gasto', 'expense'].some((word) => value.startsWith(word))) {
        return 'expense';
    }
    return null;
}

/**
 * @param text Célula de número de parcela.
 * @return O inteiro positivo; `null` vazio, zero (o "0" das linhas avulsas do app de origem) ou ilegível.
 */
function integerOf(text: string | null): number | null {
    if (text === null || !/^\d+$/.test(text)) {
        return null;
    }
    const value = Number(text);
    return value > 0 ? value : null;
}

/**
 * Regra de formato (import-design §4): "fix…" é fixa, "parcel…" é parcelada, o resto é avulsa;
 * "diária", "semanal" e "anual" dão a frequência, e mensal é o padrão. Sem coluna de recorrência,
 * parcela e total válidos bastam para o parcelamento.
 *
 * @param text Célula da coluna de recorrência.
 * @param installment Número da parcela.
 * @param installments Total de parcelas.
 * @return A repetição da linha.
 */
function repetitionOf(text: string | null, installment: number | null, installments: number | null): ImportRowInput['repetition'] {
    const value = normalizeForSearch(text ?? '');
    const frequency: RecurrenceFrequency = value.includes('diari') ? 'daily' : value.includes('seman') ? 'weekly' : value.includes('anual') ? 'yearly' : 'monthly';
    if (value.includes('parcel') || (text === null && installments !== null && installments > 1)) {
        return { kind: 'installments', frequency, installment, installments };
    }
    return value.includes('fix') ? { kind: 'fixed', frequency } : { kind: 'none' };
}
