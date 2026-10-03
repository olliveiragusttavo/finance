import { toOnboardingResponse, type OnboardingResponse } from '../dto/onboarding/OnboardingResponse.ts';
import { toProfileResponse, type ProfileResponse } from '../dto/profiles/ProfileResponse.ts';
import { startOnboardingRequest } from '../requests/onboardingRequests.ts';
import { createProfileRequest, listProfilesRequest, updateProfileRequest } from '../requests/profileRequests.ts';
import type { OnboardingService } from '../services/onboarding/OnboardingService.ts';
import type { ProfileService } from '../services/profile/ProfileService.ts';
import { handle, type CoreResult, type UnexpectedErrorListener } from './CoreResult.ts';

/**
 * Rotas de perfil e do primeiro uso. O primeiro uso fica aqui, e não num Controller
 * próprio, porque é o cadastro do perfil com a primeira conta junto.
 */
export class ProfileController {
    /**
     * @param profiles Cadastro de perfis.
     * @param onboarding Primeiro uso: perfil e primeira conta numa unidade de trabalho.
     * @param onUnexpected Destino do log de falhas inesperadas.
     */
    public constructor(
        private readonly profiles: ProfileService,
        private readonly onboarding: OnboardingService,
        private readonly onUnexpected: UnexpectedErrorListener,
    ) {}

    /**
     * @param raw Entrada vazia.
     * @return Os perfis do aparelho, por nome.
     */
    public list(raw: unknown): Promise<CoreResult<readonly ProfileResponse[]>> {
        return handle(listProfilesRequest, raw, () => this.profiles.list().map(toProfileResponse), this.onUnexpected);
    }

    /**
     * @param raw Entrada com nome, tipo e moeda.
     * @return O perfil criado.
     */
    public create(raw: unknown): Promise<CoreResult<ProfileResponse>> {
        return handle(createProfileRequest, raw, (command) => toProfileResponse(this.profiles.create(command)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com o perfil, o nome e a moeda.
     * @return O perfil editado.
     */
    public update(raw: unknown): Promise<CoreResult<ProfileResponse>> {
        return handle(updateProfileRequest, raw, (command) => toProfileResponse(this.profiles.update(command)), this.onUnexpected);
    }

    /**
     * @param raw Entrada do formulário do primeiro uso.
     * @return O perfil e a conta criados.
     */
    public startOnboarding(raw: unknown): Promise<CoreResult<OnboardingResponse>> {
        return handle(startOnboardingRequest, raw, (command) => toOnboardingResponse(this.onboarding.start(command)), this.onUnexpected);
    }
}
