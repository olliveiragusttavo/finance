import { REGISTRY_LIST_VIEWS, registryInView, registryViewOf, type RegistryListView } from '@finance/client';
import type { AccountListResponse } from '@finance/core';
import { z } from 'zod';

/*
 * Conta aberta na tela Contas (mockup `DesktopContas`; desktop-mvp-plan Fase 7). Fica na URL
 * como *search param* `account`, e não num estado do React, para que voltar no histórico
 * devolva o extrato que estava aberto e para que outra tela possa levar direto a uma conta. A
 * visualização da lista (ativas ou desativadas, desktop-mvp-plan Fase 13.4) fica em `view`.
 */

/** Parâmetros de busca próprios da tela Contas. */
export interface AccountsSearch {
    /** Conta aberta; ausente abre a primeira da lista. */
    readonly account?: string;
    /** Visualização da lista; ausente segue a conta pedida, ou mostra as ativas. */
    readonly view?: RegistryListView;
}

/** Ids do núcleo são UUIDs; outro texto nunca é uma conta. */
const accountSchema = z.uuid();

/**
 * Valida a busca da URL. Cada parâmetro malformado (URL editada) é descartado sozinho em vez de
 * derrubar a rota: a tela abre a primeira conta, ou a lista das ativas.
 *
 * @param search Busca crua, como o roteador a leu.
 * @return Só os parâmetros com formato válido.
 */
export function parseAccountsSearch(search: Readonly<Record<string, unknown>>): AccountsSearch {
    const account = accountSchema.safeParse(search['account']);
    const view = z.enum(REGISTRY_LIST_VIEWS).safeParse(search['view']);
    return { ...(account.success ? { account: account.data } : {}), ...(view.success ? { view: view.data } : {}) };
}

/**
 * Contas da lista lateral na visualização da URL. Sem `view`, a conta pedida decide: o link para
 * uma conta desativada ("Ver extrato da conta" de uma meta) abre a lista das desativadas, em vez
 * de uma lista em que ela não aparece.
 *
 * @param list Contas do perfil no mês.
 * @param search Busca já validada.
 * @return A visualização e as contas dela, na ordem do núcleo.
 */
export function accountListView(list: AccountListResponse, search: AccountsSearch): { readonly view: RegistryListView; readonly accounts: AccountListResponse['accounts'] } {
    const requested = list.accounts.find((account) => account.id === search.account);
    const view = search.view ?? (requested === undefined ? 'active' : registryViewOf(requested));
    return { view, accounts: list.accounts.filter((account) => registryInView(account, view)) };
}

/**
 * Conta cujo extrato a tela mostra. A conta da URL pode não existir mais — excluída aqui
 * mesmo, ou em outro perfil depois da troca — ou não estar na visualização escolhida, e então
 * vale a primeira da lista, para que a tela nunca fique num extrato de "não encontrado".
 *
 * @param list Contas do perfil no mês.
 * @param search Busca já validada.
 * @return A conta da URL, ou a primeira da visualização; `null` quando ela está vazia.
 */
export function openAccount(list: AccountListResponse, search: AccountsSearch): AccountListResponse['accounts'][number] | null {
    const { accounts } = accountListView(list, search);
    return accounts.find((account) => account.id === search.account) ?? accounts[0] ?? null;
}
