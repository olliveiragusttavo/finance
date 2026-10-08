import type { Currency } from './Currency.ts';
import { InvalidValueError } from './errors.ts';

/**
 * Maior valor absoluto que um valor monetário digitado pode ter: 1 trilhão
 * (`1.000.000.000.000,00`). Nenhuma finança pessoal chega perto disso, e o teto protege a
 * precisão: com os centavos são 15 dígitos significativos, exatamente o que o
 * `roundHalfAwayFromZero` lê com `toPrecision(15)`; acima disso o arredondamento passaria a
 * perder centavos. Também barra o texto com centenas de dígitos que o `Number` vira
 * `Infinity`.
 * Regra de negócio (Dinheiro): todo valor informado pelo usuário fica entre −1 trilhão e
 * 1 trilhão, inclusive.
 *
 * Vale nas fronteiras de entrada (`moneyField` e `parseMoneyInput`), não no `Money.of`:
 * somas e saldos acumulados são derivados e não podem lançar erro por passar do teto.
 */
export const MONEY_MAX_AMOUNT = 1_000_000_000_000;

/**
 * Valor monetário imutável na moeda do perfil. Nenhum `number` solto representa dinheiro
 * fora do Repository (backend-design §3.3): é aqui que vivem o arredondamento, a
 * comparação com epsilon e a proibição de somar moedas diferentes, num único lugar.
 *
 * O valor interno não é arredondado — arredondar acontece só nas fronteiras de
 * persistência e apresentação (`rounded`), nunca em valores intermediários acumulados
 * (database-design §3.7).
 */
export class Money {
    /**
     * @param amount Valor em unidades da moeda (não em centavos), possivelmente ainda não
     * arredondado; dinheiro é double por decisão deliberada (database-design §3.7).
     * @param currency Moeda do valor; carrega a precisão usada no arredondamento e no epsilon.
     */
    private constructor(public readonly amount: number, public readonly currency: Currency) {}

    /**
     * Cria um valor monetário. Rejeita `NaN` e infinitos porque um deles somado a um saldo
     * contamina toda a cadeia de fechamentos daquele mês em diante.
     *
     * @param amount Valor em unidades da moeda.
     * @param currency Moeda do perfil em que o valor está denominado.
     * @return O valor monetário, sem arredondamento.
     * @throws {InvalidValueError} Quando o valor não é um número finito.
     */
    public static of(amount: number, currency: Currency): Money {
        if (!Number.isFinite(amount)) {
            throw new InvalidValueError('amount', `valor monetário não finito: ${amount}`);
        }
        // Normaliza -0 para 0: um saldo "-0,00" na tela é um defeito visível e não um valor.
        return new Money(amount === 0 ? 0 : amount, currency);
    }

    /**
     * @param currency Moeda do zero; necessária porque nem o zero é somável entre moedas.
     * @return O valor zero na moeda informada.
     */
    public static zero(currency: Currency): Money {
        return new Money(0, currency);
    }

    /**
     * @param other Parcela a somar; precisa estar na mesma moeda.
     * @return A soma, sem arredondamento intermediário.
     * @throws {InvalidValueError} Quando as moedas diferem.
     */
    public add(other: Money): Money {
        this.assertSameCurrency(other);
        return Money.of(this.amount + other.amount, this.currency);
    }

    /**
     * @param other Valor a subtrair; precisa estar na mesma moeda.
     * @return A diferença, sem arredondamento intermediário.
     * @throws {InvalidValueError} Quando as moedas diferem.
     */
    public subtract(other: Money): Money {
        this.assertSameCurrency(other);
        return Money.of(this.amount - other.amount, this.currency);
    }

    /**
     * Multiplica por um fator de direção (±1). Existe para aplicar a regra de sinal do tipo
     * de transação sem que o chamador extraia o `amount` e reconstrua o valor.
     *
     * @param factor Fator escalar; na prática, `1` ou `-1`.
     * @return O valor multiplicado.
     */
    public times(factor: number): Money {
        return Money.of(this.amount * factor, this.currency);
    }

    /**
     * @return O valor com o sinal invertido.
     */
    public negate(): Money {
        return Money.of(-this.amount, this.currency);
    }

    /**
     * Arredonda na precisão da moeda, meio para longe do zero (`2,345 → 2,35`;
     * `-2,345 → -2,35`), o modo que o usuário espera de um extrato bancário. Só deve ser
     * chamado nas fronteiras de persistência e apresentação.
     *
     * @return O valor arredondado na precisão da moeda.
     */
    public rounded(): Money {
        return Money.of(roundHalfAwayFromZero(this.amount, this.currency.minorUnits), this.currency);
    }

