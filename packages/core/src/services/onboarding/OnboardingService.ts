import type { AccountService } from '../account/AccountService.ts';
import type { CategoryService } from '../category/CategoryService.ts';
import type { ProfileService } from '../profile/ProfileService.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import type { StartOnboardingCommand } from './OnboardingCommands.ts';
import type { OnboardingResult } from './OnboardingResult.ts';

/**
 * O primeiro uso: perfil e primeira conta de uma vez (mockup `DesktopPrimeiroUso`).
 * Regra de negócio (Primeiro uso): o primeiro uso não pode deixar perfil sem conta — um
 * perfil sem conta não tem onde lançar nada e reabriria o app num estado que nenhuma tela
 * trata. Por isso as duas gravações acontecem numa única unidade de trabalho: se a conta
 * falha, o perfil também não fica.
 */
export class OnboardingService {
    /**
     * @param unitOfWork A unidade de trabalho que envolve as gravações.
     * @param profiles Cria o perfil.
     * @param accounts Cria a primeira conta.
     * @param categories Cria as categorias sugeridas.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly profiles: ProfileService,
        private readonly accounts: AccountService,
        private readonly categories: CategoryService,
    ) {}

    /**
     * As categorias sugeridas entram na mesma unidade porque, sem nenhuma subcategoria, o
     * primeiro lançamento seria recusado (toda transação aponta para uma — database-design
     * §4.13).
     *
     * @param command Perfil, primeira conta e a escolha das categorias sugeridas.
     * @return O perfil e a conta criados.
     * @throws {InvalidValueError} Quando algum dado do perfil ou da conta é inválido; nada é
     * gravado.
     */
    public start(command: StartOnboardingCommand): OnboardingResult {
        return this.unitOfWork.run(() => {
            const profile = this.profiles.create(command.profile);
            const account = this.accounts.create({ ...command.account, profileId: profile.id });
            if (command.suggestedCategories) {
                this.categories.seedSuggested(profile.id);
            }
            return { profile, account };
        });
    }
}
