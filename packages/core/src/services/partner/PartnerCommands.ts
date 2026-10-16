import type { PartnerId, ProfileId } from '../../domain/shared/ids.ts';

/** Um sócio da lista enviada pelo cadastro: com id, um existente; sem, um novo. */
export interface PartnerEntry {
    readonly id: PartnerId | null;
    readonly name: string;
    /** Participação de 0 a 100. */
    readonly percentage: number;
}

/**
 * A lista completa de sócios de um perfil, como o cadastro a deixou. É a lista inteira, e não
 * uma alteração por sócio, porque a soma de 100% só se confere com todas as participações juntas
 * (mockup `DesktopSocios`: um "Salvar" para a tela toda).
 */
export interface ReplacePartnersCommand {
    readonly profileId: ProfileId;
    /** Sócios que ficam; os vivos do perfil que não estão aqui são removidos. */
    readonly partners: readonly PartnerEntry[];
}
