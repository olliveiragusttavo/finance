import type { AccountResponse } from '@finance/core';

/**
 * Nome de cada tipo de conta como os mockups o escrevem. `Record` sobre a união do núcleo:
 * um tipo novo quebra a compilação aqui em vez de aparecer na tela como `checking`.
 */
const ACCOUNT_TYPE_LABELS: Readonly<Record<AccountResponse['type'], string>> = {
    checking: 'Corrente',
    investment: 'Investimentos',
};

/**
 * @param type Tipo da conta, como vem do núcleo.
 * @return O tipo em pt-BR, `Corrente` ou `Investimentos`.
 */
export function formatAccountType(type: AccountResponse['type']): string {
    return ACCOUNT_TYPE_LABELS[type];
}
