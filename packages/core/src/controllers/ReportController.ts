import { toAccountFlowResponse, type AccountFlowResponse } from '../dto/reports/AccountFlowResponse.ts';
import { toBalanceEvolutionResponse, type BalanceEvolutionResponse } from '../dto/reports/BalanceEvolutionResponse.ts';
import { toCardImpactResponse, type CardImpactResponse } from '../dto/reports/CardImpactResponse.ts';
import { toCategoryReportResponse, type CategoryReportResponse } from '../dto/reports/CategoryReportResponse.ts';
import { toCategoryTransactionsResponse, type CategoryTransactionsResponse } from '../dto/reports/CategoryTransactionsResponse.ts';
import { toMonthSummaryResponse, type MonthSummaryResponse } from '../dto/reports/MonthSummaryResponse.ts';
import {
    toEntriesWithoutPartnerResponse,
    toPartnerReportResponse,
    type EntriesWithoutPartnerResponse,
    type PartnerReportResponse,
} from '../dto/reports/PartnerReportResponse.ts';
import { toTagReportResponse, toTagTransactionsResponse, type TagReportResponse, type TagTransactionsResponse } from '../dto/reports/TagReportResponse.ts';
import {
    accountFlowRequest,
    balanceEvolutionRequest,
    cardImpactRequest,
    categoryReportRequest,
    categoryTransactionsRequest,
    entriesWithoutPartnerRequest,
    monthSummaryRequest,
    partnerReportRequest,
    tagReportRequest,
    tagTransactionsRequest,
} from '../requests/reportRequests.ts';
import type { ReportService } from '../services/report/ReportService.ts';
import { handle, type CoreResult, type UnexpectedErrorListener } from './CoreResult.ts';

/** Rotas dos relatórios: Visão geral, por categoria, impacto do cartão, fluxo por conta, por tag e por sócio. Só leitura. */
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

    /**
     * @param raw Entrada com o perfil, o mês de referência e a conta; sem a conta, as do total.
     * @return Os extratos encadeados dos cinco meses da janela.
     */
    public accountFlow(raw: unknown): Promise<CoreResult<AccountFlowResponse>> {
        return handle(
            accountFlowRequest,
            raw,
            ({ profileId, period, accountId }) => toAccountFlowResponse(this.reports.accountFlow(profileId, period, accountId ?? null)),
            this.onUnexpected,
        );
    }

    /**
     * @param raw Entrada com o perfil, o mês de referência e o período.
     * @return As tags com lançamento no período, pelo total líquido.
     */
    public byTag(raw: unknown): Promise<CoreResult<TagReportResponse>> {
        return handle(tagReportRequest, raw, ({ profileId, period, range }) => toTagReportResponse(this.reports.byTag(profileId, period, range)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com o perfil, o mês de referência, o período e a tag aberta.
     * @return Os lançamentos da tag e o total líquido.
     */
    public tagTransactions(raw: unknown): Promise<CoreResult<TagTransactionsResponse>> {
        return handle(
            tagTransactionsRequest,
            raw,
            ({ profileId, period, range, tagId }) => toTagTransactionsResponse(this.reports.tagTransactions(profileId, period, range, tagId)),
            this.onUnexpected,
        );
    }

    /**
     * @param raw Entrada com o perfil empresarial e o mês de referência.
     * @return Quanto cada sócio aportou e deveria ter aportado, os números do mês e o acerto.
     */
    public byPartner(raw: unknown): Promise<CoreResult<PartnerReportResponse>> {
        return handle(partnerReportRequest, raw, ({ profileId, period }) => toPartnerReportResponse(this.reports.byPartner(profileId, period)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com o perfil empresarial e o mês de referência.
     * @return As entradas do mês sem sócio e o total delas.
     */
    public entriesWithoutPartner(raw: unknown): Promise<CoreResult<EntriesWithoutPartnerResponse>> {
        return handle(
            entriesWithoutPartnerRequest,
            raw,
            ({ profileId, period }) => toEntriesWithoutPartnerResponse(this.reports.entriesWithoutPartner(profileId, period)),
            this.onUnexpected,
        );
    }
}
