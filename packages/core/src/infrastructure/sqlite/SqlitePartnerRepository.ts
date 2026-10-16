import { Partner } from '../../domain/partner/Partner.ts';
import { PartnerId, ProfileId } from '../../domain/shared/ids.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { Database, SqlRow } from '../../ports/Database.ts';
import type { PartnerRepository } from '../../repositories/PartnerRepository.ts';
import { RowReader } from './RowReader.ts';

/** Implementação SQLite de `PartnerRepository`. */
export class SqlitePartnerRepository implements PartnerRepository {
    /**
     * @param database Conexão compartilhada da unidade de trabalho.
     * @param clock Relógio que carimba `updated_at` e `deleted_at`.
     */
    public constructor(private readonly database: Database, private readonly clock: Clock) {}

    /**
     * @param profileId Perfil dono.
     * @return Os sócios vivos do perfil, por nome; o id desempata dois sócios de mesmo nome, que
     * o banco permite (database-design §4.2), para que a ordem seja estável.
     */
    public listByProfile(profileId: ProfileId): readonly Partner[] {
        return this.database
            .all(
                `SELECT p.id, p.profile_id, p.name, p.percentage FROM partners p
                WHERE p.profile_id = :profileId AND p.deleted_at IS NULL
                ORDER BY p.name COLLATE NOCASE, p.id`,
                { profileId },
            )
            .map((row) => this.toPartner(row));
    }

    /**
     * Conta só transações vivas, as que o usuário enxerga: é o número que o aviso de remoção
     * cita ("os 3 lançamentos vinculados a Ana ficam sem sócio").
     *
     * @param profileId Perfil dono.
     * @return Quantos lançamentos vivos estão vinculados a cada sócio vivo.
     */
    public transactionCounts(profileId: ProfileId): ReadonlyMap<PartnerId, number> {
        const rows = this.database.all(
            `SELECT t.partner_id, COUNT(t.id) AS transaction_count
            FROM transactions t
            JOIN partners p ON p.id = t.partner_id AND p.deleted_at IS NULL
            WHERE p.profile_id = :profileId AND t.deleted_at IS NULL
            GROUP BY t.partner_id`,
            { profileId },
        );
        return new Map(rows.map((row) => {
            const reader = new RowReader('transactions', row);
            return [PartnerId(reader.text('partner_id')), reader.number('transaction_count')];
        }));
    }

    /**
     * O `WHERE` do `DO UPDATE` impede que regravar um id já excluído o ressuscite.
     *
     * @param partner Sócio a gravar.
     * @return void
     */
    public save(partner: Partner): void {
        this.database.run(
            `INSERT INTO partners (id, profile_id, name, percentage, updated_at)
            VALUES (:id, :profileId, :name, :percentage, :now)
            ON CONFLICT (id) DO UPDATE SET name = excluded.name, percentage = excluded.percentage, updated_at = excluded.updated_at
            WHERE partners.deleted_at IS NULL`,
            { id: partner.id, profileId: partner.profileId, name: partner.name, percentage: partner.percentage, now: this.clock.now() },
        );
    }

    /**
     * Regra de negócio (Sócios, decisão de interface 10 dos mockups): remover um sócio deixa os
     * lançamentos vinculados a ele "sem sócio atribuído", para serem revistos no relatório por sócio.
     * O vínculo é apagado, e não só ignorado pelo relatório, para que editar um desses lançamentos
     * não esbarre num sócio que não existe mais; as séries perdem o sócio pelo mesmo motivo e para
     * que as próximas ocorrências não nasçam com ele.
     *
     * @param id Sócio a excluir.
     * @return void
     */
    public softDelete(id: PartnerId): void {
        const params = { id, now: this.clock.now() };
        this.database.run('UPDATE transactions SET partner_id = NULL, updated_at = :now WHERE partner_id = :id AND deleted_at IS NULL', params);
        this.database.run('UPDATE recurrences SET partner_id = NULL, updated_at = :now WHERE partner_id = :id AND deleted_at IS NULL', params);
        this.database.run('UPDATE partners SET deleted_at = :now, updated_at = :now WHERE id = :id AND deleted_at IS NULL', params);
    }

    /**
     * @param row Linha de `partners`.
     * @return O sócio de domínio.
     */
    private toPartner(row: SqlRow): Partner {
        const reader = new RowReader('partners', row);
        return Partner.restore({
            id: PartnerId(reader.text('id')),
            profileId: ProfileId(reader.text('profile_id')),
            name: reader.text('name'),
            percentage: reader.number('percentage'),
        });
    }
}
