import { z } from 'zod';

/*
 * Conta escolhida no fluxo por conta (mockup `DesktopRelFluxo`; desktop-mvp-plan Fase 12.1). Fica
 * na URL como *search param* `account`, como a conta aberta em Contas, para que voltar no
 * histórico devolva o fluxo que estava aberto.
 */

/** Valor de `account` que escolhe "Todas as contas do total" (F4). */
export const ALL_ACCOUNTS = 'total';

/** Parâmetros de busca próprios do fluxo por conta. */
export interface AccountFlowSearch {
    /** Conta escolhida, ou `total`; ausente abre a primeira conta, como no mockup. */
    readonly account?: string;
}

/** Uma conta (UUID do núcleo) ou a soma das contas do total. */
const accountSchema = z.union([z.uuid(), z.literal(ALL_ACCOUNTS)]);

/** O que o relatório mostra: uma conta ou a soma das do total. */
export type AccountFlowChoice = { readonly kind: 'account'; readonly accountId: string } | { readonly kind: 'total' };

/**
 * Valida a busca da URL. Um valor malformado (URL editada) é descartado em vez de derrubar a
 * rota: a tela abre a primeira conta.
 *
 * @param search Busca crua, como o roteador a leu.
 * @return Só a conta, quando tem o formato certo.
 */
export function parseAccountFlowSearch(search: Readonly<Record<string, unknown>>): AccountFlowSearch {
    const parsed = accountSchema.safeParse(search['account']);
    return parsed.success ? { account: parsed.data } : {};
}

/**
 * O que o relatório mostra. A conta da URL pode não existir mais — excluída, ou de outro perfil
 * depois da troca —, e então vale a primeira, como em Contas, para que a tela nunca fique num
 * relatório de "não encontrado".
 *
 * @param accounts Contas do perfil, na ordem da lista.
 * @param search Busca já validada.
 * @return A conta da URL, a soma das do total, ou a primeira conta; `null` quando o perfil não
 * tem conta.
 */
export function chooseAccountFlow(accounts: readonly { readonly id: string }[], search: AccountFlowSearch): AccountFlowChoice | null {
    if (search.account === ALL_ACCOUNTS) {
        return { kind: 'total' };
    }
    const account = accounts.find((candidate) => candidate.id === search.account) ?? accounts[0];
    return account === undefined ? null : { kind: 'account', accountId: account.id };
}
