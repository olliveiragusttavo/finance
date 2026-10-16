import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { ImportFieldId, ImportFileKind, MappingTemplate } from '@finance/client';
import { z } from 'zod';
import { TEMPLATE_NAME_MAX_LENGTH, type ImportFileResult } from '../shared/bridge.ts';

/**
 * Maior arquivo que a importação lê. O export real de despesas tem 264 KB; o limite só impede que
 * um arquivo escolhido por engano (um vídeo, um backup) seja lido inteiro para a memória e
 * atravesse o IPC.
 */
export const IMPORT_FILE_MAX_BYTES = 20 * 1024 * 1024;

/** Quantos modelos de mapeamento o aparelho guarda; os mais antigos saem primeiro. */
export const IMPORT_TEMPLATES_MAX = 30;

/**
 * Campos que um modelo pode guardar. Repetidos aqui porque o processo principal não carrega o
 * `client` em tempo de execução (só os tipos); o teste confere a lista contra o catálogo, para que
 * um campo novo não se perca ao salvar o modelo.
 */
export const TEMPLATE_FIELD_IDS = [
    'name', 'value', 'dueDate', 'type', 'account', 'creditCard', 'origin', 'destination', 'category',
    'subCategory', 'description', 'tags', 'paymentDate', 'purchaseDate', 'charges', 'repetition',
    'installment', 'installments',
] as const satisfies readonly ImportFieldId[];

/** Tipos de arquivo de um modelo, conferidos contra o catálogo no teste pelo mesmo motivo. */
export const TEMPLATE_FILE_KINDS = ['expenses', 'incomes', 'transfers', 'mixed'] as const satisfies readonly ImportFileKind[];

/** Texto de cabeçalho guardado num modelo. */
const headerText = z.string().max(200);

/**
 * Modelo de mapeamento como o renderer manda e como fica no arquivo de preferências. É estrito
 * porque vem do renderer, entrada não confiável, e limitado para que o arquivo não cresça sem fim.
 */
export const mappingTemplateSchema = z.strictObject({
    name: z.string().trim().min(1).max(TEMPLATE_NAME_MAX_LENGTH),
    kind: z.enum(TEMPLATE_FILE_KINDS),
    headers: z.array(headerText).max(200).readonly(),
    fields: z.partialRecord(z.enum(TEMPLATE_FIELD_IDS), headerText),
});

/**
 * Regra do aparelho (import-design §4): salvar com um nome que já existe substitui o modelo, e o
 * mais novo fica por último — é ele que vale quando dois modelos servem para o mesmo arquivo.
 *
 * @param templates Modelos gravados.
 * @param template Modelo novo, já validado.
 * @return A lista nova, limitada aos mais recentes.
 */
export function withSavedTemplate(templates: readonly MappingTemplate[], template: MappingTemplate): readonly MappingTemplate[] {
    return [...templates.filter((item) => item.name !== template.name), template].slice(-IMPORT_TEMPLATES_MAX);
}

/**
 * Lê o arquivo escolhido no diálogo. Toda falha vira resultado, para que a tela sempre saiba o que
 * dizer, e só o nome-base sai daqui — o caminho nunca chega ao renderer.
 *
 * @param path Caminho escolhido no diálogo do processo principal.
 * @return O nome, o tamanho e os bytes, ou por que não foi lido.
 */
export async function readImportFile(path: string): Promise<ImportFileResult> {
    try {
        const info = await stat(path);
        if (!info.isFile()) {
            return { ok: false, reason: 'read-failed' };
        }
        if (info.size > IMPORT_FILE_MAX_BYTES) {
            return { ok: false, reason: 'too-large' };
        }
        const bytes = await readFile(path);
        return { ok: true, name: basename(path), size: bytes.byteLength, bytes: new Uint8Array(bytes) };
    } catch {
        return { ok: false, reason: 'read-failed' };
    }
}
