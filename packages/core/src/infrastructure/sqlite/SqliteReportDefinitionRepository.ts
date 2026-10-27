import { ReportDefinition } from '../../domain/report/ReportDefinition.ts';
import { ReportFilter } from '../../domain/report/ReportFilter.ts';
import { ReportLayout } from '../../domain/report/ReportLayout.ts';
import { CorruptRowError, DomainError } from '../../domain/shared/errors.ts';
import { ProfileId, ReportDefinitionId } from '../../domain/shared/ids.ts';
import { toReportFilterResponse, toReportLayoutResponse } from '../../dto/reports/ReportDefinitionResponse.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { Database, SqlRow } from '../../ports/Database.ts';
import type { ReportDefinitionRepository } from '../../repositories/ReportDefinitionRepository.ts';
import { storedReportContentSchema } from '../../requests/reportRequests.ts';
import { RowReader } from './RowReader.ts';

const SELECT_DEFINITION = 'SELECT r.id, r.profile_id, r.name, r.definition FROM report_definitions r';

/** Implementação SQLite de `ReportDefinitionRepository`. */
export class SqliteReportDefinitionRepository implements ReportDefinitionRepository {
    /**
     * @param database Conexão compartilhada da unidade de trabalho.
     * @param clock Relógio que carimba `updated_at` e `deleted_at`.
     */
    public constructor(private readonly database: Database, private readonly clock: Clock) {}

    /**
     * @param id Definição procurada.
     * @return A definição viva, ou `null`.
     */
    public findById(id: ReportDefinitionId): ReportDefinition | null {
        const row = this.database.get(`${SELECT_DEFINITION} WHERE r.id = :id AND r.deleted_at IS NULL`, { id });
        return row === undefined ? null : this.toDefinition(row);
    }

    /**
     * @param profileId Perfil dono.
     * @return As definições vivas do perfil, por nome; o id desempata para a ordem não variar.
     */
    public listByProfile(profileId: ProfileId): readonly ReportDefinition[] {
        return this.database
            .all(`${SELECT_DEFINITION} WHERE r.profile_id = :profileId AND r.deleted_at IS NULL ORDER BY r.name COLLATE NOCASE, r.id`, { profileId })
            .map((row) => this.toDefinition(row));
    }

    /**
     * Grava o filtro e o formato no JSON versionado da coluna `definition` (reports-design §4).
     *
     * @param definition Definição a gravar.
     * @return void
     */
    public save(definition: ReportDefinition): void {
        const content = JSON.stringify({ version: 1, filter: toReportFilterResponse(definition.filter), layout: toReportLayoutResponse(definition.layout) });
        this.database.run(
            `INSERT INTO report_definitions (id, profile_id, name, definition, updated_at)
            VALUES (:id, :profileId, :name, :definition, :now)
            ON CONFLICT (id) DO UPDATE SET name = excluded.name, definition = excluded.definition, updated_at = excluded.updated_at
            WHERE report_definitions.deleted_at IS NULL`,
            { id: definition.id, profileId: definition.profileId, name: definition.name, definition: content, now: this.clock.now() },
        );
    }

    /**
     * @param id Definição a excluir.
     * @return void
     */
    public softDelete(id: ReportDefinitionId): void {
        this.database.run('UPDATE report_definitions SET deleted_at = :now, updated_at = :now WHERE id = :id AND deleted_at IS NULL', { id, now: this.clock.now() });
    }

    /**
     * Lê o JSON pelo mesmo schema da entrada da rota e revalida no domínio. Um JSON que não passa
     * é corrupção — a aplicação só grava o que validou —, e vira `CorruptRowError` em vez de um
     * relatório que filtra outra coisa em silêncio.
     *
     * @param row Linha do `SELECT_DEFINITION`.
     * @return A definição de domínio.
     * @throws {CorruptRowError} Quando o JSON não é uma definição válida.
     */
    private toDefinition(row: SqlRow): ReportDefinition {
        const reader = new RowReader('report_definitions', row);
        const parsed = storedReportContentSchema.safeParse(parseJson(reader.text('definition')));
        if (!parsed.success) {
            throw new CorruptRowError('report_definitions', `definição fora do formato: ${parsed.error.message}`);
        }
        try {
            return ReportDefinition.restore({
                id: ReportDefinitionId(reader.text('id')),
                profileId: ProfileId(reader.text('profile_id')),
                name: reader.text('name'),
                filter: ReportFilter.create(parsed.data.filter),
                layout: ReportLayout.create(parsed.data.layout),
            });
        } catch (error) {
            if (error instanceof DomainError) {
                throw new CorruptRowError('report_definitions', error.message);
            }
            throw error;
        }
    }
}

/**
 * @param text Conteúdo da coluna `definition`.
 * @return O valor do JSON, ou `undefined` quando o texto não é JSON — o schema recusa depois.
 */
function parseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}
