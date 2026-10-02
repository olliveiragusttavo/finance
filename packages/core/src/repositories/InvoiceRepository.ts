import type { CreditCard } from '../domain/creditCard/CreditCard.ts';
import type { Invoice } from '../domain/invoice/Invoice.ts';
import type { AccountId, BankStatementId, CreditCardId, InvoiceId } from '../domain/shared/ids.ts';
import type { YearMonth } from '../domain/shared/YearMonth.ts';

/** Uma fatura junto do cartão dono, para quem precisa do ciclo de faturamento. */
export interface InvoiceWithCard {
    readonly invoice: Invoice;
    readonly creditCard: CreditCard;
}

/** Acesso às faturas mensais. Toda leitura considera só faturas vivas. */
export interface InvoiceRepository {
    /**
     * @param id Fatura procurada.
     * @return A fatura viva, ou `null`.
     */
    findById(id: InvoiceId): Invoice | null;

    /**
     * @param creditCardId Cartão dono da fatura.
     * @param period Competência procurada.
     * @return A fatura viva daquele mês, ou `null` quando ainda não existe.
     */
    findByPeriod(creditCardId: CreditCardId, period: YearMonth): Invoice | null;

    /**
     * Insere a fatura ou revive a linha com o mesmo id determinístico (sync-design §5.6).
     *
     * @param invoice Fatura a garantir.
     * @return void
     */
    insertOrRevive(invoice: Invoice): void;

    /**
     * @param invoice Fatura com o total recalculado.
     * @return void
     */
    saveBalance(invoice: Invoice): void;

    /**
     * Grava o vínculo com o extrato do pagamento (ou o desfaz, ao reabrir).
     *
     * @param invoice Fatura paga ou reaberta.
     * @return void
     */
    savePayment(invoice: Invoice): void;

    /**
     * @param statementId Extrato do mês do pagamento.
     * @return As faturas vivas pagas naquele extrato.
     */
    listPaidInStatement(statementId: BankStatementId): readonly Invoice[];

    /**
     * @param accountId Conta que quita os cartões.
     * @param fromInvoicePeriod Primeira competência de fatura incluída.
     * @return As faturas vivas em aberto dos cartões vivos quitados pela conta, com o
     * cartão — o vencimento depende do ciclo de cada um.
     */
    listOpenByPayingAccount(accountId: AccountId, fromInvoicePeriod: YearMonth): readonly InvoiceWithCard[];

    /**
     * @param accountId Conta que quita os cartões.
     * @return Os ids de todas as faturas vivas dos cartões vivos da conta, pagas ou não;
     * usado pelo recálculo completo, que refaz os totais antes da cadeia da conta.
     */
    listIdsByPayingAccount(accountId: AccountId): readonly InvoiceId[];
}
