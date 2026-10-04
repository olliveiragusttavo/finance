import { z } from 'zod';
import { DomainError } from '../domain/shared/errors.ts';
import { LocalDate } from '../domain/shared/LocalDate.ts';
import { MONEY_MAX_AMOUNT } from '../domain/shared/Money.ts';
import { REGISTRY_NAME_MAX_LENGTH } from '../domain/shared/names.ts';
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
 * Valor monetário digitado. Exige número finito dentro do teto do `MONEY_MAX_AMOUNT`, nos dois
 * sentidos: o sinal é livre porque o negativo é estorno ou devolução (database-design §4.13),
 * e o arredondamento acontece na persistência, na precisão da moeda do perfil, que a Request
 * não conhece.
 * Regra de negócio (Dinheiro): todo valor informado fica entre −1 trilhão e 1 trilhão.
 */
export const moneyField = z.number().min(-MONEY_MAX_AMOUNT).max(MONEY_MAX_AMOUNT);

/** Código ISO 4217 de três letras; a caixa é normalizada pelo `Currency`. */
export const currencyCodeField = z.string().regex(/^[A-Za-z]{3}$/, 'código ISO 4217 de três letras');

/**
 * Nome de cadastro (perfil, conta, cartão, categoria). Repete o limite do domínio só por
 * conforto do formulário — a UI valida antes de chamar a rota —; a regra continua sendo a
 * do `requireName`, que é quem o Service aplica.
 */
export const registryNameField = z.string().trim().min(1).max(REGISTRY_NAME_MAX_LENGTH);

/** Dia do mês do ciclo do cartão; o `BillingCycle` repete a checagem no domínio. */
export const dayOfMonthField = z.number().int().min(1).max(31);
