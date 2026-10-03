import type { ProfileType } from '../../domain/profile/Profile.ts';
import type { ProfileId } from '../../domain/shared/ids.ts';

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
