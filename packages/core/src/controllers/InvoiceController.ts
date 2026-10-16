import { toInvoiceCycleResponse, type InvoiceCycleResponse } from '../dto/invoices/InvoiceCycleResponse.ts';
import { toInvoiceDetailResponse, type InvoiceDetailResponse } from '../dto/invoices/InvoiceDetailResponse.ts';
import { toInvoiceResponse, type InvoiceResponse } from '../dto/invoices/InvoiceResponse.ts';
import { toInvoiceSuggestionResponse, type InvoiceSuggestionResponse } from '../dto/invoices/InvoiceSuggestionResponse.ts';
import { invoiceIdRequest, listInvoicesByCardRequest, payInvoiceRequest, suggestInvoiceRequest } from '../requests/invoiceRequests.ts';
import type { InvoiceService } from '../services/invoice/InvoiceService.ts';
import { handle, type CoreResult, type UnexpectedErrorListener } from './CoreResult.ts';

/** Rotas de fatura: sugestão, detalhe, próximas faturas, pagamento e reabertura. */
export class InvoiceController {
    /**
     * @param invoices Casos de uso de fatura.
     * @param onUnexpected Destino do log de falhas inesperadas.
     */
    public constructor(
        private readonly invoices: InvoiceService,
        private readonly onUnexpected: UnexpectedErrorListener,
    ) {}

    /**
     * @param raw Entrada com o cartão e a data da compra.
     * @return A fatura sugerida (brief M3).
     */
    public suggest(raw: unknown): Promise<CoreResult<InvoiceSuggestionResponse>> {
        return handle(
            suggestInvoiceRequest,
            raw,
            ({ creditCardId, purchaseDate }) => toInvoiceSuggestionResponse(this.invoices.suggest(creditCardId, purchaseDate)),
            this.onUnexpected,
        );
    }

    /**
     * @param raw Entrada com a fatura.
     * @return A fatura com datas e transações.
     */
    public get(raw: unknown): Promise<CoreResult<InvoiceDetailResponse>> {
        return handle(invoiceIdRequest, raw, ({ invoiceId }) => toInvoiceDetailResponse(this.invoices.get(invoiceId)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com o cartão e o mês de referência.
     * @return A fatura do mês e as próximas do cartão, com as datas do ciclo.
     */
    public listByCard(raw: unknown): Promise<CoreResult<readonly InvoiceCycleResponse[]>> {
        return handle(
            listInvoicesByCardRequest,
            raw,
            ({ creditCardId, from }) => this.invoices.listByCard(creditCardId, from).map(toInvoiceCycleResponse),
            this.onUnexpected,
        );
    }

    /**
     * @param raw Entrada com a fatura e a data do pagamento.
     * @return A fatura paga.
     */
    public pay(raw: unknown): Promise<CoreResult<InvoiceResponse>> {
        return handle(payInvoiceRequest, raw, ({ invoiceId, paymentDate }) => toInvoiceResponse(this.invoices.pay(invoiceId, paymentDate)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com a fatura.
     * @return A fatura reaberta.
     */
    public reopen(raw: unknown): Promise<CoreResult<InvoiceResponse>> {
        return handle(invoiceIdRequest, raw, ({ invoiceId }) => toInvoiceResponse(this.invoices.reopen(invoiceId)), this.onUnexpected);
    }
}
