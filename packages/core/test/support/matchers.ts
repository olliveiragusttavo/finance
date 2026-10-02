import { expect } from 'vitest';
import { Currency, Money } from '../../src/index.ts';

interface MoneyMatchers<R = unknown> {
    /**
     * Compara dinheiro com o epsilon da moeda, usando o mesmo `Money.equals` de produção.
     * `toBe` em dinheiro compararia doubles por igualdade exata (backend-design §5.8).
     *
     * @param expected Valor esperado como string decimal — o que um humano conferiria no extrato.
     */
    toEqualMoney: (expected: string) => R;
}

declare module 'vitest' {
    // A assinatura precisa ser idêntica à do Vitest 5 para a fusão de declarações funcionar.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars -- extensão de interface exigida pela API de matchers do Vitest.
    interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> extends MoneyMatchers<R> {}
}

/**
 * Normaliza o que o teste passa — `Money` do domínio ou `MoneyResponse` da rota — para `Money`.
 *
 * @param received Valor recebido pelo matcher.
 * @return O valor como `Money`, ou `null` quando não é dinheiro.
 */
function asMoney(received: unknown): Money | null {
    if (received instanceof Money) {
        return received;
    }
    if (typeof received === 'object' && received !== null && 'amount' in received && 'currency' in received) {
        const { amount, currency } = received;
        if (typeof amount === 'number' && typeof currency === 'string') {
            return Money.of(amount, Currency.of(currency));
        }
    }
    return null;
}

expect.extend({
    /**
     * @param received Dinheiro produzido pelo código.
     * @param expected Valor esperado como string decimal.
     * @return O resultado do matcher para o Vitest.
     */
    toEqualMoney(received: unknown, expected: string) {
        const money = asMoney(received);
        if (money === null) {
            return { pass: false, message: () => `esperado dinheiro, recebido ${JSON.stringify(received)}` };
        }
        const pass = money.equals(Money.of(Number(expected), money.currency));
        return {
            pass,
            message: () => `esperado ${money.currency.code} ${expected}${pass ? ' (negado)' : ''}, recebido ${money.toString()}`,
        };
    },
});
