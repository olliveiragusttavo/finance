import { z } from 'zod';
import { ProfileId } from '../domain/shared/ids.ts';
import type { CreateProfileCommand, UpdateProfileCommand } from '../services/profile/ProfileCommands.ts';
import { currencyCodeField, parsedText, registryNameField } from './fields.ts';

/** Sem parâmetros: o seletor de perfil lista todos os perfis do aparelho. */
export const listProfilesRequest = z.strictObject({});

export const profileTypeField = z.enum(['personal', 'business']);

export const createProfileRequest = z
    .strictObject({ name: registryNameField, type: profileTypeField, currency: currencyCodeField })
    .transform((data): CreateProfileCommand => ({ name: data.name, type: data.type, currency: data.currency }));

/** Edição completa: nome e moeda vêm sempre, como em toda edição do núcleo. */
export const updateProfileRequest = z
    .strictObject({ id: parsedText(ProfileId), name: registryNameField, currency: currencyCodeField })
    .transform((data): UpdateProfileCommand => ({ id: data.id, name: data.name, currency: data.currency }));
