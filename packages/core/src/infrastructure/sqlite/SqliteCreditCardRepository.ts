import { BillingCycle } from '../../domain/creditCard/BillingCycle.ts';
import { CreditCard } from '../../domain/creditCard/CreditCard.ts';
import { Currency } from '../../domain/shared/Currency.ts';
import { AccountId, CreditCardId, ProfileId } from '../../domain/shared/ids.ts';
import { Money } from '../../domain/shared/Money.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { Database, SqlRow } from '../../ports/Database.ts';
import type { CreditCardRepository } from '../../repositories/CreditCardRepository.ts';
import { RowReader } from './RowReader.ts';

export const SELECT_CREDIT_CARD_COLUMNS = `
    c.id AS card_id, c.profile_id AS card_profile_id, c.account_id AS card_account_id,
    c.name AS card_name, c.limit_value AS card_limit, c.closing_date AS card_closing_day,
    c.due_date AS card_due_day, c.disabled_at AS card_disabled_at
`;

const SELECT_CREDIT_CARD = `
    SELECT ${SELECT_CREDIT_CARD_COLUMNS}, p.currency AS profile_currency
    FROM credit_cards c
    JOIN profiles p ON p.id = c.profile_id
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
        disabled: reader.nullableText('card_disabled_at') !== null,
    });
}

/** Implementação SQLite de `CreditCardRepository`. */
export class SqliteCreditCardRepository implements CreditCardRepository {
    /**
     * @param database Conexão compartilhada da unidade de trabalho.
     * @param clock Relógio que carimba `updated_at` e `disabled_at`.
     */
    public constructor(private readonly database: Database, private readonly clock: Clock) {}

    /**
     * @param id Cartão procurado.
     * @return O cartão vivo, ou `null`.
     */
    public findById(id: CreditCardId): CreditCard | null {
        const row = this.database.get(`${SELECT_CREDIT_CARD} WHERE c.id = :id AND c.deleted_at IS NULL`, { id });
        return row === undefined ? null : this.toCard(row);
    }

    /**
     * @param profileId Perfil dono dos cartões.
     * @return Os cartões vivos do perfil, por nome.
     */
    public listByProfile(profileId: ProfileId): readonly CreditCard[] {
        return this.database
            .all(`${SELECT_CREDIT_CARD} WHERE c.profile_id = :profileId AND c.deleted_at IS NULL ORDER BY c.name COLLATE NOCASE, c.id`, { profileId })
            .map((row) => this.toCard(row));
    }

    /**
     * Mesma regra de `disabled_at` do `SqliteAccountRepository.save`: o instante da primeira
     * desativação é preservado quando um cartão já desativado é regravado.
     *
     * @param creditCard Cartão a gravar.
     * @return void
     */
    public save(creditCard: CreditCard): void {
        this.database.run(
            `INSERT INTO credit_cards (id, profile_id, account_id, name, limit_value, closing_date, due_date, disabled_at, updated_at)
            VALUES (:id, :profileId, :accountId, :name, :limit, :closingDay, :dueDay, CASE WHEN :disabled = 1 THEN :now END, :now)
            ON CONFLICT (id) DO UPDATE SET account_id = excluded.account_id, name = excluded.name,
                limit_value = excluded.limit_value, closing_date = excluded.closing_date, due_date = excluded.due_date,
                disabled_at = CASE WHEN :disabled = 1 THEN COALESCE(credit_cards.disabled_at, excluded.disabled_at) END,
                updated_at = excluded.updated_at
            WHERE credit_cards.deleted_at IS NULL`,
            {
                id: creditCard.id,
                profileId: creditCard.profileId,
                accountId: creditCard.accountId,
                name: creditCard.name,
                limit: creditCard.limit.rounded().amount,
                closingDay: creditCard.billingCycle.closingDay,
                dueDay: creditCard.billingCycle.dueDay,
                disabled: creditCard.disabled ? 1 : 0,
                now: this.clock.now(),
            },
        );
    }

    /**
     * @param row Linha do `SELECT_CREDIT_CARD`.
     * @return O cartão de domínio, com o limite na moeda do perfil.
     */
    private toCard(row: SqlRow): CreditCard {
        return toCreditCard(row, Currency.of(new RowReader('credit_cards', row).text('profile_currency')));
    }
}
