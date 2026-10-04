import type { ProfileId, TagId } from '../../domain/shared/ids.ts';

/** Tag nova num perfil. */
export interface CreateTagCommand {
    readonly profileId: ProfileId;
    readonly name: string;
}

/** Renomear uma tag. */
export interface RenameTagCommand {
    readonly id: TagId;
    readonly name: string;
}
