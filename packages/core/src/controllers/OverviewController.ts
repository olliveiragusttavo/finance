import {
    toOverviewNextInvoicesResponse,
    toOverviewPendingResponse,
    toOverviewSpendingResponse,
    type OverviewNextInvoicesResponse,
    type OverviewPendingResponse,
    type OverviewSpendingResponse,
} from '../dto/overview/OverviewResponse.ts';
import { overviewProfileRequest, overviewSpendingRequest } from '../requests/overviewRequests.ts';
import type { OverviewService } from '../services/overview/OverviewService.ts';
import { handle, type CoreResult, type UnexpectedErrorListener } from './CoreResult.ts';

/** Rotas da Visão geral (mockup `DesktopVisaoGeral2`). */
export class OverviewController {
    /**
     * @param overview Resumos da Visão geral.
     * @param onUnexpected Destino do log de falhas inesperadas.
     */
    public constructor(
        private readonly overview: OverviewService,
        private readonly onUnexpected: UnexpectedErrorListener,
    ) {}

    /**
     * @param raw Entrada com o perfil e o mês de referência.
     * @return Gastos dos seis meses, entradas do mês e as maiores categorias.
     */
    public spending(raw: unknown): Promise<CoreResult<OverviewSpendingResponse>> {
        return handle(overviewSpendingRequest, raw, ({ profileId, period }) => toOverviewSpendingResponse(this.overview.spending(profileId, period)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com o perfil.
     * @return Os atrasados e o que ainda vence no mês de hoje.
     */
    public pending(raw: unknown): Promise<CoreResult<OverviewPendingResponse>> {
        return handle(overviewProfileRequest, raw, ({ profileId }) => toOverviewPendingResponse(this.overview.pending(profileId)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com o perfil.
     * @return A próxima fatura em aberto de cada cartão.
     */
    public nextInvoices(raw: unknown): Promise<CoreResult<OverviewNextInvoicesResponse>> {
        return handle(overviewProfileRequest, raw, ({ profileId }) => toOverviewNextInvoicesResponse(this.overview.nextInvoices(profileId)), this.onUnexpected);
    }
}
