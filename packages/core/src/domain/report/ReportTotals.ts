import type { BalancePair } from '../balance/BalancePair.ts';
import type { AccountId, CategoryId, CreditCardId, InvoiceId, SubCategoryId } from '../shared/ids.ts';
import type { Money } from '../shared/Money.ts';
import type { YearMonth } from '../shared/YearMonth.ts';
import { originEffect } from '../transaction/TransactionType.ts';

/**
 * Somas de receitas ou despesas de um mês de pagamento. O período já é o do critério de
 * caixa (reports-design §2): quem agrega é o SQL, o núcleo só aplica a regra de sinal.
 */
export interface CashFlowTotals {
    readonly period: YearMonth;
    readonly type: 'income' | 'expense';
    readonly value: Money;
    readonly charges: Money;
    readonly count: number;
}

/** Somas das despesas de uma subcategoria num mês de pagamento. */
export interface SubCategoryExpenseTotals {
    readonly period: YearMonth;
    readonly categoryId: CategoryId;
    readonly categoryName: string;
    readonly subCategoryId: SubCategoryId;
    readonly subCategoryName: string;
    readonly value: Money;
    readonly charges: Money;
    readonly count: number;
}

/** Uma fatura com o mês em que pesa no caixa e as somas das suas despesas. */
export interface InvoiceExpenseTotals {
    readonly invoiceId: InvoiceId;
    readonly creditCardId: CreditCardId;
    readonly invoicePeriod: YearMonth;
    /** Mês do extrato em que foi paga, ou o do vencimento quando está em aberto. */
    readonly paymentPeriod: YearMonth;
    readonly paid: boolean;
    /** Cache do total com o sinal do efeito na conta, já líquido dos pagamentos parciais. */
    readonly balance: Money;
    readonly expenseValue: Money;
    readonly expenseCharges: Money;
}

/** Fechamentos de uma conta lidos dos extratos já calculados. */
export interface AccountClosingHistory {
    readonly accountId: AccountId;
    /** Saldo antes do primeiro extrato — o `opening_balance` da conta. */
    readonly opening: BalancePair;
    /** Extratos vivos da janela pedida, mais o último anterior a ela, em ordem cronológica. */
    readonly statements: readonly { readonly period: YearMonth; readonly closing: BalancePair }[];
}

/**
 * Quanto uma soma de despesas tirou do caixa, em positivo.
 * Regra de negócio (Relatórios, R3): encargos entram, pelo **mesmo cálculo do efeito no
 * saldo** (`originEffect`: valor + encargos) — o relatório não reimplementa a regra de
 * sinal; um estorno (valor negativo) abate o total.
 *
 * @param value Soma dos valores das despesas.
 * @param charges Soma dos encargos das despesas.
 * @return O gasto, positivo quando houve saída líquida.
 */
export function expenseOutflow(value: Money, charges: Money): Money {
    return originEffect('expense', value, charges).negate();
}

/**
 * Quanto uma soma de receitas trouxe ao caixa, pelo mesmo efeito no saldo: tarifas sobre a
 * receita a reduzem (database-design §4.13, Encargos).
 *
 * @param value Soma dos valores das receitas.
 * @param charges Soma dos encargos das receitas.
 * @return A entrada líquida.
 */
export function incomeInflow(value: Money, charges: Money): Money {
    return originEffect('income', value, charges);
}
