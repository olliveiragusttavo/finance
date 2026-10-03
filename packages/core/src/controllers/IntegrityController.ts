import { toIntegrityReportResponse, type IntegrityReportResponse } from '../dto/integrity/IntegrityReportResponse.ts';
import { verifyBalancesRequest } from '../requests/integrityRequests.ts';
import type { BalanceIntegrityService } from '../services/integrity/BalanceIntegrityService.ts';
import { handle, type CoreResult, type UnexpectedErrorListener } from './CoreResult.ts';

/**
 * Rota da verificação de integridade. Passa pelo mapa de rotas, e não por chamada direta ao
 * Service, para que o shell a rode na abertura com o mesmo tratamento de erro de qualquer
 * rota e receba um resultado já serializável para o log.
 */
export class IntegrityController {
    /**
     * @param integrity Confere os saldos em cache contra o recálculo.
     * @param onUnexpected Destino do log de falhas inesperadas.
     */
    public constructor(
        private readonly integrity: BalanceIntegrityService,
        private readonly onUnexpected: UnexpectedErrorListener,
    ) {}

    /**
     * @param raw Entrada vazia.
     * @return As contas conferidas e os saldos em cache que divergem do recálculo.
     */
    public verifyBalances(raw: unknown): Promise<CoreResult<IntegrityReportResponse>> {
        return handle(verifyBalancesRequest, raw, () => toIntegrityReportResponse(this.integrity.verifyBalances()), this.onUnexpected);
    }
}
