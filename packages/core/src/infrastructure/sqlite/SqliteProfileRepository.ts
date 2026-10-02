import { Profile } from '../../domain/profile/Profile.ts';
import { Currency } from '../../domain/shared/Currency.ts';
import { ProfileId } from '../../domain/shared/ids.ts';
import type { Database } from '../../ports/Database.ts';
import type { ProfileRepository } from '../../repositories/ProfileRepository.ts';
import { decodeEnum, PROFILE_TYPE_CODE } from './enumCodes.ts';
import { RowReader } from './RowReader.ts';

/** Implementação SQLite de `ProfileRepository`. */
export class SqliteProfileRepository implements ProfileRepository {
    /**
     * @param database Conexão compartilhada com os demais Repositories, para que todos
     * participem da mesma unidade de trabalho.
     */
    public constructor(private readonly database: Database) {}

    /**
     * @param id Perfil procurado.
     * @return O perfil vivo, ou `null`.
     */
    public findById(id: ProfileId): Profile | null {
        const row = this.database.get(
            'SELECT id, name, type, currency FROM profiles WHERE id = :id AND deleted_at IS NULL',
            { id },
        );
        if (row === undefined) {
            return null;
        }
        const reader = new RowReader('profiles', row);
        return Profile.restore({
            id: ProfileId(reader.text('id')),
            name: reader.text('name'),
            type: decodeEnum(PROFILE_TYPE_CODE, reader.number('type'), 'profiles'),
            currency: Currency.of(reader.text('currency')),
        });
    }
}
