import { detectDateFormat, detectDecimalSeparator, looksLikeValue, type DateFormat, type DecimalSeparator } from './cellFormats.ts';
import { detectDelimiter, parseCsv, stripBom, type CsvDelimiter } from './csv.ts';
import { normalizeHeader, type ImportFileKind } from './importFields.ts';
import { normalizeForSearch } from '../format/searchText.ts';

/** Como ler o arquivo — o cartão "Como ler o arquivo" do mockup `DesktopImportArquivo`. */
export interface ReadSettings {
    readonly delimiter: CsvDelimiter;
    readonly decimal: DecimalSeparator;
    readonly dateFormat: DateFormat;
    readonly hasHeader: boolean;
}

/** O arquivo em colunas: cabeçalhos (ou as letras, sem cabeçalho) e as linhas de dados. */
export interface ImportTable {
    readonly headers: readonly string[];
    readonly rows: readonly (readonly string[])[];
}

/** O tipo detectado e por quê, para a tela dizer "Detectado: Despesas (nome do arquivo…)". */
export interface KindDetection {
    readonly kind: ImportFileKind;
    /** Evidências, prontas para a frase; vazia quando o tipo é o padrão. */
    readonly reasons: readonly string[];
}

/** Linhas usadas para detectar decimal e datas: o bastante para votar, sem ler o arquivo todo. */
const DETECTION_ROWS = 200;

/**
 * Detecta como ler o arquivo (import-design §3): o separador pela consistência das colunas, o
 * decimal e as datas pelas células, e o cabeçalho pela primeira linha sem número nem data.
 *
 * @param text Conteúdo decodificado.
 * @return Os valores detectados, que o usuário ajusta se a prévia sair errada.
 */
export function detectReadSettings(text: string): ReadSettings {
    const clean = stripBom(text);
    const delimiter = detectDelimiter(clean);
    const records = parseCsv(clean, delimiter, DETECTION_ROWS);
    const first = records[0] ?? [];
    const cells = records.slice(1).flat();
    return {
        delimiter,
        decimal: detectDecimalSeparator(cells),
        dateFormat: detectDateFormat(cells),
        hasHeader: first.length > 0 && !first.some(looksLikeValue),
    };
}

/**
 * @param text Conteúdo decodificado.
 * @param settings Como ler.
 * @return A tabela, com todas as linhas da mesma largura — a linha curta é completada com vazio,
 * para que uma coluna nunca "escorregue" para a vizinha.
 */
export function readTable(text: string, settings: ReadSettings): ImportTable {
    const records = parseCsv(stripBom(text), settings.delimiter);
    const width = records.reduce((max, record) => Math.max(max, record.length), 0);
    const pad = (record: readonly string[]): readonly string[] => [...record, ...Array.from({ length: width - record.length }, () => '')];
    if (!settings.hasHeader) {
        return { headers: Array.from({ length: width }, (_, index) => `Coluna ${columnLetter(index)}`), rows: records.map(pad) };
    }
    const [header = [], ...rows] = records;
    return { headers: pad(header).map((cell) => cell.trim()), rows: rows.map(pad) };
}

/**
 * @param index Índice da coluna, a partir de 0.
 * @return A letra da coluna como numa planilha: A…Z, AA, AB…
 */
export function columnLetter(index: number): string {
    let letter = '';
    let rest = index + 1;
    while (rest > 0) {
        const remainder = (rest - 1) % 26;
        letter = String.fromCharCode(65 + remainder) + letter;
        rest = Math.floor((rest - 1) / 26);
    }
    return letter;
}

/**
 * Detecta o tipo pelo nome do arquivo e, sem nome que decida, pelas colunas (import-design §3).
 *
 * @param fileName Nome do arquivo escolhido.
 * @param headers Cabeçalhos lidos.
 * @return O tipo e as evidências.
 */
export function detectFileKind(fileName: string, headers: readonly string[]): KindDetection {
    const name = normalizeForSearch(fileName);
    const columns = headers.map(normalizeHeader);
    const reasons: string[] = [];
    let kind: ImportFileKind | null = null;
    if (columns.includes('tipo')) {
        kind = 'mixed';
        reasons.push('coluna “Tipo”');
    } else if (name.includes('transfer')) {
        kind = 'transfers';
        reasons.push('nome do arquivo');
    } else if (name.includes('receita') || name.includes('entrada')) {
        kind = 'incomes';
        reasons.push('nome do arquivo');
    } else if (name.includes('despesa') || name.includes('gasto') || name.includes('saida')) {
        kind = 'expenses';
        reasons.push('nome do arquivo');
    }
    const hasOriginAndDestination = columns.some((column) => column.endsWith('origem')) && columns.some((column) => column.endsWith('destino'));
    const cardColumn = headers.find((header) => ['cartao', 'cartao de credito', 'encargos'].includes(normalizeHeader(header)));
    if ((kind === null || kind === 'transfers') && hasOriginAndDestination) {
        kind = 'transfers';
        reasons.push('colunas de origem e destino');
    } else if ((kind === null || kind === 'expenses') && cardColumn !== undefined) {
        kind = 'expenses';
        reasons.push(`coluna “${cardColumn}”`);
    }
    return { kind: kind ?? 'expenses', reasons };
}

/**
 * @param table Tabela do arquivo.
 * @param column Coluna.
 * @param count Quantos exemplos mostrar.
 * @return Valores distintos da coluna para a tela ("Almoço · Água · Seguro"), com "(vazio)" para a
 * célula em branco — mostra que a coluna tem lacunas.
 */
export function columnSamples(table: ImportTable, column: number, count = 3): readonly string[] {
    const seen: string[] = [];
    for (const row of table.rows) {
        const cell = (row[column] ?? '').trim().replace(/\s+/g, ' ');
        const sample = cell === '' ? '(vazio)' : cell;
        if (!seen.includes(sample)) {
            seen.push(sample);
            if (seen.length === count) {
                break;
            }
        }
    }
    return seen;
}
