import { InvalidValueError } from './errors.ts';

/**
 * Moedas ISO 4217 cuja menor unidade não é o centésimo. O padrão é 2 casas, e só as
 * exceções são listadas: o sistema não se restringe a moedas de duas casas
 * (database-design §3.7), e a precisão errada arredondaria um saldo em iene para centavos
 * que não existem ou um saldo em dinar kuwaitiano para menos do que ele tem.
 */
const MINOR_UNIT_EXCEPTIONS: Readonly<Record<string, number>> = {
    BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0, RWF: 0,
    UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
    BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
    CLF: 4, UYW: 4,
};

const DEFAULT_MINOR_UNITS = 2;
const CODE_PATTERN = /^[A-Z]{3}$/;

/**
 * Moeda ISO 4217 com a precisão decimal que ela carrega. É um Value Object, e não um
 * `string`, porque a precisão é o que governa arredondamento e epsilon de comparação de
 * todo `Money` (backend-design §3.3): uma moeda sem precisão empurraria essa decisão para
 * cada ponto de chamada.
 */
export class Currency {
    private static readonly cache = new Map<string, Currency>();

    /**
     * @param code Código ISO 4217 em maiúsculas; é a identidade da moeda.
     * @param minorUnits Casas decimais da menor unidade; define arredondamento e epsilon.
     */
    private constructor(public readonly code: string, public readonly minorUnits: number) {}

    /**
     * Obtém a moeda de um código, reaproveitando a instância. O cache existe para que duas
     * moedas iguais sejam a mesma instância e a comparação de moedas de `Money` seja trivial.
     *
     * @param code Código ISO 4217 recebido (do perfil, da conta ou da entrada do usuário);
     * aceito em qualquer caixa porque o banco guarda maiúsculas (`ck_profiles_currency`).
     * @return A moeda com sua precisão decimal.
     * @throws {InvalidValueError} Quando o código não tem três letras.
     */
    public static of(code: string): Currency {
        const normalized = code.trim().toUpperCase();
        if (!CODE_PATTERN.test(normalized)) {
            throw new InvalidValueError('currency', `código ISO 4217 inválido: "${code}"`);
        }
        const cached = Currency.cache.get(normalized);
        if (cached !== undefined) {
            return cached;
        }
        const currency = new Currency(normalized, MINOR_UNIT_EXCEPTIONS[normalized] ?? DEFAULT_MINOR_UNITS);
        Currency.cache.set(normalized, currency);
        return currency;
    }

    /**
     * Compara pela identidade do código; existe para que nenhum chamador compare instâncias
     * ou strings por conta própria.
     *
     * @param other Moeda a comparar.
     * @return `true` quando as duas são a mesma moeda.
     */
    public equals(other: Currency): boolean {
        return this.code === other.code;
    }

    /**
     * @return O código ISO 4217; é a forma persistida e serializada da moeda.
     */
    public toString(): string {
        return this.code;
    }
}
