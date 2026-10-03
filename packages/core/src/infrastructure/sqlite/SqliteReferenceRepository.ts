import { ProfileId, type GoalId, type PartnerId } from '../../domain/shared/ids.ts';
import type { Database } from '../../ports/Database.ts';
import type { ReferenceRepository } from '../../repositories/ReferenceRepository.ts';
import { RowReader } from './RowReader.ts';

/** Implementação SQLite de `ReferenceRepository`. */
export class SqliteReferenceRepository implements ReferenceRepository {
    /**
     * @param database Conexão compartilhada da unidade de trabalho.
     */
    public constructor(private readonly database: Database) {}

    /**
     * @param id Sócio referenciado.
     * @return O perfil dono, ou `null`.
     */
    public partnerOwner(id: PartnerId): ProfileId | null {
        return this.owner('partners', 'SELECT profile_id FROM partners WHERE id = :id AND deleted_at IS NULL', id);
    }

    /**
     * @param id Meta referenciada.
     * @return O perfil dono, ou `null`.
     */
    public goalOwner(id: GoalId): ProfileId | null {
        return this.owner('goals', 'SELECT profile_id FROM goals WHERE id = :id AND deleted_at IS NULL', id);
    }

    /**
     * @param table Tabela consultada, para o erro de linha inválida.
     * @param sql Consulta que devolve `profile_id`.
     * @param id Id procurado.
     * @return O perfil dono, ou `null` quando a linha não existe ou está excluída.
     */
    private owner(table: string, sql: string, id: string): ProfileId | null {
        const row = this.database.get(sql, { id });
        return row === undefined ? null : ProfileId(new RowReader(table, row).text('profile_id'));
    }
}
