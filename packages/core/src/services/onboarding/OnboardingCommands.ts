import type { AccountInput } from '../account/AccountCommands.ts';
import type { CreateProfileCommand } from '../profile/ProfileCommands.ts';

/** O formulário do primeiro uso: perfil, primeira conta e se cria as categorias sugeridas. */
export interface StartOnboardingCommand {
    readonly profile: CreateProfileCommand;
    readonly account: AccountInput;
    readonly suggestedCategories: boolean;
}
