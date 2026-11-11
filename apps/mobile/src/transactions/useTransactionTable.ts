import {
    buildTransactionTable,
    type CoreCallError,
    useAccounts,
    useCategoryTree,
    useCreditCards,
    useMonthInvoices,
    useProfileInvoices,
    useRecurrences,
    useTransactions,
    useTransferTargets,
    type TransactionFilters,
    type TransactionTable,
} from '@finance/client';
import { useMemo } from 'react';

/** A tabela do mês e o estado das consultas que a alimentam. */
export interface TransactionTableState {
    /** `null` enquanto alguma consulta carrega ou falhou. */
    readonly table: TransactionTable | null;
    /** A primeira falha, para a tela mostrar com "Tentar de novo". */
    readonly error: CoreCallError | null;
    /** Refaz as consultas que falharam. */
    readonly refetch: () => void;
}

/**
 * Monta a tabela de Transações do mês com as mesmas consultas e o mesmo `buildTransactionTable`
 * do desktop — lançamentos, contas, contas de outros perfis, cartões, categorias, séries, faturas
 * das compras e faturas que pesam no mês —, para que a lista do celular, o agrupamento das compras
 * do cartão na linha da fatura e o resultado sejam os mesmos (mobile-mvp-plan §5.1).
 *
 * @param profileId Perfil ativo.
 * @param period Mês de referência.
 * @param filters Filtros escolhidos; qualquer filtro desfaz o agrupamento das faturas.
 * @return A tabela, ou o estado de carregamento e de erro.
 */
export function useTransactionTable(profileId: string, period: string, filters: TransactionFilters): TransactionTableState {
    const transactions = useTransactions({ profileId, period });
    const accounts = useAccounts({ profileId, period });
    const otherProfileAccounts = useTransferTargets({ profileId });
    const creditCards = useCreditCards({ profileId, period });
    const categories = useCategoryTree({ profileId });
    const recurrences = useRecurrences({ profileId });
    const monthInvoices = useProfileInvoices({ profileId, period });
    const invoices = useMonthInvoices(transactions.data);

    const table = useMemo(
        () =>
            transactions.data === undefined || accounts.data === undefined || otherProfileAccounts.data === undefined || creditCards.data === undefined || categories.data === undefined || monthInvoices.data === undefined
                ? null
                : buildTransactionTable(
                      {
                          profileId,
                          transactions: transactions.data,
                          accounts: accounts.data.accounts,
                          otherProfileAccounts: otherProfileAccounts.data,
                          creditCards: creditCards.data.creditCards,
                          categories: categories.data,
                          invoices,
                          recurrences: recurrences.data ?? [],
                          monthInvoices: monthInvoices.data,
                      },
                      filters,
                  ),
        [profileId, transactions.data, accounts.data, otherProfileAccounts.data, creditCards.data, categories.data, invoices, recurrences.data, monthInvoices.data, filters],
    );
    const queries = [transactions, accounts, otherProfileAccounts, creditCards, categories, monthInvoices];
    return {
        table,
        error: queries.find((query) => query.error !== null)?.error ?? null,
        refetch: () => {
            for (const query of queries) {
                if (query.error !== null) {
                    void query.refetch();
                }
            }
        },
    };
}
