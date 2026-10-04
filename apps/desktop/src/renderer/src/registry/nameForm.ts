import { registryNameField } from '@finance/core/requests';
import { issueMessage } from '../lib/formIssues.ts';

/** Resultado da leitura de um nome de cadastro: o nome aparado, ou a mensagem do campo. */
export type NameFormResult = { readonly ok: true; readonly name: string } | { readonly ok: false; readonly error: string };

/**
 * Lê o nome de uma categoria ou subcategoria — os diálogos que só pedem um nome. Valida com o
 * `registryNameField`, o mesmo campo das rotas de categoria, para que o limite de tamanho não
 * seja repetido aqui. A unicidade sem diferenciar maiúsculas não é conferida na tela: só o
 * núcleo vê todos os nomes, e o conflito volta como `CONFLICT` apontando o campo.
 *
 * @param raw Texto do campo.
 * @param label Nome do campo com artigo ("o nome da categoria"), para a frase do campo vazio.
 * @return O nome aparado, como o núcleo o grava, ou a mensagem que aparece abaixo do campo.
 */
export function readNameForm(raw: string, label: string): NameFormResult {
    const parsed = registryNameField.safeParse(raw);
    if (parsed.success) {
        return { ok: true, name: parsed.data };
    }
    const [issue] = parsed.error.issues;
    return { ok: false, error: issue === undefined ? `Confira ${label}.` : issueMessage(issue, { field: 'name', label, kind: 'name' }, '') };
}
