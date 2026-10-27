import { toBalanceProjectionResponse, type BalanceProjectionResponse } from '../dto/reports/BalanceProjectionResponse.ts';
import {
    toEntriesWithoutPartnerResponse,
    toPartnerReportResponse,
    type EntriesWithoutPartnerResponse,
    type PartnerReportResponse,
} from '../dto/reports/PartnerReportResponse.ts';
import { balanceProjectionRequest, entriesWithoutPartnerRequest, partnerReportRequest } from '../requests/fixedReportRequests.ts';
import type { FixedReportService } from '../services/report/FixedReportService.ts';
import { handle, type CoreResult, type UnexpectedErrorListener } from './CoreResult.ts';

/** Rotas dos relatórios fixos (reports-design §8 e §9). */
export class FixedReportController {
    /**
     * @param reports Relatórios fixos.
     * @param onUnexpected Destino do log de falhas inesperadas.
     */
    public constructor(
        private readonly reports: FixedReportService,
        private readonly onUnexpected: UnexpectedErrorListener,
    ) {}

    /**
     * @param raw Entrada com o perfil empresarial e o mês de referência.
     * @return Aportes, divisão pela participação e acerto.
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

    /**
     * @param raw Entrada com o perfil e a janela da média.
     * @return A projeção do saldo dos próximos meses.
     */
    public balanceProjection(raw: unknown): Promise<CoreResult<BalanceProjectionResponse>> {
        return handle(balanceProjectionRequest, raw, ({ profileId, basis }) => toBalanceProjectionResponse(this.reports.balanceProjection(profileId, basis)), this.onUnexpected);
    }
}
