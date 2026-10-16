import type { Account } from '../../domain/account/Account.ts';
import type { Profile } from '../../domain/profile/Profile.ts';

/**
 * O que o primeiro uso cria. Fica fora do arquivo do `OnboardingService` para que a camada
 * DTO dependa só do contrato de saída.
 */
export interface OnboardingResult {
    readonly profile: Profile;
    readonly account: Account;
}
