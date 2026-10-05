import type { AccountListResponse } from '@finance/core';
import { z } from 'zod';

/*
 * Conta aberta na tela Contas (mockup `DesktopContas`; desktop-mvp-plan Fase 7). Fica na URL
 * como *search param* `account`, e não num estado do React, para que voltar no histórico
 * devolva o extrato que estava aberto e para que outra tela possa levar direto a uma conta.
 */

/** Parâmetros de busca próprios da tela Contas. */
export interface AccountsSearch {
    /** Conta aberta; ausente abre a primeira da lista. */
    readonly account?: string;
}

/** Ids do núcleo são UUIDs; outro texto nunca é uma conta. */
const accountSchema = z.uuid();

/**
 * Valida a busca da URL. Um id malformado (URL editada) é descartado em vez de derrubar a
 * rota: a tela abre a primeira conta.
 *
 * @param search Busca crua, como o roteador a leu.
 * @return Só a conta, quando o id tem o formato certo.
 */
export function parseAccountsSearch(search: Readonly<Record<string, unknown>>): AccountsSearch {
    const parsed = accountSchema.safeParse(search['account']);
    return parsed.success ? { account: parsed.data } : {};
}

/**
 * Conta cujo extrato a tela mostra. A conta da URL pode não existir mais — excluída aqui
 * mesmo, ou em outro perfil depois da troca —, e então vale a primeira, para que a tela nunca
 * fique num extrato de "não encontrado".
 *
 * @param list Contas do perfil no mês.
 * @param search Busca já validada.
 * @return A conta da URL, ou a primeira da lista; `null` quando o perfil não tem conta.
 */
export function openAccount(list: AccountListResponse, search: AccountsSearch): AccountListResponse['accounts'][number] | null {
    return list.accounts.find((account) => account.id === search.account) ?? list.accounts[0] ?? null;
}
