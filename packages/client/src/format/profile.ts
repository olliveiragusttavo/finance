import type { ProfileResponse } from '@finance/core';

/**
 * Nome de cada tipo de perfil como os mockups o escrevem. `Record` sobre a união do núcleo:
 * um tipo novo quebra a compilação aqui em vez de aparecer na tela como `business`.
 */
const PROFILE_TYPE_LABELS: Readonly<Record<ProfileResponse['type'], string>> = {
    personal: 'Pessoal',
    business: 'Empresarial',
};

/**
 * @param type Tipo do perfil, como vem do núcleo.
 * @return O tipo em pt-BR, `Pessoal` ou `Empresarial`.
 */
export function formatProfileType(type: ProfileResponse['type']): string {
    return PROFILE_TYPE_LABELS[type];
}

/**
 * Linha de apoio do seletor de perfil (`Pessoal · BRL`). Tipo e moeda andam juntos porque são
 * o que distingue dois perfis de nome parecido e o que muda o que a tela mostra: "Por sócio"
 * só existe no empresarial, e todo valor está na moeda do perfil.
 *
 * @param profile Perfil a descrever.
 * @return O tipo e a moeda separados por ponto médio.
 */
export function formatProfileSummary(profile: Pick<ProfileResponse, 'type' | 'currency'>): string {
    return `${formatProfileType(profile.type)} · ${profile.currency}`;
}
