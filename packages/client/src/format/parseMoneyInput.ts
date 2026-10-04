import { Currency, MONEY_MAX_AMOUNT, Money } from '@finance/core';

/**
 * Motivo da recusa de um valor digitado. `tooLarge` é separado de `invalid` porque o texto
 * está bem escrito e o formulário precisa dizer o teto, não pedir outro formato.
 */
export type MoneyInputRejection = 'empty' | 'invalid' | 'tooLarge';

/** Resultado da leitura de um valor digitado. */
export type MoneyInputResult =
    | { readonly ok: true; readonly amount: number }
    | { readonly ok: false; readonly reason: MoneyInputRejection };

/**
 * Sinal opcional (hífen, `−` ou `+`), símbolo opcional e o número pt-BR: milhar com ponto em
 * grupos de três (`1.234`) ou sem separador (`1234`), decimais depois da vírgula. Ponto como
 * decimal é recusado de propósito: em pt-BR `1.500` é mil e quinhentos, e aceitar `1.5` como
 * um e meio tornaria a mesma tecla ambígua.
 */
const INPUT_PATTERN = /^([+\-−]?)(?:R\$|US\$|€|£)?([+\-−]?)(\d{1,3}(?:\.\d{3})+|\d*)(?:,(\d*))?$/;

/**
 * Lê o valor que o usuário digitou num campo de dinheiro (`1.234,56`, `-23,90`, `R$ 10`).
 * Casas além das da moeda são arredondadas pela mesma regra do `Money` (meio para longe do
 * zero), para que o valor confirmado no formulário seja exatamente o que o núcleo grava.
 * Regra de negócio (Dinheiro): o valor fica entre −1 trilhão e 1 trilhão (`MONEY_MAX_AMOUNT`),
 * o mesmo teto do `moneyField`, para o formulário recusar antes de o núcleo recusar.
 *
 * @param text Texto do campo, como digitado; espaços são ignorados.
 * @param currencyCode Moeda do perfil; define as casas decimais do arredondamento.
 * @return O valor lido, ou o motivo da recusa: `empty` para o campo vazio, que o formulário
 * trata como "obrigatório", `tooLarge` para o valor além do teto e `invalid` para o resto.
 */
export function parseMoneyInput(text: string, currencyCode: string): MoneyInputResult {
    const compact = text.replace(/\s/g, '');
    if (compact === '') {
        return { ok: false, reason: 'empty' };
    }
    const match = INPUT_PATTERN.exec(compact);
    const [, signBefore = '', signAfter = '', integerPart = '', fractionPart = ''] = match ?? [];
    if (match === null || (signBefore !== '' && signAfter !== '') || (integerPart === '' && fractionPart === '')) {
        return { ok: false, reason: 'invalid' };
    }
    const sign = signBefore + signAfter;
    const negative = sign === '-' || sign === '−';
    const magnitude = Number(`${integerPart.replaceAll('.', '') || '0'}.${fractionPart || '0'}`);
    // Checado antes do `Money.of`: texto com centenas de dígitos vira `Infinity`, que ele recusa
    // lançando erro em vez de devolver um motivo que o formulário saiba mostrar.
    if (magnitude > MONEY_MAX_AMOUNT) {
        return { ok: false, reason: 'tooLarge' };
    }
    const amount = Money.of(negative ? -magnitude : magnitude, Currency.of(currencyCode)).rounded().amount;
    return { ok: true, amount };
}
