/** Como uma anotação aparece na lista: título e a prévia do resto do texto. */
export interface NoteSummary {
    readonly title: string;
    /** O resto do texto numa linha só; vazio quando a anotação tem uma linha. */
    readonly preview: string;
}

/**
 * Separa título e prévia de uma anotação. Regra de interface (mockups, decisão 9): anotação
 * é texto livre, e a primeira linha é usada como título na lista — não existe campo de título,
 * então ele nunca discorda do texto. A prévia junta as linhas seguintes com espaço, porque a
 * lista mostra uma ou duas linhas cortadas e quebras de linha ali só desperdiçariam espaço.
 * Fica no `client` para que desktop e celular mostrem a mesma lista.
 *
 * @param text Texto da anotação, como o núcleo o grava (já aparado nas pontas).
 * @return O título e a prévia.
 */
export function summarizeNote(text: string): NoteSummary {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
    const [title = '', ...rest] = lines;
    return { title, preview: rest.join(' ') };
}
