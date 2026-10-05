import type { CreditCard } from '../../domain/creditCard/CreditCard.ts';
import type { Invoice } from '../../domain/invoice/Invoice.ts';
import { BusinessRuleViolation, NotFoundError } from '../../domain/shared/errors.ts';
import type { CreditCardId, InvoiceId } from '../../domain/shared/ids.ts';
import type { LocalDate } from '../../domain/shared/LocalDate.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';
import type { AccountRepository } from '../../repositories/AccountRepository.ts';
import type { CreditCardRepository } from '../../repositories/CreditCardRepository.ts';
import type { InvoiceRepository } from '../../repositories/InvoiceRepository.ts';
import type { TransactionRepository } from '../../repositories/TransactionRepository.ts';
import type { BalanceImpact } from '../balance/BalanceImpact.ts';
import type { BalanceRecalculationService } from '../balance/BalanceRecalculationService.ts';
import type { ImpactCalculator } from '../balance/ImpactCalculator.ts';
import type { StatementConsolidationService } from '../statement/StatementConsolidationService.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import { invoiceCycle, type InvoiceCycle } from './InvoiceCycle.ts';
import type { InvoiceSuggestion, InvoiceView } from './InvoiceViews.ts';

/**
 * Casos de uso da fatura de cartão: sugerir em qual fatura cai uma compra, pagar e reabrir.
 * Regra de negócio (Fatura): uma fatura está paga ou em aberto; pagar a vincula ao extrato
 * do mês do pagamento e reabrir desfaz esse vínculo (database-design §4.7).
 */
export class InvoiceService {
    /**
     * @param unitOfWork Pagamento e recálculo na mesma transação de banco.
     * @param creditCards Cartão da fatura: ciclo e conta pagadora.
     * @param accounts Conta pagadora, dona do extrato do pagamento.
     * @param invoices Faturas.
     * @param transactions Transações exibidas na fatura.
     * @param consolidation Garante o extrato do mês do pagamento.
     * @param impacts Traduz o estado da fatura nos saldos afetados.
     * @param recalculation A rotina única de recálculo.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly creditCards: CreditCardRepository,
        private readonly accounts: AccountRepository,
        private readonly invoices: InvoiceRepository,
        private readonly transactions: TransactionRepository,
        private readonly consolidation: StatementConsolidationService,
        private readonly impacts: ImpactCalculator,
        private readonly recalculation: BalanceRecalculationService,
    ) {}

    /**
     * Regra de negócio (Cartão de crédito): o app sugere a fatura pela data da compra e
     * pelo dia de fechamento, e a compra no dia do fechamento cai na fatura seguinte
     * (database-design §4.5). É só a sugestão: a escolha do usuário é a verdade (§4.7).
     *
     * @param creditCardId Cartão da compra.
     * @param purchaseDate Data da compra.
     * @return A competência sugerida e a fatura, se já existir.
     * @throws {NotFoundError} Quando o cartão não existe.
     */
    public suggest(creditCardId: CreditCardId, purchaseDate: LocalDate): InvoiceSuggestion {
        return this.unitOfWork.run(() => {
            const creditCard = this.requireCard(creditCardId);
            const period = creditCard.billingCycle.suggestedInvoicePeriod(purchaseDate);
            return { creditCard, period, invoice: this.invoices.findByPeriod(creditCardId, period) };
        });
    }

    /**
     * @param invoiceId Fatura consultada.
     * @return A fatura com cartão, datas de fechamento e vencimento e transações.
     * @throws {NotFoundError} Quando a fatura ou o cartão não existe.
     */
    public get(invoiceId: InvoiceId): InvoiceView {
        return this.unitOfWork.run(() => {
            const invoice = this.requireInvoice(invoiceId);
            const creditCard = this.requireCard(invoice.creditCardId);
            return {
                invoice,
                creditCard,
                closingDate: creditCard.billingCycle.closingDateOf(invoice.period),
                dueDate: creditCard.billingCycle.dueDateOf(invoice.period),
                transactions: this.transactions.listByInvoice(invoiceId),
            };
        });
    }

    /**
     * A fatura de um mês e as próximas do cartão — "Próximas faturas" (mockup
     * `DesktopCartoes`). O mês pedido vem sempre, mesmo sem linha, porque a tela mostra a
     * fatura do mês com fechamento e vencimento ainda que nada tenha caído nela; os meses
     * seguintes vêm só quando têm fatura (parcelas e compras já lançadas).
     *
     * @param creditCardId Cartão consultado.
     * @param from Mês de referência da tela.
     * @return A competência pedida e as faturas existentes depois dela, em ordem cronológica.
     * @throws {NotFoundError} Quando o cartão não existe.
     */
    public listByCard(creditCardId: CreditCardId, from: YearMonth): readonly InvoiceCycle[] {
        return this.unitOfWork.run(() => {
            const creditCard = this.requireCard(creditCardId);
            const invoices = this.invoices.listByCard(creditCardId);
            const later = invoices.filter((invoice) => from.isBefore(invoice.period));
            return [
                invoiceCycle(creditCard, from, invoices.find((invoice) => invoice.period.equals(from)) ?? null),
                ...later.map((invoice) => invoiceCycle(creditCard, invoice.period, invoice)),
            ];
        });
    }

