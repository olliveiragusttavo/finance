import { Profile } from '../../domain/profile/Profile.ts';
import { Currency } from '../../domain/shared/Currency.ts';
import { ProfileId } from '../../domain/shared/ids.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { Database, SqlRow } from '../../ports/Database.ts';
import type { ProfileRepository } from '../../repositories/ProfileRepository.ts';
import { decodeEnum, PROFILE_TYPE_CODE } from './enumCodes.ts';
import { RowReader } from './RowReader.ts';

const SELECT_PROFILE = 'SELECT id, name, type, currency FROM profiles';

/** Implementação SQLite de `ProfileRepository`. */
export class SqliteProfileRepository implements ProfileRepository {
    /**
     * @param database Conexão compartilhada com os demais Repositories, para que todos
     * participem da mesma unidade de trabalho.
     * @param clock Relógio que carimba `updated_at`; a aplicação carimba, não um trigger
     * (database-design §3.6).
     */
    public constructor(private readonly database: Database, private readonly clock: Clock) {}

    /**
     * @param id Perfil procurado.
     * @return O perfil vivo, ou `null`.
     */
    public findById(id: ProfileId): Profile | null {
        const row = this.database.get(`${SELECT_PROFILE} WHERE id = :id AND deleted_at IS NULL`, { id });
        return row === undefined ? null : this.toProfile(row);
    }

    /**
     * @return Os perfis vivos, por nome.
     */
    public list(): readonly Profile[] {
        return this.database
            .all(`${SELECT_PROFILE} WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE, id`)
            .map((row) => this.toProfile(row));
    }

    /**
     * O `ON CONFLICT` só alcança linhas vivas: o Service nunca grava um perfil que não leu
     * vivo, e reviver um perfil excluído não é caso de uso.
     *
     * @param profile Perfil a gravar.
     * @return void
     */
    public save(profile: Profile): void {
        this.database.run(
            `INSERT INTO profiles (id, name, type, currency, updated_at)
            VALUES (:id, :name, :type, :currency, :now)
            ON CONFLICT (id) DO UPDATE SET name = excluded.name, type = excluded.type,
                currency = excluded.currency, updated_at = excluded.updated_at
            WHERE profiles.deleted_at IS NULL`,
            {
                id: profile.id,
                name: profile.name,
                type: PROFILE_TYPE_CODE[profile.type],
                currency: profile.currency.code,
                now: this.clock.now(),
            },
        );
    }

    /**
     * Segue o mesmo caminho de posse do `SqliteTransactionRepository` — a transação não tem
     * `profile_id`, o perfil vem do contêiner vivo. Conta também a transferência que **chega**
     * de outro perfil: o valor dela está gravado na moeda comum aos dois perfis, e trocar a
     * moeda deste mudaria a unidade do que ela somou ao saldo daqui.
     *
     * @param id Perfil consultado.
     * @return `true` quando há ao menos uma transação viva do perfil, ou que chega a uma conta dele.
     */
    public hasTransactions(id: ProfileId): boolean {
        const row = this.database.get(
            `SELECT 1 AS found FROM transactions t
            LEFT JOIN bank_statements bs ON bs.id = t.bank_statement_id AND bs.deleted_at IS NULL
            LEFT JOIN accounts a ON a.id = bs.account_id
            LEFT JOIN invoices i ON i.id = t.invoice_id AND i.deleted_at IS NULL
            LEFT JOIN credit_cards c ON c.id = i.credit_card_id
            LEFT JOIN accounts da ON da.id = t.destination_account_id AND da.deleted_at IS NULL
            WHERE t.deleted_at IS NULL AND (COALESCE(a.profile_id, c.profile_id) = :id OR da.profile_id = :id)
            LIMIT 1`,
            { id },
        );
        return row !== undefined;
    }

    /**
     * @param row Linha do `SELECT_PROFILE`.
     * @return O perfil de domínio.
     */
    private toProfile(row: SqlRow): Profile {
        const reader = new RowReader('profiles', row);
        return Profile.restore({
            id: ProfileId(reader.text('id')),
            name: reader.text('name'),
            type: decodeEnum(PROFILE_TYPE_CODE, reader.number('type'), 'profiles'),
            currency: Currency.of(reader.text('currency')),
        });
    }
}
