import type { Profile, ProfileType } from '../../domain/profile/Profile.ts';

/** Perfil serializável, como o seletor de perfil, o cadastro e o formulário de lançamento o usam. */
export interface ProfileResponse {
    readonly id: string;
    readonly name: string;
    readonly type: ProfileType;
    readonly currency: string;
    /** Conta do atalho "Débito" do lançamento novo; `null` sem padrão (database-design §4.1). */
    readonly defaultAccountId: string | null;
    /** Cartão do atalho "Crédito" do lançamento novo; `null` sem padrão. */
    readonly defaultCreditCardId: string | null;
}

/**
 * @param profile Perfil do domínio; fonte de todos os campos.
 * @return O perfil serializável, com a moeda como código ISO.
 */
export function toProfileResponse(profile: Profile): ProfileResponse {
    return {
        id: profile.id,
        name: profile.name,
        type: profile.type,
        currency: profile.currency.code,
        defaultAccountId: profile.defaultAccountId,
        defaultCreditCardId: profile.defaultCreditCardId,
    };
}
