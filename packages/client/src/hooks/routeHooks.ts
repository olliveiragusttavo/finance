/*
 * Hooks nomeados das rotas de leitura (desktop-mvp-plan Fase 3.2). São atalhos finos sobre
 * `useCoreQuery`: a tela lê `useStatement(...)` em vez de repetir o nome da rota em texto, e
 * o tipo da entrada e da saída vem do contrato do núcleo. As escritas não têm atalho porque
 * `useCoreMutation('transactions.create')` já diz tudo, e um nome a mais por rota só
 * duplicaria o mapa. `integrity.verifyBalances` também não tem: quem a chama é o shell na
 * abertura, não uma tela.
 */
import type { CoreInput, CoreOutput, InvoiceResponse } from '@finance/core';
import type { UseQueryResult } from '@tanstack/react-query';
import type { CoreCallError } from '../errors/CoreCallError.ts';
import type { ReadRoute } from '../queries/routes.ts';
import { useCoreQueries, useCoreQuery, useCoreRehearsal } from './coreHooks.ts';

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
 * @param input Perfil de onde a transferência sai; `null` deixa a consulta parada.
 * @return As contas de outros perfis com a mesma moeda, destinos possíveis de uma transferência
 * e nomes das contas do outro lado nas transferências entre perfis.
 */
