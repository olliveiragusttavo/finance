import { IMPORT_FIELDS, normalizeHeader, type ColumnMapping, type ImportFieldId, type ImportFileKind } from './importFields.ts';

/**
 * Mapeamento salvo como modelo ("Salvar este mapeamento como modelo", mockup
 * `DesktopImportMapear`). Guarda os campos pelo **cabeçalho**, e não pela posição, para que o mesmo
 * export com uma coluna a mais ou em outra ordem continue reconhecido. Fica nas preferências do
 * aparelho (import-design §4).
 */
export interface MappingTemplate {
    readonly name: string;
    readonly kind: ImportFileKind;
    /** Cabeçalhos normalizados do arquivo de onde o modelo saiu, em qualquer ordem. */
    readonly headers: readonly string[];
    /** Campo → cabeçalho normalizado da coluna ligada. */
    readonly fields: Readonly<Partial<Record<ImportFieldId, string>>>;
}

/**
 * @param name Nome dado pelo usuário.
 * @param kind Tipo do arquivo.
 * @param headers Cabeçalhos do arquivo.
 * @param mapping Ligação atual.
 * @return O modelo para gravar.
 */
export function templateFrom(name: string, kind: ImportFileKind, headers: readonly string[], mapping: ColumnMapping): MappingTemplate {
    const fields: Partial<Record<ImportFieldId, string>> = {};
    for (const { id } of IMPORT_FIELDS) {
        const column = mapping[id];
        const header = column === undefined ? undefined : headers[column];
        if (header !== undefined) {
            fields[id] = normalizeHeader(header);
        }
    }
    return { name: name.trim(), kind, headers: headers.map(normalizeHeader), fields };
}

/**
 * Um modelo vale para o arquivo cujos cabeçalhos são os mesmos do arquivo de onde ele saiu, em
 * qualquer ordem — "os cabeçalhos batem" (import-design §4).
 *
 * @param templates Modelos salvos.
 * @param headers Cabeçalhos do arquivo aberto.
 * @return O modelo mais recente que vale para o arquivo, ou `null`.
 */
export function findTemplate(templates: readonly MappingTemplate[], headers: readonly string[]): MappingTemplate | null {
    const current = [...headers.map(normalizeHeader)].sort();
    for (let index = templates.length - 1; index >= 0; index--) {
        const template = templates[index];
        if (template !== undefined && template.headers.length === current.length && [...template.headers].sort().every((header, position) => header === current[position])) {
            return template;
        }
    }
    return null;
}

/**
 * @param template Modelo reconhecido.
 * @param headers Cabeçalhos do arquivo aberto.
 * @return A ligação do modelo nas posições deste arquivo.
 */
export function applyTemplate(template: MappingTemplate, headers: readonly string[]): ColumnMapping {
    const normalized = headers.map(normalizeHeader);
    const mapping: Partial<Record<ImportFieldId, number>> = {};
    for (const { id } of IMPORT_FIELDS) {
        const header = template.fields[id];
        const column = header === undefined ? -1 : normalized.indexOf(header);
        if (column >= 0) {
            mapping[id] = column;
        }
    }
    return mapping;
}

/**
 * Grava o modelo novo no lugar do de mesmo nome, para que salvar de novo atualize em vez de
 * duplicar.
 *
 * @param templates Modelos salvos.
 * @param template Modelo novo.
 * @return A lista nova, com o modelo novo por último (o mais recente vence em `findTemplate`).
 */
export function withTemplate(templates: readonly MappingTemplate[], template: MappingTemplate): readonly MappingTemplate[] {
    return [...templates.filter((item) => item.name !== template.name), template];
}
