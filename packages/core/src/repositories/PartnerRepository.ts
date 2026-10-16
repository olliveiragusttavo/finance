import type { Partner } from '../domain/partner/Partner.ts';
import type { PartnerId, ProfileId } from '../domain/shared/ids.ts';

/** Acesso aos sócios. Toda leitura considera só linhas vivas. */
export interface PartnerRepository {
    /**
     * @param profileId Perfil dono.
     * @return Os sócios vivos do perfil, por nome; vazio num perfil pessoal.
     */
    listByProfile(profileId: ProfileId): readonly Partner[];

    /**
     * @param profileId Perfil dono.
     * @return Quantos lançamentos vivos estão vinculados a cada sócio, em todo o período; sócio sem
     * lançamento fica fora do mapa.
     */
    transactionCounts(profileId: ProfileId): ReadonlyMap<PartnerId, number>;

    /**
     * Insere o sócio novo ou regrava nome e participação de um existente.
     *
     * @param partner Sócio a gravar.
     * @return void
     */
    save(partner: Partner): void;

    /**
     * Soft delete do sócio e dos vínculos dele como pagador. A propagação é explícita porque o
     * `SET NULL` do banco só dispara num `DELETE` (database-design §3.6); os lançamentos e as
     * séries em si continuam existindo, agora sem sócio.
     *
     * @param id Sócio a excluir.
     * @return void
     */
    softDelete(id: PartnerId): void;
}
