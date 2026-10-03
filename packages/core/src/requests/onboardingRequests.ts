import { z } from 'zod';
import type { StartOnboardingCommand } from '../services/onboarding/OnboardingCommands.ts';
import { accountContentShape, toAccountInput } from './accountRequests.ts';
import { currencyCodeField, registryNameField } from './fields.ts';
import { profileTypeField } from './profileRequests.ts';

/**
 * O formulário do primeiro uso (mockup `DesktopPrimeiroUso`). As categorias sugeridas vêm
 * ligadas por padrão porque, sem nenhuma subcategoria, o primeiro lançamento seria recusado.
 */
export const startOnboardingRequest = z
    .strictObject({
        profile: z.strictObject({ name: registryNameField, type: profileTypeField, currency: currencyCodeField }),
        account: z.strictObject(accountContentShape),
        suggestedCategories: z.boolean().default(true),
    })
    .transform((data): StartOnboardingCommand => ({
        profile: { name: data.profile.name, type: data.profile.type, currency: data.profile.currency },
        account: toAccountInput(data.account),
        suggestedCategories: data.suggestedCategories,
    }));
