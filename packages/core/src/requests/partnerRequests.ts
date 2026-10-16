import { z } from 'zod';
import { PARTNER_NAME_MAX_LENGTH } from '../domain/partner/Partner.ts';
import { PartnerId, ProfileId } from '../domain/shared/ids.ts';
import type { ReplacePartnersCommand } from '../services/partner/PartnerCommands.ts';
import { parsedText } from './fields.ts';

/**
 * Nome do sócio. Repete o limite do domínio só por conforto do formulário; a regra continua
 * sendo a do `Partner.create`.
 */
export const partnerNameField = z.string().trim().min(1).max(PARTNER_NAME_MAX_LENGTH);

/**
 * Participação de 0 a 100. As duas casas decimais e a soma de 100% são conferidas no domínio,
 * que é quem enxerga a lista inteira.
 */
export const partnerPercentageField = z.number().min(0).max(100);

export const listPartnersRequest = z.strictObject({ profileId: parsedText(ProfileId) });

/** Um sócio da lista: `id` nulo cria um sócio novo. */
const partnerEntry = z.strictObject({ id: parsedText(PartnerId).nullable(), name: partnerNameField, percentage: partnerPercentageField });

export const savePartnersRequest = z
    .strictObject({ profileId: parsedText(ProfileId), partners: z.array(partnerEntry) })
    // O mesmo id duas vezes deixaria ambíguo qual nome e participação valem.
    .refine((data) => {
        const ids = data.partners.flatMap((entry) => (entry.id === null ? [] : [entry.id]));
        return new Set(ids).size === ids.length;
    }, { message: 'o mesmo sócio aparece duas vezes', path: ['partners'] })
    .transform((data): ReplacePartnersCommand => ({ profileId: data.profileId, partners: data.partners }));
