import { formatDate, formatMoney, MINUS, type ImportFileKind, type ImportReadProblem, type ImportRowInput, type KindDetection } from '@finance/client';
import type { CsvDelimiter, DateFormat, DecimalSeparator } from '@finance/client';
import type { ImportIssue, ImportResponse } from '@finance/core';
import { TEMPLATE_NAME_MAX_LENGTH, type ImportFileResult } from '../../../shared/bridge.ts';

/*
 * Textos e regras de apresentação do assistente de importação (desktop-mvp-plan Fase 13.1;
 * mockups `DesktopImport*`). Funções puras, fora dos componentes, para serem testadas sem montar
 * a janela.
 */

/** Etapa do assistente. */
export type ImportStep = 'file' | 'columns' | 'review';

/** As etapas na ordem do indicador "1 Arquivo — 2 Colunas — 3 Revisar". */
export const IMPORT_STEPS: readonly { readonly id: ImportStep; readonly label: string }[] = [
    { id: 'file', label: 'Arquivo' },
    { id: 'columns', label: 'Colunas' },
    { id: 'review', label: 'Revisar' },
];

/** Codificação do texto do arquivo. */
export type FileEncoding = 'utf-8' | 'latin-1';

/** O texto do arquivo e a codificação usada para lê-lo. */
export interface DecodedFile {
    readonly text: string;
    readonly encoding: FileEncoding;
}

/**
 * Decodifica o arquivo (import-design §3): UTF-8 quando os bytes são UTF-8 válido, senão Latin-1 —
 * na prática o windows-1252 que o Excel grava, que cobre as aspas e o travessão que o Latin-1
 * puro não tem.
 *
 * @param bytes Conteúdo lido pelo processo principal.
 * @param encoding Codificação escolhida na tela; `null` detecta.
 * @return O texto e a codificação usada.
 */
export function decodeImportFile(bytes: Uint8Array, encoding: FileEncoding | null): DecodedFile {
    if (encoding === 'latin-1') {
        return { text: new TextDecoder('windows-1252').decode(bytes), encoding };
    }
    try {
        return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
    } catch {
        return encoding === 'utf-8'
            ? { text: new TextDecoder('utf-8').decode(bytes), encoding }
            : { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'latin-1' };
    }
}

/**
 * @param value Inteiro não negativo.
 * @return O número com ponto de milhar, "1.890" — sem `Intl`, que o projeto não usa para não
 * depender do ICU de cada plataforma.
 */
