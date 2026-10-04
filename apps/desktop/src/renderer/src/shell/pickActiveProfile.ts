import type { ProfileResponse } from '@finance/core';

/**
 * Escolhe o perfil aberto. Fica no aparelho (`lastProfileId`), e não no banco, porque dois
 * aparelhos sincronizados podem estar em perfis diferentes (desktop-mvp-plan §2).
 *
 * @param profiles Perfis do banco, na ordem do núcleo.
 * @param lastProfileId Último perfil aberto neste aparelho.
 * @return O último perfil aberto; o primeiro da lista quando ele não existe mais (excluído, ou
 * preferência de outro banco); `null` só quando não há perfil algum.
 */
export function pickActiveProfile(profiles: readonly ProfileResponse[], lastProfileId: string | null): ProfileResponse | null {
    return profiles.find((profile) => profile.id === lastProfileId) ?? profiles[0] ?? null;
}
