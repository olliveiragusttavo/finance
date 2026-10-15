import { LocalDate } from '@finance/core';

/*
 * Interpretação das células de número e de data da importação (import-design §3). É formato,
 * não regra de negócio: decide só como o texto do arquivo vira número e data `YYYY-MM-DD`.
 */

/** Separador decimal do arquivo: `9000.00` ou `9000,00`. */
export type DecimalSeparator = 'dot' | 'comma';

/** Ordem do dia, do mês e do ano nas datas do arquivo. */
export type DateFormat = 'dmy' | 'ymd' | 'mdy';

/** Valor de célula de data: a data, vazio (sem data) ou ilegível. */
export type DateCell = { readonly kind: 'date'; readonly date: string } | { readonly kind: 'empty' } | { readonly kind: 'invalid' };

/** Data com dia, mês e ano separados por `/`, `-` ou `.`, opcionalmente seguida de hora. */
const DATE_PATTERN = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})(?:[ T].*)?$/;

/** Marcas que o app de origem e as planilhas usam para "sem data". */
const EMPTY_MARKS = new Set(['', '-', '—', '–']);

/**
 * Lê um número escrito no arquivo. Aceita símbolo de moeda, espaços, separador de milhar e o sinal
 * na frente, atrás ou entre parênteses (o formato contábil), porque cada planilha exporta de um
 * jeito.
 *
 * @param text Célula como está no arquivo.
 * @param decimal Separador decimal escolhido.
 * @return O número; `null` quando a célula está vazia ou não é um número.
 */
export function parseNumberCell(text: string, decimal: DecimalSeparator): number | null {
    let clean = text.trim().replace(/[R$\s]/g, '');
    if (clean === '' || clean === '-') {
        return null;
    }
    let negative = false;
    if (clean.startsWith('(') && clean.endsWith(')')) {
        negative = true;
        clean = clean.slice(1, -1);
    }
    if (clean.endsWith('-')) {
        negative = !negative;
        clean = clean.slice(0, -1);
    }
    if (clean.startsWith('-') || clean.startsWith('−')) {
        negative = !negative;
        clean = clean.slice(1);
    } else if (clean.startsWith('+')) {
        clean = clean.slice(1);
    }
    // O milhar só sai depois de conferida a estrutura: com decimal em ponto, "46,88" é ilegível,
    // e não 4688.
    const structure = decimal === 'dot' ? /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/ : /^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/;
    if (!structure.test(clean)) {
        return null;
    }
    const value = Number(decimal === 'dot' ? clean.split(',').join('') : clean.split('.').join('').replace(',', '.'));
    return Number.isFinite(value) ? (negative ? -value : value) : null;
}

/**
 * Lê uma data do arquivo, descartando a hora quando há (a coluna "Lançamento" do app de origem
 * traz "12/08/2025 23:09").
 *
 * @param text Célula como está no arquivo.
 * @param format Ordem dos componentes.
 * @return A data `YYYY-MM-DD`, vazio para "-" e célula em branco, ou ilegível.
 */
export function parseDateCell(text: string, format: DateFormat): DateCell {
    const clean = text.trim();
    if (EMPTY_MARKS.has(clean)) {
        return { kind: 'empty' };
    }
    const match = DATE_PATTERN.exec(clean);
    if (match === null) {
        return { kind: 'invalid' };
    }
    const [first, second, third] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const [year, month, day] = format === 'ymd' ? [first, second, third] : format === 'dmy' ? [third, second, first] : [third, first, second];
    // Ano com dois dígitos é deste século: nenhum histórico financeiro pessoal começa em 19xx com ano curto.
    const fullYear = year < 100 ? 2000 + year : year;
    try {
        return { kind: 'date', date: LocalDate.of(fullYear, month, day).toString() };
    } catch {
        return { kind: 'invalid' };
    }
}

/**
 * Detecta o separador decimal pelas células que só um deles explica: `46.88` vota no ponto,
 * `46,88` na vírgula. Três casas depois do separador não votam — `1.234` pode ser milhar.
 *
 * @param cells Células de todo o arquivo (ou de uma amostra).
 * @return O separador com mais votos; vírgula no empate, o padrão brasileiro.
 */
export function detectDecimalSeparator(cells: readonly string[]): DecimalSeparator {
    let dot = 0;
    let comma = 0;
    for (const cell of cells) {
        const clean = cell.trim().replace(/[R$\s]/g, '');
        if (/^[-(]?\d{1,3}(?:,\d{3})*\.\d{1,2}\)?$|^[-(]?\d+\.\d{1,2}\)?$/.test(clean)) {
            dot++;
        } else if (/^[-(]?\d{1,3}(?:\.\d{3})*,\d{1,2}\)?$|^[-(]?\d+,\d{1,2}\)?$/.test(clean)) {
            comma++;
        }
    }
    return dot > comma ? 'dot' : 'comma';
}

/**
 * Detecta a ordem das datas: ano de quatro dígitos na frente é `ymd`; um primeiro componente
 * acima de 12 só pode ser dia (`dmy`), um segundo acima de 12 só pode ser dia (`mdy`).
 *
 * @param cells Células de todo o arquivo (ou de uma amostra).
 * @return O formato com mais evidência; `dmy` sem evidência, o padrão brasileiro.
 */
export function detectDateFormat(cells: readonly string[]): DateFormat {
    const votes: Record<DateFormat, number> = { dmy: 0, ymd: 0, mdy: 0 };
    for (const cell of cells) {
        const match = DATE_PATTERN.exec(cell.trim());
        if (match === null) {
            continue;
        }
        const [first, second] = [match[1] ?? '', Number(match[2])];
        if (first.length === 4) {
            votes.ymd++;
        } else if (Number(first) > 12) {
            votes.dmy++;
        } else if (second > 12) {
            votes.mdy++;
        }
    }
    if (votes.ymd > votes.dmy && votes.ymd > votes.mdy) {
        return 'ymd';
    }
    return votes.mdy > votes.dmy ? 'mdy' : 'dmy';
}

/**
 * @param cell Célula como está no arquivo.
 * @return `true` quando a célula parece número ou data — o que um cabeçalho não costuma ser.
 */
export function looksLikeValue(cell: string): boolean {
    const clean = cell.trim();
    return DATE_PATTERN.test(clean) || /^[-+(]?[R$\s]*\d[\d.,\s]*\)?-?$/.test(clean);
}
