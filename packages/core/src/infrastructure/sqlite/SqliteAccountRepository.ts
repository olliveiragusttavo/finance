import { Account } from '../../domain/account/Account.ts';
import { BalancePair } from '../../domain/balance/BalancePair.ts';
import { Currency } from '../../domain/shared/Currency.ts';
import { AccountId, ProfileId } from '../../domain/shared/ids.ts';
import { Money } from '../../domain/shared/Money.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { Database, SqlRow } from '../../ports/Database.ts';
import type { AccountRepository } from '../../repositories/AccountRepository.ts';
import { ACCOUNT_TYPE_CODE, decodeEnum } from './enumCodes.ts';
import { RowReader } from './RowReader.ts';

// A moeda dos saldos é a do perfil, não `accounts.currency`, que é só rótulo
// (database-design §3.7) — por isso o join com `profiles` em toda leitura.
const SELECT_ACCOUNT = `
    SELECT a.id, a.profile_id, a.name, a.type, a.currency, a.consider_balance,
        a.opening_balance, a.balance, a.projected_balance, a.disabled_at, p.currency AS profile_currency
    FROM accounts a
    JOIN profiles p ON p.id = a.profile_id
`;

/** Implementação SQLite de `AccountRepository`. */
export class SqliteAccountRepository implements AccountRepository {
    /**
     * @param database Conexão compartilhada da unidade de trabalho.
     * @param clock Relógio que carimba `updated_at`; a aplicação carimba, não um trigger
     * (database-design §3.6).
     */
    public constructor(private readonly database: Database, private readonly clock: Clock) {}

    /**
     * @param id Conta procurada.
     * @return A conta viva, ou `null`.
     */
    public findById(id: AccountId): Account | null {
        const row = this.database.get(`${SELECT_ACCOUNT} WHERE a.id = :id AND a.deleted_at IS NULL`, { id });
        return row === undefined ? null : this.toAccount(row);
    }

    /**
     * @param profileId Perfil dono das contas.
     * @return As contas vivas do perfil, por nome.
     */
    public listByProfile(profileId: ProfileId): readonly Account[] {
        return this.database
            .all(`${SELECT_ACCOUNT} WHERE a.profile_id = :profileId AND a.deleted_at IS NULL ORDER BY a.name COLLATE NOCASE, a.id`, { profileId })
            .map((row) => this.toAccount(row));
    }

    /**
     * @return As contas vivas dos perfis vivos, por id.
     */
    public listAll(): readonly Account[] {
        return this.database
            .all(`${SELECT_ACCOUNT} WHERE a.deleted_at IS NULL AND p.deleted_at IS NULL ORDER BY a.id`)
            .map((row) => this.toAccount(row));
    }

    /**
     * Na inserção grava o cache da conta nova (igual ao saldo inicial); na atualização, o
     * `DO UPDATE` lista só colunas do usuário, para que o cache nunca seja sobrescrito por
     * uma edição de cadastro. `disabled_at` guarda o instante da primeira desativação: uma
     * conta já desativada que é regravada mantém a data original.
     *
     * @param account Conta a gravar.
     * @return void
     */
    public save(account: Account): void {
        this.database.run(
            `INSERT INTO accounts (id, profile_id, name, balance, projected_balance, opening_balance, currency,
                consider_balance, type, disabled_at, updated_at)
            VALUES (:id, :profileId, :name, :balance, :projected, :opening, :currency,
                :considerBalance, :type, CASE WHEN :disabled = 1 THEN :now END, :now)
            ON CONFLICT (id) DO UPDATE SET name = excluded.name, opening_balance = excluded.opening_balance,
                currency = excluded.currency, consider_balance = excluded.consider_balance, type = excluded.type,
                disabled_at = CASE WHEN :disabled = 1 THEN COALESCE(accounts.disabled_at, excluded.disabled_at) END,
                updated_at = excluded.updated_at
            WHERE accounts.deleted_at IS NULL`,
            {
                id: account.id,
                profileId: account.profileId,
                name: account.name,
                balance: account.balances.consolidated.rounded().amount,
                projected: account.balances.projected.rounded().amount,
                opening: account.openingBalance.rounded().amount,
                currency: account.currencyLabel,
                considerBalance: account.considerBalance ? 1 : 0,
                type: ACCOUNT_TYPE_CODE[account.type],
                disabled: account.disabled ? 1 : 0,
                now: this.clock.now(),
            },
        );
    }

    /**
     * @param account Conta com o cache recalculado.
     * @return void
     */
    public saveBalances(account: Account): void {
        this.database.run(
            'UPDATE accounts SET balance = :balance, projected_balance = :projected, updated_at = :now WHERE id = :id',
            {
                id: account.id,
                balance: account.balances.consolidated.rounded().amount,
                projected: account.balances.projected.rounded().amount,
                now: this.clock.now(),
            },
        );
    }

    /**
     * @param row Linha do `SELECT_ACCOUNT`.
     * @return A conta de domínio.
     */
    private toAccount(row: SqlRow): Account {
        const reader = new RowReader('accounts', row);
        const currency = Currency.of(reader.text('profile_currency'));
        return Account.restore({
            id: AccountId(reader.text('id')),
            profileId: ProfileId(reader.text('profile_id')),
            name: reader.text('name'),
            type: decodeEnum(ACCOUNT_TYPE_CODE, reader.number('type'), 'accounts'),
            currencyLabel: reader.text('currency'),
            considerBalance: reader.boolean('consider_balance'),
            openingBalance: Money.of(reader.number('opening_balance'), currency),
            disabled: reader.nullableText('disabled_at') !== null,
            balances: BalancePair.of(
                Money.of(reader.number('balance'), currency),
                Money.of(reader.number('projected_balance'), currency),
            ),
        });
    }
}
