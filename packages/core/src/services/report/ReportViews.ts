import type { BalanceEvolutionPoint } from '../../domain/report/BalanceEvolution.ts';
import type { CategoryScope } from '../../domain/report/CategoryScope.ts';
import type { Money } from '../../domain/shared/Money.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';
import type { Transaction } from '../../domain/transaction/Transaction.ts';

/**
 * A lista de lançamentos do drill-down. Fica fora do arquivo do `ReportService` para que a
 * camada DTO dependa só do contrato de saída.
 */
export interface CategoryTransactionsView {
    readonly period: YearMonth;
    readonly scope: CategoryScope;
    readonly transactions: readonly Transaction[];
    /** Soma pela mesma regra da linha do relatório, para a tela conferir com a árvore. */
    readonly total: Money;
}

/** A série de saldos do perfil até o mês de referência. */
export interface BalanceEvolutionView {
    readonly reference: YearMonth;
    readonly points: readonly BalanceEvolutionPoint[];
}
