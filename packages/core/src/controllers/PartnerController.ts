import { toPartnerResponses, type PartnerResponse } from '../dto/partners/PartnerResponse.ts';
import { listPartnersRequest, savePartnersRequest } from '../requests/partnerRequests.ts';
import type { PartnerService } from '../services/partner/PartnerService.ts';
import { handle, type CoreResult, type UnexpectedErrorListener } from './CoreResult.ts';

/** Rotas do cadastro de sócios. */
export class PartnerController {
    /**
     * @param partners Cadastro de sócios.
     * @param onUnexpected Destino do log de falhas inesperadas.
     */
    public constructor(
        private readonly partners: PartnerService,
        private readonly onUnexpected: UnexpectedErrorListener,
    ) {}

    /**
     * @param raw Entrada com o perfil empresarial.
     * @return Os sócios do perfil, com os lançamentos que cada um pagou.
     */
    public list(raw: unknown): Promise<CoreResult<readonly PartnerResponse[]>> {
        return handle(listPartnersRequest, raw, ({ profileId }) => toPartnerResponses(this.partners.list(profileId)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com o perfil e a lista completa de sócios.
     * @return A lista gravada.
     */
    public save(raw: unknown): Promise<CoreResult<readonly PartnerResponse[]>> {
        return handle(savePartnersRequest, raw, (command) => toPartnerResponses(this.partners.replace(command)), this.onUnexpected);
    }
}
