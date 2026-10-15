import { normalizeForSearch } from '../format/searchText.ts';

/*
 * Campos do app que uma coluna do arquivo pode alimentar (mockup `DesktopImportMapear`;
 * import-design §4).
 */

/** O que o arquivo contém: um tipo de lançamento, ou vários com uma coluna de tipo. */
export type ImportFileKind = 'expenses' | 'incomes' | 'transfers' | 'mixed';

export const IMPORT_FILE_KINDS: readonly ImportFileKind[] = ['expenses', 'incomes', 'transfers', 'mixed'];

/**
 * Campo do app que uma coluna alimenta. União fechada para que um campo novo obrigue a dar nome,
 * grupo e sinônimos a ele no catálogo — e a salvar o modelo com ele no processo principal.
 */
export type ImportFieldId =
    | 'name'
    | 'value'
    | 'dueDate'
    | 'type'
    | 'account'
    | 'creditCard'
    | 'origin'
    | 'destination'
    | 'category'
    | 'subCategory'
    | 'description'
    | 'tags'
    | 'paymentDate'
    | 'purchaseDate'
    | 'charges'
    | 'repetition'
    | 'installment'
    | 'installments';

/** Grupo em que o campo aparece na paleta, na ordem do mockup. */
export type ImportFieldGroup = 'essentials' | 'accounts' | 'classification' | 'dates' | 'repetition';

export const IMPORT_FIELD_GROUPS: readonly ImportFieldGroup[] = ['essentials', 'accounts', 'classification', 'dates', 'repetition'];

/** Um campo do app, com onde ele vale e como reconhecê-lo pelo cabeçalho. */
export interface ImportField {
    readonly id: ImportFieldId;
    readonly label: string;
    readonly group: ImportFieldGroup;
    /** Tipos de arquivo que têm o campo. */
    readonly kinds: readonly ImportFileKind[];
    /** Tipos de arquivo em que o campo é obrigatório. */
    readonly requiredIn: readonly ImportFileKind[];
    /** Explicação curta, no `title` do campo. */
    readonly hint: string | null;
    /** Cabeçalhos (normalizados) que ligam a coluna sozinhos. */
    readonly names: readonly string[];
    /** Cabeçalhos ambíguos que só viram dica na coluna — o usuário decide. */
    readonly hintNames: readonly string[];
}

const ALL: readonly ImportFileKind[] = IMPORT_FILE_KINDS;
const SINGLE_ACCOUNT: readonly ImportFileKind[] = ['expenses', 'incomes', 'mixed'];
const WITH_CARD: readonly ImportFileKind[] = ['expenses', 'mixed'];

/**
 * Catálogo dos campos. "Efetivação" e "Lançamento" ficam como dica, e não como ligação automática,
 * porque cada app usa os nomes para coisas diferentes — a decisão do mockup é mostrar a dica e
 * deixar o usuário ligar.
 */
