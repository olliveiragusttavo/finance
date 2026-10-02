import { BillingCycle } from '../../domain/creditCard/BillingCycle.ts';
import { CreditCard } from '../../domain/creditCard/CreditCard.ts';
import { Currency } from '../../domain/shared/Currency.ts';
import { AccountId, CreditCardId, ProfileId } from '../../domain/shared/ids.ts';
import { Money } from '../../domain/shared/Money.ts';
import type { Database, SqlRow } from '../../ports/Database.ts';
import type { CreditCardRepository } from '../../repositories/CreditCardRepository.ts';
import { RowReader } from './RowReader.ts';

export const SELECT_CREDIT_CARD_COLUMNS = `
    c.id AS card_id, c.profile_id AS card_profile_id, c.account_id AS card_account_id,
    c.name AS card_name, c.limit_value AS card_limit, c.closing_date AS card_closing_day,
    c.due_date AS card_due_day
`;

/**
 * Hidrata um cartão a partir das colunas de `SELECT_CREDIT_CARD_COLUMNS`. É compartilhado
 * com o Repository de faturas, que lê fatura e cartão numa consulta só para obter o ciclo
 * de faturamento sem uma segunda ida ao banco por fatura.
 *
 * @param row Linha com as colunas prefixadas `card_`.
 * @param currency Moeda do perfil, em que o limite está denominado.
 * @return O cartão de domínio.
 */
export function toCreditCard(row: SqlRow, currency: Currency): CreditCard {
    const reader = new RowReader('credit_cards', row);
    return CreditCard.restore({
        id: CreditCardId(reader.text('card_id')),
        profileId: ProfileId(reader.text('card_profile_id')),
        accountId: AccountId(reader.text('card_account_id')),
        name: reader.text('card_name'),
        limit: Money.of(reader.number('card_limit'), currency),
        billingCycle: BillingCycle.of(reader.number('card_closing_day'), reader.number('card_due_day')),
    });
}

/** Implementação SQLite de `CreditCardRepository`. */
export class SqliteCreditCardRepository implements CreditCardRepository {
    /**
     * @param database Conexão compartilhada da unidade de trabalho.
     */
    public constructor(private readonly database: Database) {}

    /**
     * @param id Cartão procurado.
     * @return O cartão vivo, ou `null`.
     */
    public findById(id: CreditCardId): CreditCard | null {
        const row = this.database.get(
            `SELECT ${SELECT_CREDIT_CARD_COLUMNS}, p.currency AS profile_currency
            FROM credit_cards c
            JOIN profiles p ON p.id = c.profile_id
            WHERE c.id = :id AND c.deleted_at IS NULL`,
            { id },
        );
        if (row === undefined) {
            return null;
        }
        return toCreditCard(row, Currency.of(new RowReader('credit_cards', row).text('profile_currency')));
    }
}
