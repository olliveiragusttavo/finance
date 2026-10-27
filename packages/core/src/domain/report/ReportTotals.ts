import type { BalancePair } from '../balance/BalancePair.ts';
import type { AccountId, PartnerId } from '../shared/ids.ts';
import type { Money } from '../shared/Money.ts';
import type { YearMonth } from '../shared/YearMonth.ts';

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

/** Uma soma de um mês. */
export interface MonthAmount {
    readonly period: YearMonth;
    readonly amount: Money;
}

/** Fechamentos de uma conta lidos dos extratos já calculados. */
export interface AccountClosingHistory {
    readonly accountId: AccountId;
    /** Saldo antes do primeiro extrato — o `opening_balance` da conta. */
    readonly opening: BalancePair;
    /** Extratos vivos da janela pedida, mais o último anterior a ela, em ordem cronológica. */
    readonly statements: readonly { readonly period: YearMonth; readonly closing: BalancePair }[];
}
