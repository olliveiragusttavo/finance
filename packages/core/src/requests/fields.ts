import { z } from 'zod';
import { DomainError } from '../domain/shared/errors.ts';
import { LocalDate } from '../domain/shared/LocalDate.ts';
import { YearMonth } from '../domain/shared/YearMonth.ts';

/**
 * Campo texto convertido por um parser do domínio. Existe para que a camada Request não
 * reimplemente a validação de datas, competências e ids: o Value Object é a única fonte da
 * regra, e o erro dele vira um problema de validação do campo, não uma exceção.
 *
 * @param parse Parser do domínio (ex.: `LocalDate.parse`, `AccountId`).
 * @return Schema que valida e converte o texto no tipo do domínio.
 */
export function parsedText<T>(parse: (raw: string) => T): z.ZodType<T, string> {
    return z.string().transform((raw, context) => {
        try {
            return parse(raw);
        } catch (error) {
            if (error instanceof DomainError) {
                context.addIssue({ code: 'custom', message: error.message });
                return z.NEVER;
            }
            throw error;
        }
    });
}

/** Data `YYYY-MM-DD` do calendário do usuário. */
export const localDateField = parsedText((raw) => LocalDate.parse(raw));

/** Competência `YYYY-MM`. */
export const yearMonthField = parsedText((raw) => YearMonth.parse(raw));

/**
 * Valor monetário digitado. Só exige número finito: o sinal é livre porque o negativo é
 * estorno ou devolução (database-design §4.13), e o arredondamento acontece na
 * persistência, na precisão da moeda do perfil, que a Request não conhece.
 */
export const moneyField = z.number();

/** Código ISO 4217 de três letras; a caixa é normalizada pelo `Currency`. */
export const currencyCodeField = z.string().regex(/^[A-Za-z]{3}$/, 'código ISO 4217 de três letras');