export function formatCount(value: number): string {
    return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * @param bytes Tamanho em bytes.
 * @return O tamanho legível: "264 KB", "1,2 MB".
 */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024 * 1024) {
        return `${formatCount(Math.max(1, Math.round(bytes / 1024)))} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/** Opções do "O que o arquivo contém". */
export const KIND_OPTIONS: readonly { readonly kind: ImportFileKind; readonly label: string; readonly description: string }[] = [
    { kind: 'expenses', label: 'Despesas', description: 'Na conta ou no cartão de crédito' },
    { kind: 'incomes', label: 'Receitas', description: 'Entradas numa conta' },
    { kind: 'transfers', label: 'Transferências', description: 'Entre duas contas, com origem e destino' },
    { kind: 'mixed', label: 'Vários tipos', description: 'Uma coluna diz o tipo de cada linha' },
];

/**
 * @param kind Tipo do arquivo.
 * @return O nome do tipo, "Despesas".
 */
export function kindLabel(kind: ImportFileKind): string {
    return KIND_OPTIONS.find((option) => option.kind === kind)?.label ?? kind;
}

/**
 * Nome sugerido para salvar o mapeamento como modelo. É cortado no limite do processo principal
 * porque o nome do arquivo não tem tamanho certo, e um nome sugerido longo demais seria recusado
 * ao avançar, sem que o usuário tivesse digitado nada.
 *
 * @param kind Tipo do arquivo, que abre o nome para o modelo ser reconhecido na lista.
 * @param fileName Nome-base do arquivo importado, que distingue modelos do mesmo tipo.
 * @return "Despesas — despesas.csv", com no máximo `TEMPLATE_NAME_MAX_LENGTH` caracteres.
 */
export function defaultTemplateName(kind: ImportFileKind, fileName: string): string {
    return `${kindLabel(kind)} — ${fileName}`.slice(0, TEMPLATE_NAME_MAX_LENGTH);
}

/**
 * @param detection Tipo detectado e evidências.
 * @return "Detectado: Despesas (nome do arquivo e coluna “Cartão”)"; sem evidência, diz que é o
 * padrão, para o usuário conferir.
 */
export function detectedKindText(detection: KindDetection): string {
    const { reasons } = detection;
    if (reasons.length === 0) {
        return `Sem pista no arquivo: ${kindLabel(detection.kind)} por padrão`;
    }
    const joined = reasons.length === 1 ? reasons.join('') : `${reasons.slice(0, -1).join(', ')} e ${reasons[reasons.length - 1] ?? ''}`;
    return `Detectado: ${kindLabel(detection.kind)} (${joined})`;
}

export const DELIMITER_OPTIONS: readonly { readonly value: CsvDelimiter; readonly label: string }[] = [
    { value: ',', label: 'Vírgula ( , )' },
    { value: ';', label: 'Ponto e vírgula ( ; )' },
    { value: '\t', label: 'Tabulação' },
];

export const DECIMAL_OPTIONS: readonly { readonly value: DecimalSeparator; readonly label: string }[] = [
    { value: 'dot', label: 'Ponto — 9000.00' },
    { value: 'comma', label: 'Vírgula — 9000,00' },
];

export const DATE_FORMAT_OPTIONS: readonly { readonly value: DateFormat; readonly label: string }[] = [
    { value: 'dmy', label: 'dd/mm/aaaa' },
    { value: 'ymd', label: 'aaaa-mm-dd' },
    { value: 'mdy', label: 'mm/dd/aaaa' },
];

export const ENCODING_OPTIONS: readonly { readonly value: FileEncoding; readonly label: string }[] = [
    { value: 'utf-8', label: 'UTF-8' },
    { value: 'latin-1', label: 'Latin-1' },
];

/**
 * @param delimiter Separador escolhido.
 * @param decimal Decimal escolhido.
 * @param dateFormat Formato de data escolhido.
 * @return O resumo da leitura na faixa do arquivo: "vírgula · decimal com ponto · dd/mm/aaaa".
 */
export function readSummary(delimiter: CsvDelimiter, decimal: DecimalSeparator, dateFormat: DateFormat): string {
    const separator = delimiter === ',' ? 'vírgula' : delimiter === ';' ? 'ponto e vírgula' : 'tabulação';
    const point = decimal === 'dot' ? 'decimal com ponto' : 'decimal com vírgula';
    const date = DATE_FORMAT_OPTIONS.find((option) => option.value === dateFormat)?.label ?? dateFormat;
    return `${separator} · ${point} · ${date}`;
}

/**
 * @param reason Por que o arquivo não foi lido.
 * @return O que dizer ao usuário; `null` no cancelamento, que não é erro.
 */
export function openFailureMessage(reason: Extract<ImportFileResult, { ok: false }>['reason']): string | null {
    switch (reason) {
        case 'canceled':
            return null;
        case 'too-large':
            return 'O arquivo passa de 20 MB. Confira se é mesmo a planilha de lançamentos.';
        case 'read-failed':
            return 'Não foi possível ler o arquivo. Confira se ele ainda existe e se você pode abri-lo.';
    }
}

/** Nome de cada campo nas mensagens de problema. */
const FIELD_NAMES: Readonly<Record<ImportReadProblem['field'], string>> = {
    name: 'Nome',
    value: 'Valor',
    dueDate: 'Vencimento',
    type: 'Tipo',
    account: 'Conta',
    creditCard: 'Cartão',
    origin: 'Conta de origem',
    destination: 'Conta de destino',
    category: 'Categoria',
    subCategory: 'Subcategoria',
    description: 'Observação',
    tags: 'Tags',
    paymentDate: 'Data de pagamento',
    purchaseDate: 'Data da compra',
    charges: 'Encargos',
    repetition: 'Recorrência',
    installment: 'Nº da parcela',
    installments: 'Total de parcelas',
};

/**
 * @param problem Linha que o client não conseguiu ler.
 * @return "Linha 12: Valor ilegível".
 */
export function readProblemText(problem: ImportReadProblem): string {
    const field = FIELD_NAMES[problem.field];
    switch (problem.reason) {
        case 'required-empty':
            return `Linha ${String(problem.line)}: ${field} vazio`;
        case 'invalid-number':
            return `Linha ${String(problem.line)}: ${field} não é um número`;
        case 'invalid-date':
            return `Linha ${String(problem.line)}: ${field} não é uma data válida`;
        case 'unknown-type':
            return `Linha ${String(problem.line)}: tipo não reconhecido (use despesa, receita ou transferência)`;
    }
}

/**
 * @param issue Linha recusada pela análise do núcleo.
 * @return "Linha 12: categoria ou subcategoria vazia".
 */
export function issueText(issue: ImportIssue): string {
    const line = `Linha ${String(issue.line)}`;
    switch (issue.reason) {
        case 'name-invalid':
            return `${line}: nome vazio ou com mais de 100 caracteres`;
        case 'account-invalid':
            return `${line}: conta vazia ou com mais de 45 caracteres`;
        case 'credit-card-invalid':
            return `${line}: cartão com mais de 45 caracteres`;
        case 'category-missing':
            return `${line}: categoria ou subcategoria vazia`;
        case 'category-invalid':
            return `${line}: categoria ou subcategoria com mais de 45 caracteres`;
        case 'destination-missing':
            return `${line}: transferência sem conta de destino`;
        case 'destination-equals-origin':
            return `${line}: transferência com origem e destino iguais`;
        case 'tag-invalid':
            return `${line}: tag com mais de 45 caracteres`;
    }
}

/** Uma linha da prévia "Como os lançamentos vão ficar". */
export interface PreviewRow {
    readonly line: number;
    readonly dueDate: string;
    readonly name: string;
    readonly classification: string;
    readonly where: string;
    readonly repetition: string;
    readonly status: string;
    readonly paid: boolean;
    readonly value: string;
    /** Direção do valor, para a cor — que nunca é o único sinal (decisão de interface 7). */
    readonly direction: 'in' | 'out' | 'transfer';
}

/**
 * Prévia das primeiras linhas lidas, como o mockup `DesktopImportMapear`: o valor leva o sinal
 * (+, − ou ⇄) pelo tipo, e não só a cor (decisão de interface 7).
 *
 * @param rows Linhas lidas.
 * @param currency Moeda do perfil ativo, só para o símbolo.
 * @param count Quantas linhas mostrar.
 * @return As linhas da prévia.
 */
export function previewRows(rows: readonly ImportRowInput[], currency: string, count = 4): readonly PreviewRow[] {
    return rows.slice(0, count).map((row) => {
        const transfer = row.type === 'transference';
        const money = formatMoney({ amount: Math.abs(row.value), currency }, 'absolute');
        const reversed = row.value < 0;
        const direction = transfer ? 'transfer' : (row.type === 'income') !== reversed ? 'in' : 'out';
        const card = row.creditCard ?? null;
        return {
            line: row.line,
            dueDate: formatDate(row.dueDate),
            name: row.name,
            classification: transfer ? 'Categoria padrão da revisão' : `${row.category ?? '—'} › ${row.subCategory ?? '—'}`,
            where: transfer ? `${row.account} → ${row.destination ?? '—'}` : card === null ? row.account : `Cartão ${card}`,
            repetition: repetitionText(row.repetition ?? { kind: 'none' }),
            status: row.paymentDate === null || row.paymentDate === undefined ? 'Pendente' : `Pago ${formatDate(row.paymentDate)}`,
            paid: row.paymentDate !== null && row.paymentDate !== undefined,
            value: direction === 'transfer' ? `⇄ ${money}` : `${direction === 'in' ? '+' : MINUS}${money}`,
            direction,
        };
    });
}

/**
 * @param repetition Repetição da linha.
 * @return "Fixa mensal", "Parcela 3/10" ou "—".
 */
function repetitionText(repetition: NonNullable<ImportRowInput['repetition']>): string {
    const frequency = { daily: 'diária', weekly: 'semanal', monthly: 'mensal', yearly: 'anual' } as const;
    switch (repetition.kind) {
        case 'none':
            return '—';
        case 'fixed':
            return `Fixa ${frequency[repetition.frequency]}`;
        case 'installments':
            return repetition.installment === null || repetition.installments === null
                ? 'Parcelada'
                : `Parcela ${String(repetition.installment)}/${String(repetition.installments)}`;
    }
}

/**
 * @param count Linhas que serão importadas.
 * @return O rótulo do botão final, "Importar 1.890 linhas".
 */
export function importButtonLabel(count: number): string {
    return count === 1 ? 'Importar 1 linha' : `Importar ${formatCount(count)} linhas`;
}

/**
 * @param outcome Resumo do núcleo.
 * @return A frase de confirmação, só com o que aconteceu.
 */
export function outcomeText(outcome: ImportResponse): string {
    const parts = [
        `${formatCount(outcome.transactions)} lançamentos`,
        outcome.fixedSeries + outcome.installmentSeries > 0 ? `${formatCount(outcome.fixedSeries + outcome.installmentSeries)} recorrências` : null,
        outcome.invoicesPaid > 0 ? `${formatCount(outcome.invoicesPaid)} faturas pagas` : null,
        outcome.accountsCreated > 0 ? `${formatCount(outcome.accountsCreated)} contas novas` : null,
        outcome.creditCardsCreated > 0 ? `${formatCount(outcome.creditCardsCreated)} cartões novos` : null,
        outcome.categoriesCreated + outcome.subCategoriesCreated > 0 ? `${formatCount(outcome.categoriesCreated + outcome.subCategoriesCreated)} categorias e subcategorias novas` : null,
        outcome.tagsCreated > 0 ? `${formatCount(outcome.tagsCreated)} tags novas` : null,
    ].filter((part) => part !== null);
    const skipped = outcome.skipped > 0 ? ` ${formatCount(outcome.skipped)} linhas com problema ficaram de fora.` : '';
    return `Importado: ${parts.join(', ')}.${skipped}`;
}
