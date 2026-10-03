/*
 * Hooks nomeados das rotas de leitura (desktop-mvp-plan Fase 3.2). São atalhos finos sobre
 * `useCoreQuery`: a tela lê `useStatement(...)` em vez de repetir o nome da rota em texto, e
 * o tipo da entrada e da saída vem do contrato do núcleo. As escritas não têm atalho porque
 * `useCoreMutation('transactions.create')` já diz tudo, e um nome a mais por rota só
 * duplicaria o mapa. `integrity.verifyBalances` também não tem: quem a chama é o shell na
 * abertura, não uma tela.
 */
import type { CoreInput, CoreOutput } from '@finance/core';
import type { UseQueryResult } from '@tanstack/react-query';
import type { CoreCallError } from '../errors/CoreCallError.ts';
import type { ReadRoute } from '../queries/routes.ts';
import { useCoreQuery } from './coreHooks.ts';

/** Estado de uma consulta de rota, com o erro tipado. */
type Query<R extends ReadRoute> = UseQueryResult<CoreOutput<R>, CoreCallError>;

/**
 * @param input Entrada da rota, ou `null` para deixar a consulta parada.
 * @return Os perfis, para o seletor de perfil e o primeiro uso.
 */
export function useProfiles(input: CoreInput<'profiles.list'> | null): Query<'profiles.list'> {
    return useCoreQuery('profiles.list', input);
}

/**
 * @param input Perfil e mês; `null` deixa a consulta parada.
 * @return As contas com consolidado e previsto do mês e o total.
 */
export function useAccounts(input: CoreInput<'accounts.list'> | null): Query<'accounts.list'> {
    return useCoreQuery('accounts.list', input);
}

/**
 * @param input Conta a excluir; `null` enquanto o alerta está fechado.
 * @return O que a exclusão apaga junto e as outras contas cujo saldo muda.
 */
export function useAccountDeletionImpact(input: CoreInput<'accounts.deletionImpact'> | null): Query<'accounts.deletionImpact'> {
    return useCoreQuery('accounts.deletionImpact', input);
}

/**
 * @param input Perfil e mês; `null` deixa a consulta parada.
 * @return Os cartões com a fatura do mês e o limite usado.
 */
export function useCreditCards(input: CoreInput<'creditCards.list'> | null): Query<'creditCards.list'> {
    return useCoreQuery('creditCards.list', input);
}

/**
 * @param input Cartão a excluir; `null` enquanto o alerta está fechado.
 * @return O que a exclusão apaga junto e as contas cujo saldo muda.
 */
export function useCreditCardDeletionImpact(input: CoreInput<'creditCards.deletionImpact'> | null): Query<'creditCards.deletionImpact'> {
    return useCoreQuery('creditCards.deletionImpact', input);
}

/**
 * @param input Perfil; `null` deixa a consulta parada.
 * @return A árvore de categorias com a contagem de lançamentos.
 */
export function useCategoryTree(input: CoreInput<'categories.tree'> | null): Query<'categories.tree'> {
    return useCoreQuery('categories.tree', input);
}

/**
 * @param input Transação; `null` enquanto o painel de edição está fechado.
 * @return A transação para o formulário de edição.
 */
export function useTransaction(input: CoreInput<'transactions.get'> | null): Query<'transactions.get'> {
    return useCoreQuery('transactions.get', input);
}

/**
 * @param input Perfil e mês; `null` deixa a consulta parada.
 * @return As transações do mês pelo vencimento, para a tela de Transações.
 */
export function useTransactions(input: CoreInput<'transactions.listByPeriod'> | null): Query<'transactions.listByPeriod'> {
    return useCoreQuery('transactions.listByPeriod', input);
}

/**
 * @param input Conta e mês; `null` deixa a consulta parada.
 * @return O extrato do mês da conta.
 */
export function useStatement(input: CoreInput<'statements.get'> | null): Query<'statements.get'> {
    return useCoreQuery('statements.get', input);
}

/**
 * @param input Perfil; `null` deixa a consulta parada.
 * @return Os saldos atuais de todas as contas e o total.
 */
export function useProfileBalances(input: CoreInput<'balances.ofProfile'> | null): Query<'balances.ofProfile'> {
    return useCoreQuery('balances.ofProfile', input);
}

/**
 * @param input Cartão e data da compra; `null` enquanto o formulário não tem os dois.
 * @return A fatura em que a compra cai.
 */
export function useInvoiceSuggestion(input: CoreInput<'invoices.suggest'> | null): Query<'invoices.suggest'> {
    return useCoreQuery('invoices.suggest', input);
}

/**
 * @param input Fatura; `null` deixa a consulta parada.
 * @return O detalhe da fatura com os lançamentos.
 */
export function useInvoice(input: CoreInput<'invoices.get'> | null): Query<'invoices.get'> {
    return useCoreQuery('invoices.get', input);
}

/**
 * @param input Cartão e mês; `null` deixa a consulta parada.
 * @return A fatura do mês e as próximas do cartão.
 */
export function useInvoicesByCard(input: CoreInput<'invoices.listByCard'> | null): Query<'invoices.listByCard'> {
    return useCoreQuery('invoices.listByCard', input);
}

/**
 * @param input Perfil e mês; `null` deixa a consulta parada.
 * @return Os indicadores da Visão geral.
 */
export function useMonthSummary(input: CoreInput<'reports.monthSummary'> | null): Query<'reports.monthSummary'> {
    return useCoreQuery('reports.monthSummary', input);
}

/**
 * @param input Perfil, mês e quantidade de meses; `null` deixa a consulta parada.
 * @return A evolução do saldo consolidado e previsto.
 */
export function useBalanceEvolution(input: CoreInput<'reports.balanceEvolution'> | null): Query<'reports.balanceEvolution'> {
    return useCoreQuery('reports.balanceEvolution', input);
}

/**
 * @param input Perfil, mês e modo de comparação; `null` deixa a consulta parada.
 * @return O relatório por categoria.
 */
export function useCategoryReport(input: CoreInput<'reports.byCategory'> | null): Query<'reports.byCategory'> {
    return useCoreQuery('reports.byCategory', input);
}

/**
 * @param input Perfil, mês e categoria ou subcategoria; `null` sem nada selecionado.
 * @return Os lançamentos do drill-down, pelo mês do pagamento.
 */
export function useCategoryTransactions(input: CoreInput<'reports.categoryTransactions'> | null): Query<'reports.categoryTransactions'> {
    return useCoreQuery('reports.categoryTransactions', input);
}

/**
 * @param input Perfil e mês; `null` deixa a consulta parada.
 * @return O impacto do cartão.
 */
export function useCardImpact(input: CoreInput<'reports.cardImpact'> | null): Query<'reports.cardImpact'> {
    return useCoreQuery('reports.cardImpact', input);
}
