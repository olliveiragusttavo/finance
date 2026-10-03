import type { CreditCard } from '../../domain/creditCard/CreditCard.ts';
import type { Invoice } from '../../domain/invoice/Invoice.ts';
import type { Transaction } from '../../domain/transaction/Transaction.ts';
import type { CreditCardRepository } from '../../repositories/CreditCardRepository.ts';
import type { InvoiceRepository } from '../../repositories/InvoiceRepository.ts';
import { BalanceImpact } from './BalanceImpact.ts';

/**
 * Traduz um estado (de uma transação ou fatura) no conjunto de saldos que dependem dele.
 * Quem escreve calcula o impacto **antes e depois** da escrita e soma os dois, para que o
 * contêiner antigo e o novo sejam recalculados juntos (backend-design §5.1).
 */
export class ImpactCalculator {
    /**
     * @param invoices Fatura de uma transação de cartão, para saber se está paga.
     * @param creditCards Cartão da fatura, para o ciclo e a conta que paga.
     */
    public constructor(
        private readonly invoices: InvoiceRepository,
        private readonly creditCards: CreditCardRepository,
    ) {}

    /**
     * @param transaction Estado da transação (antes ou depois da escrita).
     * @return O contêiner de origem e, se houver, a conta de destino no mês da data de caixa
     * (`Transaction.cashDate`).
     */
    public ofTransaction(transaction: Transaction): BalanceImpact {
        let impact = BalanceImpact.none();
        if (transaction.container.kind === 'statement') {
            impact = impact.withAccount(transaction.container.accountId, transaction.container.period);
        } else {
            const invoice = this.invoices.findById(transaction.container.invoiceId);
            const creditCard = this.creditCards.findById(transaction.container.creditCardId);
            impact = invoice === null || creditCard === null
                ? impact.withInvoice(transaction.container.invoiceId)
                : this.ofInvoice(invoice, creditCard);
        }
        if (transaction.destinationAccountId !== null) {
            impact = impact.withAccount(transaction.destinationAccountId, transaction.cashDate().period);
        }
        return impact;
    }

    /**
     * Regra de negócio (Fatura): paga, a fatura entra no extrato do mês do pagamento; em
     * aberto, entra no previsto do mês do vencimento (database-design §4.7). É desse mês que
     * a conta que quita o cartão precisa ser recalculada.
     *
     * @param invoice Estado da fatura (antes ou depois da escrita).
     * @param creditCard Cartão dono da fatura.
     * @return A fatura e a conta pagadora a partir do mês em que a fatura pesa no saldo.
     */
    public ofInvoice(invoice: Invoice, creditCard: CreditCard): BalanceImpact {
        const from = invoice.payment?.period ?? creditCard.billingCycle.dueDateOf(invoice.period).period;
        return BalanceImpact.none().withInvoice(invoice.id).withAccount(creditCard.accountId, from);
    }
}