    /**
     * Divide em partes iguais na precisão da moeda.
     * Regra de negócio (Parcelamento, database-design §4.12): cada parte é arredondada e **a
     * diferença do arredondamento vai para a primeira**, para que a soma das partes seja sempre
     * exatamente o total — R$ 1.000,00 em 3 é `333,34 + 333,33 + 333,33`. Trabalha em unidades
     * menores inteiras, e não em float, para que o resto não sofra erro binário.
     *
     * @param parts Quantidade de partes, inteira e positiva.
     * @return As partes, a primeira com o resto.
     * @throws {InvalidValueError} Quando `parts` não é um inteiro positivo.
     */
    public split(parts: number): readonly Money[] {
        if (!Number.isInteger(parts) || parts < 1) {
            throw new InvalidValueError('parts', `quantidade de partes inválida: ${parts}`);
        }
        const scale = 10 ** this.currency.minorUnits;
        const total = Math.round(roundHalfAwayFromZero(this.amount, this.currency.minorUnits) * scale);
        const share = Math.trunc(total / parts);
        const remainder = total - share * parts;
        return Array.from({ length: parts }, (_, index) => Money.of((index === 0 ? share + remainder : share) / scale, this.currency));
    }

    /**
     * Igualdade com epsilon de meia unidade mínima da moeda (`0,005` em BRL). É o único
     * comparador de dinheiro permitido: `===` entre doubles falharia para valores que o
     * usuário enxerga como iguais (backend-design §3.3).
     *
     * @param other Valor a comparar; precisa estar na mesma moeda.
     * @return `true` quando a diferença é menor que meia unidade mínima.
     * @throws {InvalidValueError} Quando as moedas diferem.
     */
    public equals(other: Money): boolean {
        this.assertSameCurrency(other);
        return Math.abs(this.amount - other.amount) < this.epsilon();
    }

    /**
     * @return `true` quando o valor é zero dentro do epsilon da moeda.
     */
    public isZero(): boolean {
        return Math.abs(this.amount) < this.epsilon();
    }

    /**
     * @return `true` quando o valor é negativo além do epsilon; usado para distinguir
     * fatura a pagar de fatura com crédito sem cair em ruído de float.
     */
    public isNegative(): boolean {
        return this.amount <= -this.epsilon();
    }

    /**
     * Representação decimal arredondada, para logs, testes e mensagens. A apresentação
     * localizada (R$ 1.234,56) é responsabilidade do pacote `client`, não do núcleo.
     *
     * @return O valor arredondado com as casas da moeda, ex.: `"-1234.50"`.
     */
    public toString(): string {
        return roundHalfAwayFromZero(this.amount, this.currency.minorUnits).toFixed(this.currency.minorUnits);
    }

    /**
     * @return Meia unidade mínima da moeda — o limite abaixo do qual dois valores são
     * indistinguíveis para o usuário.
     */
    private epsilon(): number {
        return 0.5 * 10 ** -this.currency.minorUnits;
    }

    /**
     * @param other Valor que vai participar de uma operação com este.
     * @return void
     * @throws {InvalidValueError} Quando as moedas diferem: somar BRL com USD sem conversão
     * produziria um número sem unidade, e todo valor do banco já está na moeda do perfil.
     */
    private assertSameCurrency(other: Money): void {
        if (!this.currency.equals(other.currency)) {
            throw new InvalidValueError('currency', `operação entre moedas diferentes: ${this.currency.code} e ${other.currency.code}`);
        }
    }
}

/**
 * Arredonda meio para longe do zero sobre a representação decimal mais curta do número
 * (`toPrecision(15)`), que é o valor que o usuário digitou. A alternativa óbvia,
 * `Math.round(x * 100) / 100`, erra `1,005` (o double guarda `1,00499999…`) e arredonda
 * negativos para o lado errado (backend-design §3.3). A soma do incremento é feita em
 * `BigInt` sobre os dígitos, para não reintroduzir o erro binário no último passo.
 *
 * @param value Valor a arredondar; finito.
 * @param decimals Casas decimais da moeda.
 * @return O valor arredondado.
 */
export function roundHalfAwayFromZero(value: number, decimals: number): number {
    if (value === 0) {
        return 0;
    }
    const negative = value < 0;
    const digits = Math.abs(value).toPrecision(15);
    if (digits.includes('e')) {
        // Notação exponencial só aparece fora de [1e-6, 1e15): abaixo disso o valor é menor
        // que meia unidade de qualquer moeda (no máximo 4 casas) e vira zero; acima, não há
        // fração representável no double e o valor já é inteiro.
        return Math.abs(value) < 1 ? 0 : value;
    }
    const [integerPart = '0', fractionPart = ''] = digits.split('.');
    if (fractionPart.length <= decimals) {
        return Number(digits) * (negative ? -1 : 1) || 0;
    }
    const kept = BigInt(integerPart + fractionPart.slice(0, decimals));
    const roundsUp = (fractionPart.charAt(decimals) >= '5');
    const scaled = (roundsUp ? kept + 1n : kept).toString().padStart(decimals + 1, '0');
    const text = decimals === 0
        ? scaled
        : `${scaled.slice(0, -decimals)}.${scaled.slice(-decimals)}`;
    const result = Number(text);
    return negative && result !== 0 ? -result : result;
}
