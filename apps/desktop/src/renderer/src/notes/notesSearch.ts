import { z } from 'zod';

/*
 * Anotação pedida pela URL na tela Anotações. Fica como *search param* `note`, e não num estado do
 * React, para que outras telas levem direto a uma anotação — a lista de anotações da Visão geral
 * (desktop-mvp-plan Fase 13.2) — e para que voltar no histórico devolva o pedido.
 */

/** Parâmetros de busca próprios da tela Anotações. */
export interface NotesSearch {
    /** Anotação a abrir no editor; ausente abre a tela sem nenhuma aberta. */
    readonly note?: string;
}

/** Id da anotação pedida: qualquer texto não vazio; a que não existe mais só não abre. */
const noteSchema = z.string().min(1);

/**
 * Valida a busca da URL. O pedido malformado (URL editada, histórico antigo) é descartado em vez
 * de derrubar a rota: a tela abre sem anotação no editor.
 *
 * @param search Busca crua, como o roteador a leu.
 * @return A anotação pedida, quando o parâmetro é válido.
 */
export function parseNotesSearch(search: Readonly<Record<string, unknown>>): NotesSearch {
    const note = noteSchema.safeParse(search['note']);
    return note.success ? { note: note.data } : {};
}
