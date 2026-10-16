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

/** Tipo da conta por extenso, como abre o cabeçalho do extrato ("Conta corrente · …"). */
const ACCOUNT_TYPE_HEADINGS: Readonly<Record<AccountResponse['type'], string>> = {
    checking: 'Conta corrente',
    investment: 'Conta de investimentos',
};

/**
 * Linha acima do nome no extrato da conta (mockup `DesktopContas`). Diz se a conta entra no
 * saldo total porque é isso que explica por que o saldo dela soma ou não no rodapé da lista.
 *
 * @param account Tipo, se entra no total e se está desativada.
 * @return `Conta corrente · entra no saldo total`, com `· desativada` quando for o caso.
 */
export function formatAccountHeading(account: Pick<AccountResponse, 'type' | 'considerBalance' | 'disabled'>): string {
    const parts = [ACCOUNT_TYPE_HEADINGS[account.type], account.considerBalance ? 'entra no saldo total' : 'fora do saldo total'];
    return (account.disabled ? [...parts, 'desativada'] : parts).join(' · ');
}
