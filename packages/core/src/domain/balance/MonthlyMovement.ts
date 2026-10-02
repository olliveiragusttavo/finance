import type { BillingCycle } from '../creditCard/BillingCycle.ts';
import type { Currency } from '../shared/Currency.ts';
import { Money } from '../shared/Money.ts';
import type { YearMonth } from '../shared/YearMonth.ts';
import { destinationEffect, originEffect, type TransactionType } from '../transaction/TransactionType.ts';
import { BalancePair } from './BalancePair.ts';

/** Soma, num mês, das transações de um tipo no extrato de origem, separada por pagas e em aberto. */
export interface OriginTotals {
    readonly period: YearMonth;
    readonly type: TransactionType;
    readonly paid: boolean;
    readonly value: Money;
    readonly charges: Money;
}

/** Soma, num mês, das transferências e investimentos que chegam à conta. */
export interface IncomingTotals {
    readonly period: YearMonth;
    readonly paid: boolean;
    readonly value: Money;
}

/** Soma das faturas pagas vinculadas ao extrato de um mês. */
export interface PaidInvoiceTotals {
    readonly period: YearMonth;
    readonly balance: Money;
}

/** Uma fatura em aberto de um cartão quitado pela conta. */
export interface OpenInvoice {
    readonly invoicePeriod: YearMonth;
    readonly billingCycle: BillingCycle;
    readonly balance: Money;
}

/** Tudo que entra no movimento mensal de uma conta, como o Repository agrega. */
export interface MovementSources {
    readonly origin: readonly OriginTotals[];
    readonly incoming: readonly IncomingTotals[];
    readonly paidInvoices: readonly PaidInvoiceTotals[];
    readonly openInvoices: readonly OpenInvoice[];
}

/**
 * Movimento mensal de uma conta, consolidado e previsto, montado a partir das somas que o
 * SQL agrega. A agregação pesada fica no SQLite e a regra fica aqui (backend-design §3.2):
 * o SQL só soma `value` e `charges` por mês, tipo e pago; quem decide direção, encargos,
 * o que é consolidado e em que mês cai uma fatura em aberto é o domínio.
 *
 * Regra de negócio (Extrato): entram no movimento do mês as transações do extrato, as
 * transferências e investimentos que chegam à conta no mês do `due_date`, as faturas pagas
 * vinculadas ao extrato e — só no previsto — as faturas em aberto no mês do vencimento
 * (database-design §4.6).
 */
export class MonthlyMovement {
    /**
     * @param currency Moeda do perfil; dá o zero de um mês sem movimento.
     * @param byPeriod Movimento por competência (`YYYY-MM`), com a competência original.
     */
    private constructor(
        private readonly currency: Currency,
        private readonly byPeriod: ReadonlyMap<string, { readonly period: YearMonth; readonly movement: BalancePair }>,
    ) {}

    /**
     * @param currency Moeda do perfil.
     * @param sources Somas agregadas pelo Repository.
     * @return O movimento por mês.
     */
    public static from(currency: Currency, sources: MovementSources): MonthlyMovement {
        const byPeriod = new Map<string, { period: YearMonth; movement: BalancePair }>();
        /**
         * Soma um efeito ao mês. Ponto único de acumulação para que as quatro fontes usem a
         * mesma regra de consolidado × previsto.
         *
         * @param period Mês em que o efeito cai.
         * @param effect Efeito no saldo da conta.
         * @param settled `true` quando o efeito já aconteceu e entra também no consolidado.
         * @return void
         */
        const accumulate =(period: YearMonth, effect: Money, settled: boolean): void => {
            const key = period.toString();
            const current = byPeriod.get(key)?.movement ?? BalancePair.zero(currency);
            byPeriod.set(key, { period, movement: current.plusEffect(effect, settled) });
        };

        for (const totals of sources.origin) {
            accumulate(totals.period, originEffect(totals.type, totals.value, totals.charges), totals.paid);
        }
        for (const totals of sources.incoming) {
            accumulate(totals.period, destinationEffect(totals.value), totals.paid);
        }
        // Fatura paga entra no consolidado e no previsto do mês do pagamento (§4.7).
        for (const totals of sources.paidInvoices) {
            accumulate(totals.period, totals.balance, true);
        }
        // Fatura em aberto entra só no previsto, no mês do vencimento (§4.7).
        for (const invoice of sources.openInvoices) {
            accumulate(invoice.billingCycle.dueDateOf(invoice.invoicePeriod).period, invoice.balance, false);
        }
        return new MonthlyMovement(currency, byPeriod);
    }

    /**
     * @param period Competência consultada.
     * @return O movimento do mês; zero quando nada acontece nele.
     */
    public of(period: YearMonth): BalancePair {
        return this.byPeriod.get(period.toString())?.movement ?? BalancePair.zero(this.currency);
    }

    /**
     * Competências com algum movimento. Existe para descobrir meses que precisam de um
     * extrato e ainda não têm — uma transferência que chega ou uma fatura que vence num mês
     * em que a conta não lançou nada.
     *
     * @return As competências, sem ordem garantida.
     */
    public periods(): readonly YearMonth[] {
        return Array.from(this.byPeriod.values(), (entry) => entry.period);
    }
}

/** Soma, por tipo, das transações de uma fatura. */
export interface InvoiceTypeTotals {
    readonly type: TransactionType;
    readonly value: Money;
    readonly charges: Money;
}

/**
 * Total de uma fatura com o sinal do efeito na conta que a quita.
 * Regra de negócio (Fatura): o total é a soma dos efeitos de **todas** as transações vivas
 * da fatura, pagas ou não — o pagamento da fatura é o vínculo com o extrato, não o `paid`
 * de cada compra. Negativo quando há valor a pagar; positivo quando estornos superam as
 * compras (database-design §4.7). Pagamentos parciais são transferências de valor negativo
 * e, pela regra de sinal, abatem o total.
 *
 * @param currency Moeda do perfil; dá o zero de uma fatura vazia.
 * @param totals Somas agregadas por tipo.
 * @return O total, arredondado para persistência.
 */
export function invoiceBalance(currency: Currency, totals: readonly InvoiceTypeTotals[]): Money {
    return totals
        .reduce((sum, item) => sum.add(originEffect(item.type, item.value, item.charges)), Money.zero(currency))
        .rounded();
}
