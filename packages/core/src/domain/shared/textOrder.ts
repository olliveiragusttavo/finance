/**
 * Letras acentuadas e ligaduras que o comparador de nomes reduz à forma sem acento e em
 * minúscula, agrupadas pela forma de destino. A tabela é própria, e não `normalize('NFD')` nem
 * `localeCompare`, porque as duas dependem do ICU do runtime: o Chromium do desktop e o Hermes
 * do celular ordenariam a mesma lista de jeitos diferentes (mobile-shell-design §8). Cobre o
 * Latin-1 e o Latin Extended-A, que bastam para nomes em português e nas línguas vizinhas; o
 * que fica fora dela é comparado pelo código do caractere.
 */
const FOLDED_LETTERS: readonly (readonly [string, string])[] = [
    ['a', 'àáâãäåāăąÀÁÂÃÄÅĀĂĄ'],
    ['ae', 'æÆ'],
    ['c', 'çćĉċčÇĆĈĊČ'],
    ['d', 'ďđðĎĐÐ'],
    ['e', 'èéêëēĕėęěÈÉÊËĒĔĖĘĚ'],
    ['g', 'ĝğġģĜĞĠĢ'],
    ['h', 'ĥħĤĦ'],
    ['i', 'ìíîïĩīĭįıÌÍÎÏĨĪĬĮİ'],
    ['ij', 'ĳĲ'],
    ['j', 'ĵĴ'],
    ['k', 'ķĶ'],
    ['l', 'ĺļľŀłĹĻĽĿŁ'],
    ['n', 'ñńņňŉÑŃŅŇ'],
    ['o', 'òóôõöøōŏőÒÓÔÕÖØŌŎŐ'],
    ['oe', 'œŒ'],
    ['r', 'ŕŗřŔŖŘ'],
    ['s', 'śŝşšſŚŜŞŠ'],
    ['ss', 'ß'],
    ['t', 'ţťŧŢŤŦ'],
    ['th', 'þÞ'],
    ['u', 'ùúûüũūŭůűųÙÚÛÜŨŪŬŮŰŲ'],
    ['w', 'ŵŴ'],
    ['y', 'ýÿŷÝŸŶ'],
    ['z', 'źżžŹŻŽ'],
];

/**
 * Índice da `FOLDED_LETTERS` por caractere, montado uma vez no carregamento do módulo para que
 * cada comparação faça só consultas a um `Map`, e não varra a tabela.
 */
const FOLD_TABLE: ReadonlyMap<string, string> = new Map(
    // Toda letra da tabela está no plano básico (um código UTF-16 cada), então percorrer por
    // unidade não parte nenhum caractere.
    FOLDED_LETTERS.flatMap(([folded, letters]) => Array.from(letters, (letter): [string, string] => [letter, folded])),
);

/** Início do bloco de acentos combinantes (U+0300), que um nome decomposto traz depois da letra. */
const COMBINING_MARKS_START = 0x0300;

/** Fim do bloco de acentos combinantes (U+036F). */
const COMBINING_MARKS_END = 0x036f;

/**
 * Reduz um nome à chave de ordenação: sem acento, em minúscula e sem espaços nas pontas.
 * A caixa do ASCII é dobrada à mão, e não por `toLowerCase`, para que todo o mapeamento venha
 * de código do núcleo e não da tabela Unicode embutida em cada runtime. Os acentos combinantes
 * são descartados para que "é" composto e "e" + acento decomposto caiam na mesma chave sem
 * depender de `normalize`, que no Hermes exige o ICU.
 *
 * @param name Nome como está gravado.
 * @return A chave usada só para comparar; nunca é exibida nem gravada.
 */
export function nameSortKey(name: string): string {
    let key = '';
    for (const character of name.trim()) {
        const code = character.charCodeAt(0);
        if (code >= COMBINING_MARKS_START && code <= COMBINING_MARKS_END) {
            continue;
        }
        if (code >= 0x41 && code <= 0x5a) {
            key += String.fromCharCode(code + 0x20);
            continue;
        }
        key += FOLD_TABLE.get(character) ?? character;
    }
    return key;
}

/**
 * Compara dois textos pelo código de cada unidade UTF-16, sem localidade. Serve às chaves
 * técnicas (ids, chaves de vínculo) e ao desempate dos nomes, em que a ordem só precisa ser
 * total e igual em todo runtime, sem significado para o usuário.
 *
 * @param a Primeiro texto.
 * @param b Segundo texto.
 * @return Negativo, zero ou positivo, como espera o `sort`.
 */
export function compareCodeUnits(a: string, b: string): number {
    if (a === b) {
        return 0;
    }
    return a < b ? -1 : 1;
}

/**
 * Ordena nomes de cadastro e de lançamento como o usuário espera ler uma lista em português:
 * ignorando acento e caixa, de modo que "Água" venha antes de "Bebida" e "ônibus" fique junto
 * de "Ótica". Substitui o `localeCompare('pt-BR')`, cujo resultado muda com o ICU do runtime
 * (mobile-shell-design §8). Nomes que só diferem em acento ou caixa desempatam pelo texto
 * original, para a ordem ser total; o desempate final por id fica com quem chama, porque só
 * ele conhece o id.
 *
 * @param a Primeiro nome.
 * @param b Segundo nome.
 * @return Negativo, zero ou positivo, como espera o `sort`.
 */
export function compareNames(a: string, b: string): number {
    return compareCodeUnits(nameSortKey(a), nameSortKey(b)) || compareCodeUnits(a, b);
}
