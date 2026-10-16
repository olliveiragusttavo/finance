import type { BalancePair } from '../balance/BalancePair.ts';
import type { AccountId, CategoryId, CreditCardId, InvoiceId, PartnerId, SubCategoryId, TagId } from '../shared/ids.ts';
import type { LocalDate } from '../shared/LocalDate.ts';
import type { Money } from '../shared/Money.ts';
import type { YearMonth } from '../shared/YearMonth.ts';
import { originEffect } from '../transaction/TransactionType.ts';

/**
 * Somas de receitas ou despesas de um mês de pagamento. O período já é o do critério de
 * caixa (reports-design §2): quem agrega é o SQL, o núcleo só aplica a regra de sinal. As
 * transferências entre perfis chegam aqui já como receita (no destino) ou despesa (na origem).
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

/**
 * Somas de receitas ou despesas de uma tag numa categoria, no período pedido do relatório por
 * tag. Por categoria, e não só por tag, para que a divisão da tela e o total saiam da mesma
 * consulta e nunca discordem.
 */
export interface TagCategoryTotals {
    readonly tagId: TagId;
    readonly tagName: string;
    readonly categoryId: CategoryId;
    readonly categoryName: string;
    readonly type: 'income' | 'expense';
    readonly value: Money;
    readonly charges: Money;
    readonly count: number;
    /** Primeiro e último mês de pagamento dos lançamentos somados. */
    readonly firstPeriod: YearMonth;
    readonly lastPeriod: YearMonth;
}

/**
 * Somas das entradas de um perfil empresarial por sócio que aportou — receitas do perfil e
 * transferências que chegam de outro perfil, pelo efeito no saldo (a receita sem os encargos, a
 * transferência pelo valor). `partnerId` nulo junta as entradas sem sócio atribuído — inclusive as
 * de um sócio excluído, porque o vínculo morto não diz mais quem aportou (reports-design §8).
 */
export interface PartnerContributionTotals {
    readonly partnerId: PartnerId | null;
    /** Soma de todos os períodos. */
    readonly total: Money;
    readonly count: number;
    /** A parte do mês de referência. */
    readonly month: Money;
    readonly monthCount: number;
}

/** Uma fatura com o mês em que pesa no caixa e as somas das suas despesas. */
export interface InvoiceExpenseTotals {
    readonly invoiceId: InvoiceId;
    readonly creditCardId: CreditCardId;
    readonly invoicePeriod: YearMonth;
    /** Mês do extrato em que foi paga, ou o do vencimento quando está em aberto. */
    readonly paymentPeriod: YearMonth;
    readonly paid: boolean;
    /**
     * Dia em que a fatura paga foi paga; `null` em aberto e nas faturas pagas antes da migration
     * `0003`, que não gravavam o dia — aí só o mês do extrato é conhecido.
     */
    readonly paymentDate: LocalDate | null;
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
