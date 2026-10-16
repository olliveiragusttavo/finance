import type { OnboardingResult } from '../../services/onboarding/OnboardingResult.ts';
import { toAccountResponse, type AccountResponse } from '../accounts/AccountResponse.ts';
import { toProfileResponse, type ProfileResponse } from '../profiles/ProfileResponse.ts';

/** O perfil e a primeira conta criados no primeiro uso. */
export interface OnboardingResponse {
    readonly profile: ProfileResponse;
    readonly account: AccountResponse;
}

/**
 * @param result Perfil e conta criados pelo Service.
 * @return O resultado serializável; a UI usa o perfil para entrar na Visão geral.
 */
export function toOnboardingResponse(result: OnboardingResult): OnboardingResponse {
    return { profile: toProfileResponse(result.profile), account: toAccountResponse(result.account) };
}
