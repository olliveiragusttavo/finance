import { summarizeNote } from '@finance/client';
import type { NoteResponse } from '@finance/core';
import { noteTextField } from '@finance/core/requests';

/** Resultado da leitura do editor: o texto aparado, ou a mensagem do campo. */
export type NoteFormResult = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string };

/**
 * Lê o editor de anotação com o `noteTextField`, o mesmo campo das rotas de anotação. Só há
 * uma regra — não pode ficar vazia —, e ela vem do schema para que a tela e o núcleo nunca
 * discordem; não há limite de tamanho (database-design §4.3).
 *
 * @param raw Texto do editor.
 * @return O texto aparado, como o núcleo o grava, ou a mensagem que aparece abaixo do editor.
 */
export function readNoteForm(raw: string): NoteFormResult {
    const parsed = noteTextField.safeParse(raw);
    return parsed.success ? { ok: true, text: parsed.data } : { ok: false, error: 'Escreva a anotação antes de salvar.' };
}

/**
 * @param text Texto a reduzir.
 * @return O texto em minúsculas e sem acentos, só para comparar: quem procura "iptu" ou
 * "reembolsavel" espera achar "IPTU" e "reembolsável".
 */
function foldForSearch(text: string): string {
    return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * Filtra a lista pela busca do mockup ("texto da anotação…"). Procura no texto inteiro, e
 * não só no título, porque o que se lembra de uma anotação costuma estar no corpo. Fica na
 * tela, e não numa rota, porque a lista de um perfil é curta e já está em cache.
 *
 * @param notes Anotações do perfil, na ordem do núcleo.
 * @param query Texto da busca.
 * @return As anotações que contêm o texto, na mesma ordem; todas quando a busca está vazia.
 */
export function filterNotes(notes: readonly NoteResponse[], query: string): readonly NoteResponse[] {
    const needle = foldForSearch(query.trim());
    if (needle === '') {
        return notes;
    }
    return notes.filter((note) => foldForSearch(note.text).includes(needle));
}

/**
 * @param note Anotação.
 * @return O título da anotação, a primeira linha, para rótulos e confirmações.
 */
export function noteTitle(note: NoteResponse): string {
    return summarizeNote(note.text).title;
}
