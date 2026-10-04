/** Moeda oferecida nos formulários: o código que o núcleo grava e o rótulo da lista. */
export interface CurrencyOption {
    readonly code: string;
    readonly label: string;
}

/** Moedas oferecidas nos formulários, as do mockup do primeiro uso. */
export const CURRENCY_OPTIONS: readonly CurrencyOption[] = [
    { code: 'BRL', label: 'BRL — Real' },
    { code: 'USD', label: 'USD — Dólar' },
];

/**
 * Lista de moedas de um formulário de edição. O cadastro pode ter uma moeda fora da lista
 * (gravada por outro aparelho ou por uma versão futura); sem ela entre as opções, a lista
 * apareceria vazia e o usuário trocaria a moeda sem perceber ao salvar outro campo.
 *
 * Num cadastro novo que já vem com uma moeda proposta (a do perfil, na conta), ela entra pelo
 * mesmo motivo: fora da lista, o campo apareceria vazio e ela não poderia ser escolhida.
 *
 * @param current Moeda gravada no cadastro ou proposta para o cadastro novo, ou `null` quando
 * o cadastro novo não propõe nenhuma.
 * @return As moedas padrão e, quando ela não está entre elas, a do cadastro.
 */
export function currencyOptionsWith(current: string | null): readonly CurrencyOption[] {
    if (current === null || CURRENCY_OPTIONS.some((option) => option.code === current)) {
        return CURRENCY_OPTIONS;
    }
    return [...CURRENCY_OPTIONS, { code: current, label: current }];
}
