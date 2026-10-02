import { toTransactionResponse, type TransactionResponse } from '../dto/transactions/TransactionResponse.ts';
import { createTransactionRequest, listTransactionsRequest, transactionIdRequest, updateTransactionRequest } from '../requests/transactionRequests.ts';
import type { TransactionService } from '../services/transaction/TransactionService.ts';
import { handle, type CoreResult, type UnexpectedErrorListener } from './CoreResult.ts';

/**
 * Rotas de transação. O Controller só valida (camada Request), delega ao Service e formata
 * o DTO; regra de negócio aqui seria um segundo lugar onde ela poderia divergir.
 */
export class TransactionController {
    /**
     * @param transactions Casos de uso de transação.
     * @param onUnexpected Destino do log de falhas inesperadas.
     */
    public constructor(
        private readonly transactions: TransactionService,
        private readonly onUnexpected: UnexpectedErrorListener,
    ) {}

    /**
     * @param raw Entrada não confiável do formulário de lançamento.
     * @return A transação criada.
     */
    public create(raw: unknown): Promise<CoreResult<TransactionResponse>> {
        return handle(createTransactionRequest, raw, (command) => toTransactionResponse(this.transactions.create(command)), this.onUnexpected);
    }

    /**
     * @param raw Entrada não confiável da edição.
     * @return A transação editada.
     */
    public update(raw: unknown): Promise<CoreResult<TransactionResponse>> {
        return handle(updateTransactionRequest, raw, (command) => toTransactionResponse(this.transactions.update(command)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com o id da transação.
     * @return `null` em caso de sucesso — não há o que devolver de uma linha excluída.
     */
    public delete(raw: unknown): Promise<CoreResult<null>> {
        return handle(transactionIdRequest, raw, ({ id }) => {
            this.transactions.delete(id);
            return null;
        }, this.onUnexpected);
    }

    /**
     * @param raw Entrada com o id da transação.
     * @return A transação.
     */
    public get(raw: unknown): Promise<CoreResult<TransactionResponse>> {
        return handle(transactionIdRequest, raw, ({ id }) => toTransactionResponse(this.transactions.get(id)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com o perfil e o mês.
     * @return As transações do mês.
     */
    public listByPeriod(raw: unknown): Promise<CoreResult<readonly TransactionResponse[]>> {
        return handle(
            listTransactionsRequest,
            raw,
            ({ profileId, period }) => this.transactions.listByPeriod(profileId, period).map(toTransactionResponse),
            this.onUnexpected,
        );
    }
}
