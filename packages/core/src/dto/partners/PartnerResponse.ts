import type { PartnerWithUsage } from '../../services/partner/PartnerViews.ts';

/**
 * Sócio no cadastro (rotas `partners.list` e `partners.save`). A participação vai de 0 a 100,
 * como é digitada e gravada — diferente dos relatórios, que devolvem a proporção (`share`),
 * porque aqui ela é o próprio campo do formulário.
 */
export interface PartnerResponse {
    readonly id: string;
    readonly profileId: string;
    readonly name: string;
    /** Participação de 0 a 100. */
    readonly percentage: number;
    /** Lançamentos vivos vinculados ao sócio, em todo o período; ficam sem sócio se ele for removido. */
    readonly transactionCount: number;
}

/**
 * @param list Sócios com uso, montados pelo Service.
 * @return A lista serializável, na ordem do Service.
 */
export function toPartnerResponses(list: readonly PartnerWithUsage[]): readonly PartnerResponse[] {
    return list.map(({ partner, transactionCount }) => ({
        id: partner.id,
        profileId: partner.profileId,
        name: partner.name,
        percentage: partner.percentage,
        transactionCount,
    }));
}
