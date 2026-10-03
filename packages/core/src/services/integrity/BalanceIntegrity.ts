import type { Money } from '../../domain/shared/Money.ts';
import type { AccountId, BankStatementId, InvoiceId } from '../../domain/shared/ids.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';

/**
 * Qual saldo em cache divergiu. Os campos espelham as colunas derivadas do schema — o par
 * da conta, os quatro saldos do extrato e o total da fatura (database-design §3.7) —, para
 * que o log aponte exatamente a coluna a investigar.
 */
export type BalanceField =
    | 'consolidated'
    | 'projected'
    | 'openingConsolidated'
    | 'closingConsolidated'
    | 'openingProjected'
    | 'closingProjected'
    | 'total';

/** Um saldo em cache que a rotina de recálculo não reproduz. */
export interface BalanceDrift {
    /**
     * Conta cuja cadeia contém o desvio; é o que o reparo explícito
     * (`balances.rebuildAccount`) recebe.
     */
    readonly accountId: AccountId;
    readonly subject: 'account' | 'statement' | 'invoice';
    readonly subjectId: AccountId | BankStatementId | InvoiceId;
    /** Competência do extrato ou da fatura; `null` no cache da própria conta. */
    readonly period: YearMonth | null;
    readonly field: BalanceField;
    /** Valor gravado; `null` quando o recálculo precisou abrir um extrato que faltava. */
    readonly cached: Money | null;
    readonly recalculated: Money;
}

/** Resultado da verificação; sem desvios, o banco está coerente com as transações. */
export interface BalanceIntegrityReport {
    /** Quantas contas foram conferidas; distingue "nada a conferir" de "tudo certo". */
    readonly checkedAccounts: number;
    readonly drifts: readonly BalanceDrift[];
}
