import { z } from 'zod';
import { ProfileId, TagId } from '../domain/shared/ids.ts';
import type { CreateTagCommand, RenameTagCommand } from '../services/tag/TagCommands.ts';
import { parsedText, registryNameField } from './fields.ts';

export const listTagsRequest = z.strictObject({ profileId: parsedText(ProfileId) });

export const createTagRequest = z
    .strictObject({ profileId: parsedText(ProfileId), name: registryNameField })
    .transform((data): CreateTagCommand => ({ profileId: data.profileId, name: data.name }));

export const renameTagRequest = z
    .strictObject({ id: parsedText(TagId), name: registryNameField })
    .transform((data): RenameTagCommand => ({ id: data.id, name: data.name }));

export const tagIdRequest = z.strictObject({ id: parsedText(TagId) });
