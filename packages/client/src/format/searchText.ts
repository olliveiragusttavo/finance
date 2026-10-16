/*
 * Busca em texto livre das telas (Transações, subcategoria do lançamento). Num lugar só para
 * que toda caixa de busca do app ache as mesmas coisas pelo mesmo critério.
 */

/**
 * Normaliza para comparar sem diferenciar maiúsculas nem acentos: quem digita "cafe" procura
 * "Café", e o teclado do celular nem sempre facilita o acento.
 *
 * @param text Texto livre.
 * @return O texto minúsculo e sem diacríticos.
 */
export function normalizeForSearch(text: string): string {
    return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * Cada palavra digitada precisa aparecer em algum ponto do texto, em qualquer ordem: "mercado
 * alim" acha "Alimentação › Mercado". Busca vazia casa com tudo, para a lista inteira aparecer
 * antes de o usuário digitar.
 *
 * @param query Texto digitado na busca.
 * @param haystack Texto onde procurar.
 * @return `true` quando todo termo da busca aparece no texto.
 */
export function matchesAllTerms(query: string, haystack: string): boolean {
    const terms = normalizeForSearch(query).split(/\s+/).filter((term) => term !== '');
    const normalized = normalizeForSearch(haystack);
    return terms.every((term) => normalized.includes(term));
}
