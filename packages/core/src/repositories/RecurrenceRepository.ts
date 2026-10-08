import type { Recurrence } from '../domain/recurrence/Recurrence.ts';
import type { ProfileId, RecurrenceId } from '../domain/shared/ids.ts';

/** Acesso às regras de recorrência (database-design §4.12). Toda leitura considera só regras vivas de perfis vivos. */
export interface RecurrenceRepository {
    /**
     * @param id Regra procurada.
     * @return A regra viva, ou `null`.
     */
    findById(id: RecurrenceId): Recurrence | null;

    /**
     * @param profileId Perfil dono.
     * @return As regras vivas do perfil, pela data de referência e pelo nome.
     */
    listByProfile(profileId: ProfileId): readonly Recurrence[];

    /**
     * Só os ids: o complemento da abertura percorre todas as regras, lendo cada uma na transação
     * dela, para que uma linha corrompida falhe sozinha em vez de impedir a lista inteira.
     *
     * @return Os ids das regras vivas de todos os perfis.
     */
    listAllIds(): readonly RecurrenceId[];

    /**
     * @param recurrence Regra nova, com as tags do modelo.
     * @return void
     */
    insert(recurrence: Recurrence): void;

    /**
     * @param recurrence Regra revisada: modelo, calendário, termos ou marca d'água.
     * @return void
     */
    update(recurrence: Recurrence): void;

    /**
     * Soft delete da regra e dos vínculos das tags do modelo; as ocorrências são da Service.
     *
     * @param id Regra a excluir.
     * @return void
     */
    softDelete(id: RecurrenceId): void;
}
