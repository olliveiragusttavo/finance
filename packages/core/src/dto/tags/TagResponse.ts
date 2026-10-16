import type { Tag } from '../../domain/tag/Tag.ts';
import type { TagWithUsage } from '../../services/tag/TagViews.ts';
import { toMoneyResponse, type MoneyResponse } from '../shared/MoneyResponse.ts';

/** Tag serializável. */
export interface TagResponse {
    readonly id: string;
    readonly profileId: string;
    readonly name: string;
}

/** Tag na lista de Tags, com o uso em todo o período (mockup `DesktopTags`). */
export interface TagUsageResponse extends TagResponse {
    readonly transactionCount: number;
    /** Soma dos valores em módulo dos lançamentos marcados. */
    readonly total: MoneyResponse;
    /** Data `YYYY-MM-DD` do último lançamento marcado, pelo vencimento; `null` sem uso. */
    readonly lastUsedOn: string | null;
}

/**
 * @param tag Tag do domínio.
 * @return A tag serializável.
 */
export function toTagResponse(tag: Tag): TagResponse {
    return { id: tag.id, profileId: tag.profileId, name: tag.name };
}

/**
 * O uso vai pronto porque a contagem é o que o aviso de exclusão cita ("remove a tag dos 3
 * lançamentos"), e a UI não tem como contá-la sozinha.
 *
 * @param list Tags com uso, montadas pelo Service.
 * @return A lista serializável, na ordem do Service.
 */
export function toTagUsageResponses(list: readonly TagWithUsage[]): readonly TagUsageResponse[] {
    return list.map(({ tag, transactionCount, total, lastUsedOn }) => ({
        ...toTagResponse(tag),
        transactionCount,
        total: toMoneyResponse(total),
        lastUsedOn: lastUsedOn?.toString() ?? null,
    }));
}
