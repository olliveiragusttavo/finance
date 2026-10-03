import { Currency, Money } from '@finance/core';

/** Resultado da leitura de um valor digitado. */
export type MoneyInputResult =
    | { readonly ok: true; readonly amount: number }
    | { readonly ok: false; readonly reason: 'empty' | 'invalid' };

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
 *
 * @param text Texto do campo, como digitado; espaços são ignorados.
 * @param currencyCode Moeda do perfil; define as casas decimais do arredondamento.
 * @return O valor lido, ou o motivo da recusa: `empty` para o campo vazio, que o formulário
 * trata como "obrigatório", e `invalid` para o resto.
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
    const amount = Money.of(negative ? -magnitude : magnitude, Currency.of(currencyCode)).rounded().amount;
    return { ok: true, amount };
}
