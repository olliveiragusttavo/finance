import { Currency, Money, type MoneyResponse } from '@finance/core';

/** Sinal de menos tipográfico (U+2212), o dos mockups; o hífen fica estreito e desalinha a coluna. */
export const MINUS = '−';

/**
 * Como o sinal aparece:
 * - `negative`: só `−` nos negativos — saldos e totais;
 * - `always`: `+` nos positivos e `−` nos negativos — entradas e saídas, que não podem
 *   depender só da cor (decisão de interface 7 dos mockups); o zero fica sem sinal;
 * - `absolute`: nunca — valor de fatura e gasto de relatório, mostrados em módulo.
 */
export type MoneySign = 'negative' | 'always' | 'absolute';

/** Símbolo das moedas mais comuns; as demais aparecem pelo código ISO (`CHF 10,00`). */
const SYMBOLS: Readonly<Record<string, string>> = { BRL: 'R$', USD: 'US$', EUR: '€', GBP: '£' };

/**
 * Formata dinheiro no padrão pt-BR dos mockups: `R$ 1.234,56`, `−R$ 1.234,56`, `+R$ 9.500,00`.
 * Não usa `Intl.NumberFormat` porque o resultado difere entre o Chromium e o Hermes do
 * mobile (desktop-shell-design §4.2): o mesmo saldo nunca pode aparecer de dois jeitos. O
 * arredondamento é o do `Money` — meio para longe do zero, na precisão da moeda —, o mesmo
 * da persistência, para que a tela nunca mostre um centavo diferente do banco.
 *
 * @param money Valor como veio do núcleo.
 * @param sign Regra do sinal; o padrão é a dos saldos.
 * @return O texto formatado, com espaço comum entre símbolo e número (como nos mockups).
 */
export function formatMoney(money: MoneyResponse, sign: MoneySign = 'negative'): string {
    const { negative, digits } = splitAmount(money.amount, money.currency);
    const prefix = signPrefix(negative, digits, sign);
    return `${prefix}${SYMBOLS[money.currency] ?? money.currency} ${digits}`;
}

/**
 * Valor para um campo de edição, sem símbolo: `1.234,56`, `-23,90`. O sinal é o hífen
 * comum, que o usuário digita no teclado e o `parseMoneyInput` lê de volta.
 *
 * @param money Valor como veio do núcleo.
 * @return O texto que o campo mostra ao abrir a edição.
 */
export function formatMoneyForInput(money: MoneyResponse): string {
    const { negative, digits } = splitAmount(money.amount, money.currency);
    return `${negative ? '-' : ''}${digits}`;
}

/**
 * @param amount Valor em unidades da moeda.
 * @param currencyCode Código ISO; define as casas decimais.
 * @return O sinal e os dígitos já arredondados e agrupados (`1.234,56`).
 */
function splitAmount(amount: number, currencyCode: string): { readonly negative: boolean; readonly digits: string } {
    // O `toString` do `Money` arredondado é a representação decimal exata ("-1234.50"); os
    // dígitos saem dela, e não de aritmética com float, para não reintroduzir o erro binário.
    const text = Money.of(amount, Currency.of(currencyCode)).rounded().toString();
    const negative = text.startsWith('-');
    const [integerPart = '0', fractionPart] = (negative ? text.slice(1) : text).split('.');
    const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return { negative, digits: fractionPart === undefined ? grouped : `${grouped},${fractionPart}` };
}

/**
 * @param negative Se o valor arredondado é negativo.
 * @param digits Dígitos formatados; zero não leva sinal em nenhuma regra.
 * @param sign Regra do sinal.
 * @return O prefixo de sinal.
 */
function signPrefix(negative: boolean, digits: string, sign: MoneySign): string {
    if (sign === 'absolute') {
        return '';
    }
    if (negative) {
        return MINUS;
    }
    return sign === 'always' && /[1-9]/.test(digits) ? '+' : '';
}
