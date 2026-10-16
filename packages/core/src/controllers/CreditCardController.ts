import { toCreditCardListResponse, type CreditCardListResponse } from '../dto/creditCards/CreditCardListResponse.ts';
import { toCreditCardResponse, type CreditCardResponse } from '../dto/creditCards/CreditCardResponse.ts';
import { toCreditCardDeletionImpactResponse, type CreditCardDeletionImpactResponse } from '../dto/deletion/DeletionImpactResponse.ts';
import { createCreditCardRequest, creditCardIdRequest, listCreditCardsRequest, updateCreditCardRequest } from '../requests/creditCardRequests.ts';
import type { CreditCardService } from '../services/creditCard/CreditCardService.ts';
import type { CascadeDeletionService } from '../services/deletion/CascadeDeletionService.ts';
import { handle, type CoreResult, type UnexpectedErrorListener } from './CoreResult.ts';

/** Rotas do cadastro de cartões, incluindo o alerta e a exclusão em cadeia. */
export class CreditCardController {
    /**
     * @param creditCards Cadastro de cartões.
     * @param deletions Alerta e exclusão em cadeia.
     * @param onUnexpected Destino do log de falhas inesperadas.
     */
    public constructor(
        private readonly creditCards: CreditCardService,
        private readonly deletions: CascadeDeletionService,
        private readonly onUnexpected: UnexpectedErrorListener,
    ) {}

    /**
     * @param raw Entrada com o perfil e o mês de referência.
     * @return Os cartões com a fatura do mês, o limite usado e os totais.
     */
    public list(raw: unknown): Promise<CoreResult<CreditCardListResponse>> {
        return handle(listCreditCardsRequest, raw, ({ profileId, period }) => toCreditCardListResponse(this.creditCards.list(profileId, period)), this.onUnexpected);
    }

    /**
     * @param raw Entrada do formulário de cartão novo.
     * @return O cartão criado.
     */
    public create(raw: unknown): Promise<CoreResult<CreditCardResponse>> {
        return handle(createCreditCardRequest, raw, (command) => toCreditCardResponse(this.creditCards.create(command)), this.onUnexpected);
    }

    /**
     * @param raw Entrada do formulário de edição, completa.
     * @return O cartão editado.
     */
    public update(raw: unknown): Promise<CoreResult<CreditCardResponse>> {
        return handle(updateCreditCardRequest, raw, (command) => toCreditCardResponse(this.creditCards.update(command)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com o id do cartão.
     * @return O cartão desativado.
     */
    public disable(raw: unknown): Promise<CoreResult<CreditCardResponse>> {
        return handle(creditCardIdRequest, raw, ({ id }) => toCreditCardResponse(this.creditCards.disable(id)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com o id do cartão.
     * @return O cartão reativado.
     */
    public enable(raw: unknown): Promise<CoreResult<CreditCardResponse>> {
        return handle(creditCardIdRequest, raw, ({ id }) => toCreditCardResponse(this.creditCards.enable(id)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com o id do cartão.
     * @return O que a exclusão apagaria e as contas cujo saldo mudaria.
     */
    public deletionImpact(raw: unknown): Promise<CoreResult<CreditCardDeletionImpactResponse>> {
        return handle(creditCardIdRequest, raw, ({ id }) => toCreditCardDeletionImpactResponse(this.deletions.creditCardImpact(id)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com o id do cartão.
     * @return `null` em caso de sucesso.
     */
    public delete(raw: unknown): Promise<CoreResult<null>> {
        return handle(creditCardIdRequest, raw, ({ id }) => {
            this.deletions.deleteCreditCard(id);
            return null;
        }, this.onUnexpected);
    }
}