export function useTransferTargets(input: CoreInput<'accounts.transferTargets'> | null): Query<'accounts.transferTargets'> {
    return useCoreQuery('accounts.transferTargets', input);
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
 * @param input Perfil; `null` deixa a consulta parada.
 * @return As tags do perfil, com o uso de cada uma em todo o período.
 */
export function useTags(input: CoreInput<'tags.list'> | null): Query<'tags.list'> {
    return useCoreQuery('tags.list', input);
}

/**
 * @param input Perfil; `null` deixa a consulta parada.
 * @return As anotações do perfil, da editada mais recentemente para a mais antiga.
 */
export function useNotes(input: CoreInput<'notes.list'> | null): Query<'notes.list'> {
    return useCoreQuery('notes.list', input);
}

/**
 * Lista da tela de Metas. O mês de referência faz parte da entrada, e portanto da chave do
 * cache, porque o ritmo e a projeção contam a partir do fim dele (desktop-mvp-plan Fase 9.3):
 * sem ele na chave, navegar pelos meses mostraria o ritmo do mês anterior. Para só listar os
 * nomes, use `useGoalOptions`, que não refaz o progresso.
 *
 * @param input Perfil e mês de referência; `null` deixa a consulta parada, enquanto o perfil
 * ativo ainda não foi escolhido.
 * @return As metas do perfil por nome, com o progresso e o ritmo de cada uma.
 */
export function useGoals(input: CoreInput<'goals.list'> | null): Query<'goals.list'> {
    return useCoreQuery('goals.list', input);
}

/**
 * Opções do campo "Meta" do lançamento. Hook à parte do `useGoals` porque o formulário só
 * precisa de id e nome: sem mês de referência na chave e fora da invalidação por dinheiro, a
 * consulta não se repete a cada troca de mês nem a cada lançamento gravado.
 *
 * @param input Perfil; `null` deixa a consulta parada.
 * @return As metas do perfil por nome, só com id e nome.
 */
export function useGoalOptions(input: CoreInput<'goals.options'> | null): Query<'goals.options'> {
    return useCoreQuery('goals.options', input);
}

/**
 * Tabela "Transações vinculadas" do detalhe. Consulta à parte da lista porque carrega
 * transações inteiras, que só o detalhe mostra; e não depende do mês de referência, porque o que
 * conta no progresso é o que foi pago até hoje (Regra de negócio, Metas).
 *
 * @param input Meta aberta; `null` deixa a consulta parada quando nenhuma meta está aberta.
 * @return As transações que contam no progresso da meta, pelo dia do pagamento.
 */
export function useGoalContributions(input: CoreInput<'goals.contributions'> | null): Query<'goals.contributions'> {
    return useCoreQuery('goals.contributions', input);
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
 * @param input Perfil; `null` deixa a consulta parada.
 * @return As séries vivas do perfil, para a coluna "Rec." e o subtítulo do painel.
 */
export function useRecurrences(input: CoreInput<'recurrences.list'> | null): Query<'recurrences.list'> {
    return useCoreQuery('recurrences.list', input);
}

/**
 * @param input Série; `null` enquanto o diálogo de escopo está fechado.
 * @return As ocorrências vivas da série, que o diálogo conta (pagas, meses afetados).
 */
export function useRecurrenceOccurrences(input: CoreInput<'recurrences.occurrences'> | null): Query<'recurrences.occurrences'> {
    return useCoreQuery('recurrences.occurrences', input);
}

/**
 * @param input Origem, data, valor e repetição; `null` enquanto o formulário não tem os dados.
 * @return As ocorrências que a criação gravaria — a prévia das parcelas.
 */
export function useRecurrencePreview(input: CoreInput<'recurrences.preview'> | null): Query<'recurrences.preview'> {
    return useCoreQuery('recurrences.preview', input);
}

/**
 * @param input Lançamento novo com repetição; `null` enquanto o diálogo de revisão está fechado.
 * @return O que a criação gravaria — as ocorrências que a série lança agora.
 */
export function useCreatePlan(input: CoreInput<'recurrences.planCreate'> | null): Query<'recurrences.planCreate'> {
    return useCoreRehearsal('recurrences.planCreate', input);
}

/**
 * @param input Edição com escopo e série; `null` enquanto o diálogo de revisão está fechado.
 * @return O que a edição faria: as ocorrências excluídas, criadas e alteradas, e as regras.
 */
export function useUpdatePlan(input: CoreInput<'recurrences.planUpdate'> | null): Query<'recurrences.planUpdate'> {
    return useCoreRehearsal('recurrences.planUpdate', input);
}

/**
 * @param input Ocorrência e escopo; `null` enquanto o diálogo de revisão está fechado.
 * @return O que a exclusão faria.
 */
export function useDeletePlan(input: CoreInput<'recurrences.planDelete'> | null): Query<'recurrences.planDelete'> {
    return useCoreRehearsal('recurrences.planDelete', input);
}

/**
 * @param input Conta e mês; `null` deixa a consulta parada.
 * @return O extrato do mês da conta.
 */
export function useStatement(input: CoreInput<'statements.get'> | null): Query<'statements.get'> {
    return useCoreQuery('statements.get', input);
}

/**
 * Faturas do perfil numa rota só, em vez de um `useStatement` por conta: a tabela agrupada de
 * Transações precisa das faturas de todas as contas, e a rota está no grupo `MONEY` de
 * invalidação, para que a linha da fatura acompanhe cada compra gravada no cartão.
 *
 * @param input Perfil e mês; `null` deixa a consulta parada.
 * @return As faturas que pesam no mês nas contas do perfil — a linha da fatura em Transações.
 */
export function useProfileInvoices(input: CoreInput<'statements.profileInvoices'> | null): Query<'statements.profileInvoices'> {
    return useCoreQuery('statements.profileInvoices', input);
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

/** Faturas de vários cartões juntas, e se alguma consulta ainda carrega. */
export interface CardsInvoices {
    readonly invoices: readonly InvoiceResponse[];
    readonly pending: boolean;
}

/**
 * Junta as competências de cada cartão nas faturas que existem. Fica fora do hook para ser
 * estável, o que mantém a identidade do resultado entre renders (`useCoreQueries`).
 *
 * @param results Uma consulta de `invoices.listByCard` por cartão.
 * @return As faturas existentes de todos os cartões e se alguma consulta ainda carrega.
 */
function joinInvoices(results: readonly Query<'invoices.listByCard'>[]): CardsInvoices {
    return {
        invoices: results.flatMap((result) => (result.data ?? []).flatMap((cycle) => (cycle.invoice === null ? [] : [cycle.invoice]))),
        pending: results.some((result) => result.isPending),
    };
}

/**
 * @param inputs Um cartão e a competência inicial por consulta.
 * @return As faturas de todos os cartões a partir da competência pedida de cada um — a tela de
 * Transações lê a situação das faturas em que caíram as compras do mês.
 */
export function useInvoicesByCards(inputs: readonly CoreInput<'invoices.listByCard'>[]): CardsInvoices {
    return useCoreQueries('invoices.listByCard', inputs, joinInvoices);
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
