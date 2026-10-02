import type { Money } from '../../domain/shared/Money.ts';

/**
 * Dinheiro arredondado na precisão da moeda, pronto para formatar. Existe porque `Money` é
 * classe e perderia os métodos ao cruzar o IPC do desktop.
 */
export interface MoneyResponse {
    readonly amount: number;
    readonly currency: string;
}

/**
 * Arredonda aqui porque a fronteira de apresentação é um dos dois únicos pontos onde se
 * arredonda (database-design §3.7) — dentro do núcleo os cálculos seguem sem arredondar para
 * não acumular erro entre somas.
 *
 * @param money Valor do domínio; é a fonte do montante e da moeda que a UI vai formatar.
 * @return O valor arredondado na precisão da moeda, com o código ISO da moeda.
 */
export function toMoneyResponse(money: Money): MoneyResponse {
    return { amount: money.rounded().amount, currency: money.currency.code };
}
