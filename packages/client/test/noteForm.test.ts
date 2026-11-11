import { describe, expect, it } from 'vitest';
import { filterNotes, noteTitle, readNoteForm } from '../src/forms/noteForm.ts';

describe('formulário e lista de anotações (mockups DesktopAnotacoes e MobileAnotacoes)', () => {
    /**
     * @param id Id da anotação.
     * @param text Texto.
     * @return Uma anotação como `notes.list` a devolve.
     */
    const note = (id: string, text: string): { readonly id: string; readonly profileId: string; readonly text: string } => ({ id, profileId: 'p', text });
    const notes = [note('a', 'IPTU 2027\nCota única vence em fevereiro.'), note('b', 'Reembolsos pendentes\nConferir a tag reembolsável.')];

    it('o editor exige texto, aparado como o núcleo grava; não há limite de tamanho', () => {
        expect(readNoteForm('  \n Lembrete \n')).toEqual({ ok: true, text: 'Lembrete' });
        expect(readNoteForm(' \n ')).toEqual({ ok: false, error: 'Escreva a anotação antes de salvar.' });
        expect(readNoteForm('a'.repeat(20_000)).ok).toBe(true);
    });

    it('a busca procura no texto inteiro, sem diferenciar maiúsculas nem acentos', () => {
        expect(filterNotes(notes, 'fevereiro').map((found) => found.id)).toEqual(['a']);
        expect(filterNotes(notes, 'REEMBOLSAVEL').map((found) => found.id)).toEqual(['b']);
        expect(filterNotes(notes, '  ')).toEqual(notes);
        expect(filterNotes(notes, 'aluguel')).toEqual([]);
    });

    it('o título é a primeira linha', () => {
        expect(notes.map(noteTitle)).toEqual(['IPTU 2027', 'Reembolsos pendentes']);
    });
});
