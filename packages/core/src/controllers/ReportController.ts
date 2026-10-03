import { toBalanceEvolutionResponse, type BalanceEvolutionResponse } from '../dto/reports/BalanceEvolutionResponse.ts';
import { toCardImpactResponse, type CardImpactResponse } from '../dto/reports/CardImpactResponse.ts';
import { toCategoryReportResponse, type CategoryReportResponse } from '../dto/reports/CategoryReportResponse.ts';
import { toCategoryTransactionsResponse, type CategoryTransactionsResponse } from '../dto/reports/CategoryTransactionsResponse.ts';
import { toMonthSummaryResponse, type MonthSummaryResponse } from '../dto/reports/MonthSummaryResponse.ts';
import {
    balanceEvolutionRequest,
    cardImpactRequest,
    categoryReportRequest,
    categoryTransactionsRequest,
    monthSummaryRequest,
} from '../requests/reportRequests.ts';
import type { ReportService } from '../services/report/ReportService.ts';
import { handle, type CoreResult, type UnexpectedErrorListener } from './CoreResult.ts';

/** Rotas dos relatórios: Visão geral, por categoria e impacto do cartão. Só leitura. */
export class ReportController {
    /**
     * @param reports Casos de uso dos relatórios.
     * @param onUnexpected Destino do log de falhas inesperadas.
     */
    public constructor(private readonly reports: ReportService, private readonly onUnexpected: UnexpectedErrorListener) {}

    /**
     * @param raw Entrada com o perfil e o mês de referência.
     * @return Receitas, despesas, variação e faturas em aberto do mês.
     */
    public monthSummary(raw: unknown): Promise<CoreResult<MonthSummaryResponse>> {
        return handle(monthSummaryRequest, raw, ({ profileId, period }) => toMonthSummaryResponse(this.reports.monthSummary(profileId, period)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com o perfil, o mês de referência e o tamanho da série.
     * @return Consolidado e previsto do perfil em cada mês.
     */
    public balanceEvolution(raw: unknown): Promise<CoreResult<BalanceEvolutionResponse>> {
        return handle(
            balanceEvolutionRequest,
            raw,
            ({ profileId, period, months }) => toBalanceEvolutionResponse(this.reports.balanceEvolution(profileId, period, months)),
            this.onUnexpected,
        );
    }

    /**
     * @param raw Entrada com o perfil, o mês de referência e o modo de comparação.
     * @return A árvore categoria → subcategoria com comparação e variação.
     */
    public byCategory(raw: unknown): Promise<CoreResult<CategoryReportResponse>> {
        return handle(
            categoryReportRequest,
            raw,
            ({ profileId, period, comparison }) => toCategoryReportResponse(this.reports.byCategory(profileId, period, comparison)),
            this.onUnexpected,
        );
    }

    /**
     * @param raw Entrada com o perfil, o mês e a categoria ou subcategoria aberta.
     * @return Os lançamentos do drill-down e o total.
     */
    public categoryTransactions(raw: unknown): Promise<CoreResult<CategoryTransactionsResponse>> {
        return handle(
            categoryTransactionsRequest,
            raw,
            ({ profileId, period, scope }) => toCategoryTransactionsResponse(this.reports.categoryTransactions(profileId, period, scope)),
            this.onUnexpected,
        );
    }

    /**
     * @param raw Entrada com o perfil e o mês de referência.
     * @return A grade mês × cartão com o peso nas entradas.
     */
    public cardImpact(raw: unknown): Promise<CoreResult<CardImpactResponse>> {
        return handle(cardImpactRequest, raw, ({ profileId, period }) => toCardImpactResponse(this.reports.cardImpact(profileId, period)), this.onUnexpected);
    }
}