export const IMPORT_FIELDS: readonly ImportField[] = [
    { id: 'name', label: 'Nome', group: 'essentials', kinds: ALL, requiredIn: ALL, hint: 'Texto do lançamento', names: ['descricao', 'nome', 'historico', 'titulo', 'lancamento descricao'], hintNames: [] },
    { id: 'value', label: 'Valor', group: 'essentials', kinds: ALL, requiredIn: ALL, hint: 'Número; o tipo define se entra ou sai', names: ['valor', 'montante', 'quantia', 'valor r'], hintNames: [] },
    { id: 'dueDate', label: 'Vencimento', group: 'essentials', kinds: ALL, requiredIn: ALL, hint: 'Data; no cartão, o vencimento da fatura', names: ['vencimento', 'data de vencimento', 'data vencimento', 'data'], hintNames: [] },
    { id: 'type', label: 'Tipo', group: 'essentials', kinds: ['mixed'], requiredIn: ['mixed'], hint: 'Despesa, receita ou transferência', names: ['tipo', 'natureza', 'tipo de lancamento'], hintNames: [] },
    { id: 'account', label: 'Conta', group: 'accounts', kinds: SINGLE_ACCOUNT, requiredIn: SINGLE_ACCOUNT, hint: 'Em compras no cartão: a conta que paga a fatura', names: ['conta', 'conta corrente', 'banco', 'conta de origem'], hintNames: [] },
    { id: 'creditCard', label: 'Cartão de crédito', group: 'accounts', kinds: WITH_CARD, requiredIn: [], hint: 'Vazio ou “-” = sem cartão', names: ['cartao', 'cartao de credito'], hintNames: [] },
    { id: 'origin', label: 'Conta de origem', group: 'accounts', kinds: ['transfers'], requiredIn: ['transfers'], hint: null, names: ['origem', 'conta de origem', 'de'], hintNames: [] },
    { id: 'destination', label: 'Conta de destino', group: 'accounts', kinds: ['transfers', 'mixed'], requiredIn: ['transfers'], hint: 'Nas transferências', names: ['destino', 'conta de destino', 'para'], hintNames: [] },
    { id: 'category', label: 'Categoria', group: 'classification', kinds: SINGLE_ACCOUNT, requiredIn: SINGLE_ACCOUNT, hint: null, names: ['categoria'], hintNames: [] },
    { id: 'subCategory', label: 'Subcategoria', group: 'classification', kinds: SINGLE_ACCOUNT, requiredIn: SINGLE_ACCOUNT, hint: null, names: ['subcategoria', 'sub categoria', 'sub-categoria'], hintNames: [] },
    { id: 'description', label: 'Observação', group: 'classification', kinds: ALL, requiredIn: [], hint: 'Entra na descrição', names: ['observacoes', 'observacao', 'obs', 'notas', 'nota', 'comentario'], hintNames: [] },
    { id: 'tags', label: 'Tags', group: 'classification', kinds: ALL, requiredIn: [], hint: 'Separadas por vírgula ou #', names: ['tags', 'tag', 'etiquetas', 'marcadores'], hintNames: [] },
    { id: 'paymentDate', label: 'Data de pagamento', group: 'dates', kinds: ALL, requiredIn: [], hint: 'Vazio ou “-” = pendente', names: ['data de pagamento', 'pagamento', 'pago em', 'data pagamento'], hintNames: ['efetivacao', 'efetivado em', 'liquidacao', 'compensacao'] },
    { id: 'purchaseDate', label: 'Data da compra', group: 'dates', kinds: SINGLE_ACCOUNT, requiredIn: [], hint: 'No cartão, a data da compra', names: ['data da compra', 'data compra', 'compra'], hintNames: ['lancamento', 'data de lancamento'] },
    { id: 'charges', label: 'Encargos', group: 'dates', kinds: WITH_CARD, requiredIn: [], hint: 'Juros e tarifas', names: ['encargos', 'juros', 'tarifas', 'tarifa'], hintNames: [] },
    { id: 'repetition', label: 'Recorrência', group: 'repetition', kinds: ALL, requiredIn: [], hint: 'Fixa / Parcelada / Nenhuma', names: ['recorrencia', 'repeticao', 'frequencia'], hintNames: [] },
    { id: 'installment', label: 'Nº da parcela', group: 'repetition', kinds: ALL, requiredIn: [], hint: null, names: ['parcela', 'n da parcela', 'numero da parcela', 'parcela atual'], hintNames: [] },
    { id: 'installments', label: 'Total de parcelas', group: 'repetition', kinds: ALL, requiredIn: [], hint: null, names: ['parcelas', 'total de parcelas', 'qtd parcelas', 'quantidade de parcelas'], hintNames: [] },
];

/** Ligação de campos a colunas: cada campo a uma coluna (o índice), no máximo. */
export type ColumnMapping = Readonly<Partial<Record<ImportFieldId, number>>>;

/**
 * @param kind Tipo do arquivo.
 * @return Os campos que o tipo tem, na ordem do catálogo.
 */
export function fieldsFor(kind: ImportFileKind): readonly ImportField[] {
    return IMPORT_FIELDS.filter((field) => field.kinds.includes(kind));
}

/**
 * @param id Campo procurado.
 * @return O campo do catálogo.
 * @throws {Error} Quando o id não está no catálogo — só um erro de programação chega aqui, porque
 * o tipo `ImportFieldId` é o próprio catálogo.
 */
export function importField(id: ImportFieldId): ImportField {
    const field = IMPORT_FIELDS.find((item) => item.id === id);
    if (field === undefined) {
        throw new Error(`campo de importação desconhecido: ${id}`);
    }
    return field;
}

/**
 * Normaliza um cabeçalho para comparar com os nomes do catálogo: sem acento, minúsculo e sem
 * símbolos — o app de origem escreve "▲ Origem" e "▼ Destino".
 *
 * @param header Cabeçalho como está no arquivo.
 * @return O cabeçalho comparável.
 */
