import type { ReportDefinition } from '../domain/report/ReportDefinition.ts';
import type { ProfileId, ReportDefinitionId } from '../domain/shared/ids.ts';

/** Acesso às definições de relatório. Toda leitura considera só linhas vivas. */
export interface ReportDefinitionRepository {
    /**
     * @param id Definição procurada.
     * @return A definição viva, ou `null`.
     */
    findById(id: ReportDefinitionId): ReportDefinition | null;

    /**
     * @param profileId Perfil dono.
     * @return As definições vivas do perfil, por nome.
     */
    listByProfile(profileId: ProfileId): readonly ReportDefinition[];

    /**
     * Insere a definição nova ou regrava nome, filtro e formato de uma existente.
     *
     * @param definition Definição a gravar.
     * @return void
     */
    save(definition: ReportDefinition): void;

    /**
     * @param id Definição a excluir; nenhuma transação é tocada.
     * @return void
     */
    softDelete(id: ReportDefinitionId): void;
}
