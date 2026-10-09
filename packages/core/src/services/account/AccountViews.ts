import type { Account } from '../../domain/account/Account.ts';
import type { BalancePair } from '../../domain/balance/BalancePair.ts';
import type { Profile } from '../../domain/profile/Profile.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';

/** Uma conta com o consolidado e o previsto do fechamento do mês pedido. */
export interface AccountInPeriod {
    readonly account: Account;
    readonly balances: BalancePair;
}

/**
 * Uma conta de outro perfil que pode receber uma transferência, com o perfil dono para a UI
 * dizer de quem é a conta — o nome sozinho é ambíguo ("Nubank" no pessoal e na empresa).
 */
export interface TransferTarget {
    readonly account: Account;
    readonly profile: Profile;
}

/**
 * A lista de contas de um mês, como a tela de Contas mostra. Fica fora do arquivo do
 * `AccountService` para que a camada DTO dependa só do contrato de saída.
 */
export interface AccountListView {
    readonly profile: Profile;
    readonly period: YearMonth;
    readonly accounts: readonly AccountInPeriod[];
    /** Soma só das contas com "considerar no saldo" ligado, desativadas incluídas. */
    readonly total: BalancePair;
}
