/*
 * Leitura de CSV para a importação (import-design §3). Escrita à mão, sem biblioteca: o formato
 * que importa é pequeno — separador, aspas, aspas dobradas e quebra de linha dentro de aspas (as
 * observações do arquivo real têm várias linhas) — e o `client` não carrega dependência de
 * plataforma.
 */

/** Separadores de coluna aceitos, na ordem de preferência do empate. */
export const CSV_DELIMITERS = [',', ';', '\t'] as const;

/** Separador de colunas, derivado da lista para que a detecção e o seletor da tela nunca divirjam. */
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

/** Quantas linhas a detecção do separador examina; o começo do arquivo basta e é barato. */
const DETECTION_RECORDS = 30;

/**
 * Lê o texto inteiro em registros. Aspas abrem um campo que pode conter o separador, quebras de
 * linha e aspas dobradas (`""` = `"`). `\r\n` e `\n` encerram o registro; a linha totalmente
 * vazia é descartada, porque planilhas costumam deixar uma no fim.
 *
 * @param text Conteúdo do arquivo, já decodificado e sem BOM.
 * @param delimiter Separador de colunas.
 * @param limit Para de ler depois de tantos registros — a detecção não precisa do arquivo todo.
 * @return Os registros, cada um com os campos como estão no arquivo (sem aparar).
 */
export function parseCsv(text: string, delimiter: CsvDelimiter, limit = Number.POSITIVE_INFINITY): readonly (readonly string[])[] {
    const records: string[][] = [];
    let record: string[] = [];
    let field = '';
    let quoted = false;
    let index = 0;
    /** Fecha o registro corrente, descartando a linha vazia. */
    const closeRecord = (): void => {
        record.push(field);
        if (record.length > 1 || record[0] !== '') {
            records.push(record);
        }
        record = [];
        field = '';
    };
    while (index < text.length && records.length < limit) {
        const char = text[index] ?? '';
        if (quoted) {
            if (char === '"' && text[index + 1] === '"') {
                field += '"';
                index += 2;
                continue;
            }
            if (char === '"') {
                quoted = false;
            } else {
                field += char;
            }
            index++;
            continue;
        }
        if (char === '"' && field === '') {
            quoted = true;
        } else if (char === delimiter) {
            record.push(field);
            field = '';
        } else if (char === '\n' || char === '\r') {
            closeRecord();
            if (char === '\r' && text[index + 1] === '\n') {
                index++;
            }
        } else {
            field += char;
        }
        index++;
    }
    if (records.length < limit && (field !== '' || record.length > 0)) {
        closeRecord();
    }
    return records;
}

/**
 * Escolhe o separador que dá o mesmo número de colunas (mais de uma) no maior número das primeiras
 * linhas. Contar o caractere não serviria: a vírgula decimal de um arquivo com `;` ganharia.
 *
 * @param text Conteúdo do arquivo.
 * @return O separador mais consistente; vírgula quando nenhum separa nada.
 */
export function detectDelimiter(text: string): CsvDelimiter {
    let best: CsvDelimiter = ',';
    let bestScore = 0;
    for (const delimiter of CSV_DELIMITERS) {
        const widths = parseCsv(text, delimiter, DETECTION_RECORDS).map((record) => record.length);
        const counts = new Map<number, number>();
        for (const width of widths) {
            counts.set(width, (counts.get(width) ?? 0) + 1);
        }
        let score = 0;
        for (const [width, times] of counts) {
            if (width > 1 && times > score) {
                score = times;
            }
        }
        if (score > bestScore) {
            best = delimiter;
            bestScore = score;
        }
    }
    return best;
}

/**
 * @param text Conteúdo decodificado.
 * @return O texto sem o BOM do UTF-8, que o Excel grava e que grudaria no primeiro cabeçalho.
 */
export function stripBom(text: string): string {
    return text.startsWith('﻿') ? text.slice(1) : text;
}
