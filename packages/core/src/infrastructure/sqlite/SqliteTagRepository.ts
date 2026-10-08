import { ProfileId, TagId } from '../../domain/shared/ids.ts';
import { LocalDate } from '../../domain/shared/LocalDate.ts';
import { Tag } from '../../domain/tag/Tag.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { Database, SqlRow } from '../../ports/Database.ts';
import type { TagRepository, TagUsageRow } from '../../repositories/TagRepository.ts';
import { RowReader } from './RowReader.ts';

const SELECT_TAG = 'SELECT g.id, g.profile_id, g.name FROM tags g';

/** Implementação SQLite de `TagRepository`. */
export class SqliteTagRepository implements TagRepository {
    /**
     * @param database Conexão compartilhada da unidade de trabalho.
     * @param clock Relógio que carimba `updated_at` e `deleted_at`.
     */
    public constructor(private readonly database: Database, private readonly clock: Clock) {}

    /**
     * @param id Tag procurada.
     * @return A tag viva, ou `null`.
     */
    public findById(id: TagId): Tag | null {
        const row = this.database.get(`${SELECT_TAG} WHERE g.id = :id AND g.deleted_at IS NULL`, { id });
        return row === undefined ? null : this.toTag(row);
    }

    /**
     * @param profileId Perfil dono.
     * @return As tags vivas do perfil, por nome.
     */
    public listByProfile(profileId: ProfileId): readonly Tag[] {
        return this.database
            .all(`${SELECT_TAG} WHERE g.profile_id = :profileId AND g.deleted_at IS NULL ORDER BY g.name COLLATE NOCASE, g.id`, { profileId })
            .map((row) => this.toTag(row));
    }

    /**
     * Conta só vínculos vivos com transações vivas, que são os que o usuário enxerga; uma
     * transação excluída deixa de pesar na tag.
     * Regra de negócio (Tags): o total é a soma dos valores **em módulo**, de qualquer tipo
     * de lançamento — a tag cruza receitas e despesas, e com sinal uma viagem paga com um
     * reembolso somaria perto de zero e esconderia o quanto passou pela tag. Encargos ficam
     * fora: são custo do meio de pagamento, não do assunto da tag.
     *
     * @param profileId Perfil dono.
     * @return O uso de cada tag do perfil que tem lançamentos.
     */
    public usage(profileId: ProfileId): ReadonlyMap<TagId, TagUsageRow> {
        const rows = this.database.all(
            `SELECT tt.tag_id, COUNT(t.id) AS transaction_count, SUM(ABS(t.value)) AS value_total, MAX(t.due_date) AS last_used_on
            FROM transactions_tags tt
            JOIN tags g ON g.id = tt.tag_id AND g.deleted_at IS NULL
            JOIN transactions t ON t.id = tt.transaction_id AND t.deleted_at IS NULL
            WHERE g.profile_id = :profileId AND tt.deleted_at IS NULL
            GROUP BY tt.tag_id`,
            { profileId },
        );
        return new Map(rows.map((row) => {
            const reader = new RowReader('transactions_tags', row);
            const usage: TagUsageRow = {
                transactionCount: reader.number('transaction_count'),
                valueTotal: reader.number('value_total'),
                lastUsedOn: LocalDate.parse(reader.text('last_used_on')),
            };
            return [TagId(reader.text('tag_id')), usage];
        }));
    }

    /**
     * @param tag Tag a gravar.
     * @return void
     */
    public save(tag: Tag): void {
        this.database.run(
            `INSERT INTO tags (id, profile_id, name, updated_at)
            VALUES (:id, :profileId, :name, :now)
            ON CONFLICT (id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
            WHERE tags.deleted_at IS NULL`,
            { id: tag.id, profileId: tag.profileId, name: tag.name, now: this.clock.now() },
        );
    }

    /**
     * @param id Tag a excluir, com os vínculos.
     * @return void
     */
    public softDelete(id: TagId): void {
        const params = { id, now: this.clock.now() };
        this.database.run('UPDATE transactions_tags SET deleted_at = :now, updated_at = :now WHERE tag_id = :id AND deleted_at IS NULL', params);
        // A tag também sai do modelo das recorrências, para não voltar nas próximas ocorrências.
        this.database.run('UPDATE recurrences_tags SET deleted_at = :now, updated_at = :now WHERE tag_id = :id AND deleted_at IS NULL', params);
        this.database.run('UPDATE tags SET deleted_at = :now, updated_at = :now WHERE id = :id AND deleted_at IS NULL', params);
    }

    /**
     * @param row Linha do `SELECT_TAG`.
     * @return A tag de domínio.
     */
    private toTag(row: SqlRow): Tag {
        const reader = new RowReader('tags', row);
        return Tag.restore({ id: TagId(reader.text('id')), profileId: ProfileId(reader.text('profile_id')), name: reader.text('name') });
    }
}