    /**
     * Paga a fatura inteira.
     * Regra de negócio (Fatura): pagar vincula a fatura ao extrato do mês do pagamento da
     * conta que quita o cartão; a fatura sai do previsto do vencimento e entra, no
     * consolidado e no previsto, no mês em que o pagamento aconteceu (database-design §4.7).
     * Pagar uma fatura já paga é recusado: mudar o mês do pagamento é reabrir e pagar de novo.
     *
     * @param invoiceId Fatura a pagar.
     * @param paymentDate Data do pagamento; decide o extrato que absorve a fatura.
     * @return A fatura paga, com o total recalculado.
     * @throws {NotFoundError} Quando a fatura, o cartão ou a conta pagadora não existe.
     * @throws {BusinessRuleViolation} Quando a fatura já está paga.
     */
    public pay(invoiceId: InvoiceId, paymentDate: LocalDate): Invoice {
        return this.unitOfWork.run(() => {
            const invoice = this.requireInvoice(invoiceId);
            if (invoice.isPaid()) {
                throw new BusinessRuleViolation('invoice-already-paid', 'a fatura já está paga; reabra antes de pagar de novo', { invoiceId });
            }
            const creditCard = this.requireCard(invoice.creditCardId);
            const account = this.accounts.findById(creditCard.accountId);
            if (account === null) {
                throw new NotFoundError('Account', creditCard.accountId);
            }
            const statement = this.consolidation.ensureStatement(account, paymentDate.period);
            const paid = invoice.pay({ statementId: statement.id, period: statement.period, date: paymentDate });
            this.invoices.savePayment(paid);
            this.recalculation.apply(this.impacts.ofInvoice(invoice, creditCard).merge(this.impacts.ofInvoice(paid, creditCard)));
            return this.requireInvoice(invoiceId);
        });
    }

    /**
     * Reabre uma fatura paga e recalcula os saldos.
     * Regra de negócio (Fatura): reabrir desfaz o pagamento — o valor sai do extrato onde
     * tinha sido pago e o saldo da conta volta como se o pagamento não tivesse acontecido
     * (database-design §4.7).
     *
     * @param invoiceId Fatura a reabrir.
     * @return A fatura em aberto.
     * @throws {NotFoundError} Quando a fatura ou o cartão não existe.
     * @throws {BusinessRuleViolation} Quando a fatura já está em aberto.
     */
    public reopen(invoiceId: InvoiceId): Invoice {
        return this.unitOfWork.run(() => {
            const invoice = this.requireInvoice(invoiceId);
            if (!invoice.isPaid()) {
                throw new BusinessRuleViolation('invoice-not-paid', 'a fatura já está em aberto', { invoiceId });
            }
            this.recalculation.apply(this.markReopened(invoice, this.requireCard(invoice.creditCardId)));
            return this.requireInvoice(invoiceId);
        });
    }

    /**
     * Reabre a fatura sem recalcular, devolvendo o impacto para quem compõe um caso de uso
     * maior. Existe para o lançamento numa fatura paga, que a reabre
     * (database-design §4.7) e recalcula tudo uma vez só, no fim da própria escrita.
     *
     * @param invoice Fatura paga a reabrir.
     * @param creditCard Cartão dono da fatura.
     * @return O impacto da reabertura (mês do pagamento e mês do vencimento).
     */
    public markReopened(invoice: Invoice, creditCard: CreditCard): BalanceImpact {
        const reopened = invoice.reopen();
        this.invoices.savePayment(reopened);
        return this.impacts.ofInvoice(invoice, creditCard).merge(this.impacts.ofInvoice(reopened, creditCard));
    }

    /**
     * @param invoiceId Fatura procurada.
     * @return A fatura viva.
     * @throws {NotFoundError} Quando não existe.
     */
    private requireInvoice(invoiceId: InvoiceId): Invoice {
        const invoice = this.invoices.findById(invoiceId);
        if (invoice === null) {
            throw new NotFoundError('Invoice', invoiceId);
        }
        return invoice;
    }

    /**
     * @param creditCardId Cartão procurado.
     * @return O cartão vivo.
     * @throws {NotFoundError} Quando não existe.
     */
    private requireCard(creditCardId: CreditCardId): CreditCard {
        const creditCard = this.creditCards.findById(creditCardId);
        if (creditCard === null) {
            throw new NotFoundError('CreditCard', creditCardId);
        }
        return creditCard;
    }
}
