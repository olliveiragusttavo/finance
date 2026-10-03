import type { Profile, ProfileType } from '../../domain/profile/Profile.ts';

/** Perfil serializável, como o seletor de perfil e o cadastro o mostram. */
export interface ProfileResponse {
    readonly id: string;
    readonly name: string;
    readonly type: ProfileType;
    readonly currency: string;
}

/**
 * @param profile Perfil do domínio; fonte de todos os campos.
 * @return O perfil serializável, com a moeda como código ISO.
 */
export function toProfileResponse(profile: Profile): ProfileResponse {
    return { id: profile.id, name: profile.name, type: profile.type, currency: profile.currency.code };
}