export function normalizeHeader(header: string): string {
    return normalizeForSearch(header).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Sugere a ligação pelo cabeçalho (o "Sugerir pelo cabeçalho" do mockup). Um campo liga à primeira
 * coluna cujo cabeçalho está na lista dele; a coluna já ligada não recebe outro campo.
 *
 * @param headers Cabeçalhos do arquivo.
 * @param kind Tipo do arquivo.
 * @return A ligação sugerida; vazia num arquivo sem cabeçalho reconhecível.
 */
export function suggestMapping(headers: readonly string[], kind: ImportFileKind): ColumnMapping {
    const normalized = headers.map(normalizeHeader);
    const mapping: Partial<Record<ImportFieldId, number>> = {};
    const taken = new Set<number>();
    for (const field of fieldsFor(kind)) {
        const column = normalized.findIndex((header, index) => !taken.has(index) && field.names.includes(header));
        if (column >= 0) {
            mapping[field.id] = column;
            taken.add(column);
        }
    }
    return mapping;
}

/**
 * Dica para a coluna sem campo com nome ambíguo ("Efetivação" → Data de pagamento).
 *
 * @param header Cabeçalho da coluna.
 * @param kind Tipo do arquivo.
 * @param mapping Ligação atual; o campo já ligado não vira dica.
 * @return O texto da dica, ou `null` sem dica.
 */
export function columnHint(header: string, kind: ImportFileKind, mapping: ColumnMapping): string | null {
    const normalized = normalizeHeader(header);
    const field = fieldsFor(kind).find((item) => item.hintNames.includes(normalized) && mapping[item.id] === undefined);
    return field === undefined ? null : `Parece ser: ${field.label}`;
}

/**
 * Liga um campo a uma coluna. Um campo liga a uma coluna só, e a coluna a um campo só: o campo sai
 * da coluna anterior, e o campo que ocupava a coluna é solto (mockup `DesktopImportMapear`).
 *
 * @param mapping Ligação atual.
 * @param field Campo arrastado ou escolhido.
 * @param column Coluna de destino.
 * @return A nova ligação; a atual não é alterada.
 */
export function assignField(mapping: ColumnMapping, field: ImportFieldId, column: number): ColumnMapping {
    const next = withoutColumn(mapping, column);
    return { ...withoutField(next, field), [field]: column };
}

/**
 * @param mapping Ligação atual.
 * @param column Coluna a soltar (o "✕" da coluna).
 * @return A ligação sem o campo que estava na coluna.
 */
export function withoutColumn(mapping: ColumnMapping, column: number): ColumnMapping {
    const next: Partial<Record<ImportFieldId, number>> = {};
    for (const { id } of IMPORT_FIELDS) {
        const index = mapping[id];
        if (index !== undefined && index !== column) {
            next[id] = index;
        }
    }
    return next;
}

/**
 * @param mapping Ligação atual.
 * @param field Campo a soltar.
 * @return A ligação sem o campo.
 */
export function withoutField(mapping: ColumnMapping, field: ImportFieldId): ColumnMapping {
    const next: Partial<Record<ImportFieldId, number>> = {};
    for (const { id } of IMPORT_FIELDS) {
        const index = mapping[id];
        if (index !== undefined && id !== field) {
            next[id] = index;
        }
    }
    return next;
}

/**
 * @param mapping Ligação atual.
 * @param kind Tipo do arquivo.
 * @return Os campos obrigatórios do tipo que ainda não têm coluna.
 */
export function missingRequired(mapping: ColumnMapping, kind: ImportFileKind): readonly ImportField[] {
    return fieldsFor(kind).filter((field) => field.requiredIn.includes(kind) && mapping[field.id] === undefined);
}

/**
 * @param current Ligação atual.
 * @param suggested Ligação sugerida pelos cabeçalhos.
 * @return A ligação atual completada pelas sugestões que não disputam campo nem coluna — trocar o
 * tipo do arquivo liga os campos novos dele sem desfazer o que o usuário ligou à mão.
 */
export function completeMapping(current: ColumnMapping, suggested: ColumnMapping): ColumnMapping {
    let next = current;
    const taken = new Set(IMPORT_FIELDS.flatMap(({ id }) => (current[id] === undefined ? [] : [current[id]])));
    for (const { id } of IMPORT_FIELDS) {
        const column = suggested[id];
        if (column !== undefined && next[id] === undefined && !taken.has(column)) {
            next = { ...next, [id]: column };
            taken.add(column);
        }
    }
    return next;
}

/**
 * @param mapping Ligação atual.
 * @param kind Tipo do arquivo.
 * @return A ligação só com os campos que o tipo tem — trocar o tipo solta os campos que ele não
 * tem, como "Cartão" ao passar de despesas para receitas.
 */
export function mappingForKind(mapping: ColumnMapping, kind: ImportFileKind): ColumnMapping {
    const next: Partial<Record<ImportFieldId, number>> = {};
    for (const field of fieldsFor(kind)) {
        const index = mapping[field.id];
        if (index !== undefined) {
            next[field.id] = index;
        }
    }
    return next;
}
