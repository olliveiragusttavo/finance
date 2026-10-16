import type { BalanceDrift, BalanceIntegrityReport } from '../../services/integrity/BalanceIntegrity.ts';
import { toMoneyResponse, type MoneyResponse } from '../shared/MoneyResponse.ts';

/** Um saldo em cache que diverge do recalculado, como vai para o log do shell. */
export interface BalanceDriftResponse {
    readonly accountId: string;
    readonly subject: BalanceDrift['subject'];
    readonly subjectId: string;
    readonly period: string | null;
    readonly field: BalanceDrift['field'];
    readonly cached: MoneyResponse | null;
    readonly recalculated: MoneyResponse;
}

/** Resultado da verificação de integridade da abertura. */
export interface IntegrityReportResponse {
    readonly checkedAccounts: number;
    readonly drifts: readonly BalanceDriftResponse[];
}

/**
 * O relatório vira dado simples porque é registrado em log pelo processo que hospeda o
 * núcleo e pode cruzar o IPC; com `Money` e `YearMonth` ele chegaria sem valor legível.
 *
 * @param report Resultado do Service; fonte das contas conferidas e dos desvios.
 * @return O relatório serializável, com valores arredondados na precisão da moeda.
 */
export function toIntegrityReportResponse(report: BalanceIntegrityReport): IntegrityReportResponse {
    return {
        checkedAccounts: report.checkedAccounts,
        drifts: report.drifts.map((drift) => ({
            accountId: drift.accountId,
            subject: drift.subject,
            subjectId: drift.subjectId,
            period: drift.period?.toString() ?? null,
            field: drift.field,
            cached: drift.cached === null ? null : toMoneyResponse(drift.cached),
            recalculated: toMoneyResponse(drift.recalculated),
        })),
    };
}
