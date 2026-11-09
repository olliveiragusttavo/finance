import type { ProfileType } from '../../domain/profile/Profile.ts';
import type { AccountId, CreditCardId, ProfileId } from '../../domain/shared/ids.ts';

/** Perfil novo, como a camada Request entrega. */
export interface CreateProfileCommand {
    readonly name: string;
    readonly type: ProfileType;
    /** Código ISO 4217; vira `Currency` no Service, onde mora a única validação. */
    readonly currency: string;
}

/**
 * Edição do perfil: nome e moeda. O tipo fica de fora porque mudar de empresarial para
 * pessoal deixaria sócios e transações com sócio num perfil que não os aceita
 * (database-design §4.1), e o MVP não tem sócios para justificar a regra de transição.
 */
export interface UpdateProfileCommand {
    readonly id: ProfileId;
    readonly name: string;
    readonly currency: string;
}

/** Escolha da conta padrão do atalho "Débito" (database-design §4.1). */
export interface SetDefaultAccountCommand {
    readonly profileId: ProfileId;
    /** `null` tira o padrão. */
    readonly accountId: AccountId | null;
}

/** Escolha do cartão padrão do atalho "Crédito" (database-design §4.1). */
export interface SetDefaultCreditCardCommand {
    readonly profileId: ProfileId;
    /** `null` tira o padrão. */
    readonly creditCardId: CreditCardId | null;
}
