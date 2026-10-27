import type { Money } from '../../domain/shared/Money.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';
import type { Transaction } from '../../domain/transaction/Transaction.ts';

/** As entradas do mês sem sócio, para a lista do relatório por sócio. */
export interface EntriesWithoutPartnerView {
    readonly period: YearMonth;
    /** Receitas do perfil e transferências vindas de outro perfil (linhas do perfil de origem). */
    readonly transactions: readonly Transaction[];
    /** O que entrou no saldo, pela mesma regra do indicador "Entradas sem sócio". */
    readonly total: Money;
}
