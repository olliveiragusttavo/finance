import type { Money } from '../shared/Money.ts';

/** Tipo da transação (database-design §4.13). */
export type TransactionType = 'income' | 'expense' | 'transference' | 'investment';

export const TRANSACTION_TYPES: readonly TransactionType[] = ['income', 'expense', 'transference', 'investment'];

/**
 * Regra de negócio (Transferência): só transferências e investimentos têm conta de
 * destino — são os tipos que movem dinheiro entre duas contas do perfil
 * (database-design §4.13).
 *
 * @param type Tipo da transação.
 * @return `true` quando o tipo leva dinheiro a uma conta de destino.
 */
export function movesToDestination(type: TransactionType): boolean {
    return type === 'transference' || type === 'investment';
}

/**
 * Efeito de uma transação (ou de uma soma de transações do mesmo tipo) no saldo do
 * contêiner de **origem** — o extrato da conta ou a fatura do cartão.
 *
 * Regra de negócio (Transações): `value` é lançado positivo e o tipo dá a direção —
 * `income` soma; `expense`, `transference` e `investment` saem da origem; um `value`
 * negativo inverte o efeito (estorno, devolução) (database-design §4.13).
 * Regra de negócio (Encargos): `charges` — juros e tarifas — são **sempre custo da
 * origem**, em qualquer tipo: despesa 100 + 2 → −102; receita 1000 com tarifa 10 → +990;
 * transferência 500 + TED 8 → −508 na origem e +500 no destino (decisão do usuário,
 * registrada aqui por não constar dos documentos de design).
 *
 * A fórmula é linear em `value` e `charges`, e é isso que permite aplicá-la sobre somas
 * agregadas no SQL por tipo, em vez de transação a transação (backend-design §3.2).
 *
 * @param type Tipo da transação; decide a direção.
 * @param value Valor (ou soma de valores) já convertido para a moeda do perfil.
 * @param charges Encargos (ou soma de encargos) na moeda do perfil.
 * @return O efeito no saldo da origem.
 */
export function originEffect(type: TransactionType, value: Money, charges: Money): Money {
    const direction = type === 'income' ? 1 : -1;
    return value.times(direction).subtract(charges);
}

/**
 * Efeito no saldo da conta de **destino** de uma transferência ou investimento.
 * Regra de negócio (Transferência): uma transferência é uma linha só, que sai da origem e
 * entra no destino com o mesmo valor; os encargos ficam na origem (database-design §4.13).
 * Um valor negativo inverte a direção — é assim que o pagamento parcial de fatura tira
 * dinheiro da conta que pagou (§4.7).
 *
 * @param value Valor (ou soma de valores) da transferência.
 * @return O efeito no saldo do destino.
 */
export function destinationEffect(value: Money): Money {
    return value;
}
