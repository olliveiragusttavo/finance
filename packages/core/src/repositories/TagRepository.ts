import type { ProfileId, TagId } from '../domain/shared/ids.ts';
import type { LocalDate } from '../domain/shared/LocalDate.ts';
import type { Tag } from '../domain/tag/Tag.ts';

/** Uso de uma tag nos lançamentos vivos, como o banco o soma. */
export interface TagUsageRow {
    readonly transactionCount: number;
    /** Soma dos valores em módulo, na moeda do perfil, ainda sem arredondar. */
    readonly valueTotal: number;
    /** Maior data de vencimento entre os lançamentos marcados. */
    readonly lastUsedOn: LocalDate;
}

/** Acesso às tags e ao uso delas. Toda leitura considera só linhas vivas. */
export interface TagRepository {
    /**
     * @param id Tag procurada.
     * @return A tag viva, ou `null`.
     */
    findById(id: TagId): Tag | null;

    /**
     * @param profileId Perfil dono.
     * @return As tags vivas do perfil, por nome.
     */
    listByProfile(profileId: ProfileId): readonly Tag[];

    /**
     * @param profileId Perfil dono.
     * @return O uso de cada tag do perfil em lançamentos vivos; tag sem lançamento fica fora
     * do mapa.
     */
    usage(profileId: ProfileId): ReadonlyMap<TagId, TagUsageRow>;

    /**
     * Insere a tag nova ou regrava o nome de uma existente.
     *
     * @param tag Tag a gravar.
     * @return void
     */
    save(tag: Tag): void;

    /**
     * Soft delete da tag e dos vínculos dela com lançamentos. A propagação é explícita porque
     * o cascade do banco não dispara num `UPDATE` (database-design §3.6); os lançamentos em
     * si não são tocados.
     *
     * @param id Tag a excluir.
     * @return void
     */
    softDelete(id: TagId): void;
}
