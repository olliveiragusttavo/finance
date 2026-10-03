import type { z } from 'zod';
import type { AccountBalanceResponse } from '../dto/accounts/AccountBalanceResponse.ts';
import type { IntegrityReportResponse } from '../dto/integrity/IntegrityReportResponse.ts';
import type { InvoiceDetailResponse } from '../dto/invoices/InvoiceDetailResponse.ts';
import type { InvoiceResponse } from '../dto/invoices/InvoiceResponse.ts';
import type { InvoiceSuggestionResponse } from '../dto/invoices/InvoiceSuggestionResponse.ts';
import type { ProfileBalancesResponse } from '../dto/profiles/ProfileBalancesResponse.ts';
import type { StatementResponse } from '../dto/statements/StatementResponse.ts';
import type { TransactionResponse } from '../dto/transactions/TransactionResponse.ts';
import type { profileBalancesRequest, rebuildAccountRequest } from '../requests/balanceRequests.ts';
import type { verifyBalancesRequest } from '../requests/integrityRequests.ts';
import type { invoiceIdRequest, payInvoiceRequest, suggestInvoiceRequest } from '../requests/invoiceRequests.ts';
import type { getStatementRequest } from '../requests/statementRequests.ts';
import type {
    createTransactionRequest,
    listTransactionsRequest,
    transactionIdRequest,
    updateTransactionRequest,
} from '../requests/transactionRequests.ts';
import type { CoreResult } from './CoreResult.ts';

/**
 * Mapa de rotas do núcleo: para cada rota, o DTO de entrada (o que o schema da camada
 * Request aceita) e o de saída. É o contrato tipado que o pacote `client` consome nas duas
 * plataformas (desktop-shell-design §5.1) — mudar uma rota aqui quebra a compilação da UI,
 * não o app em produção.
 */
export interface CoreRoutes {
    'transactions.create': { input: z.input<typeof createTransactionRequest>; output: TransactionResponse };
    'transactions.update': { input: z.input<typeof updateTransactionRequest>; output: TransactionResponse };
    'transactions.delete': { input: z.input<typeof transactionIdRequest>; output: null };
    'transactions.get': { input: z.input<typeof transactionIdRequest>; output: TransactionResponse };
    'transactions.listByPeriod': { input: z.input<typeof listTransactionsRequest>; output: readonly TransactionResponse[] };
    'statements.get': { input: z.input<typeof getStatementRequest>; output: StatementResponse };
    'balances.ofProfile': { input: z.input<typeof profileBalancesRequest>; output: ProfileBalancesResponse };
    'balances.rebuildAccount': { input: z.input<typeof rebuildAccountRequest>; output: AccountBalanceResponse };
    'invoices.suggest': { input: z.input<typeof suggestInvoiceRequest>; output: InvoiceSuggestionResponse };
    'invoices.get': { input: z.input<typeof invoiceIdRequest>; output: InvoiceDetailResponse };
    'invoices.pay': { input: z.input<typeof payInvoiceRequest>; output: InvoiceResponse };
    'invoices.reopen': { input: z.input<typeof invoiceIdRequest>; output: InvoiceResponse };
    'integrity.verifyBalances': { input: z.input<typeof verifyBalancesRequest>; output: IntegrityReportResponse };
}

export type CoreRoute = keyof CoreRoutes;
export type CoreInput<R extends CoreRoute> = CoreRoutes[R]['input'];
export type CoreOutput<R extends CoreRoute> = CoreRoutes[R]['output'];

/**
 * Tabela rota → handler. Tipada por rota para que o compilador exija um handler para cada
 * rota do mapa e confira o tipo de saída de cada um.
 */
export type RouteHandlers = { readonly [R in CoreRoute]: (raw: unknown) => Promise<CoreResult<CoreOutput<R>>> };

/** O núcleo como a UI o enxerga, em qualquer plataforma. */
export interface CoreApi {
    /**
     * Chamada tipada, para quem conhece a rota em tempo de compilação (`DirectCoreClient`).
     *
     * @param route Rota chamada.
     * @param input Entrada da rota; validada de novo pela camada Request, porque o tipo em
     * tempo de compilação não protege contra o renderer.
     * @return O resultado da rota.
     */
    call<R extends CoreRoute>(route: R, input: CoreInput<R>): Promise<CoreResult<CoreOutput<R>>>;

    /**
     * Chamada não tipada, para o transporte (IPC) que recebe a rota como texto.
     *
     * @param route Nome da rota recebido do transporte.
     * @param input Entrada não confiável.
     * @return O resultado da rota; `VALIDATION_FAILED` quando a rota não existe.
     */
    dispatch(route: string, input: unknown): Promise<CoreResult<unknown>>;
}
