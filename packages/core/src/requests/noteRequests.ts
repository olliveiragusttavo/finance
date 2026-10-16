import { z } from 'zod';
import { NoteId, ProfileId } from '../domain/shared/ids.ts';
import type { CreateNoteCommand, RewriteNoteCommand } from '../services/note/NoteCommands.ts';
import { parsedText } from './fields.ts';

/**
 * Texto da anotação: livre e sem limite de tamanho (database-design §4.3), mas não vazio.
 * Repete o invariante do `Note` só por conforto do formulário, como o `registryNameField`.
 */
export const noteTextField = z.string().trim().min(1);

export const listNotesRequest = z.strictObject({ profileId: parsedText(ProfileId) });

export const createNoteRequest = z
    .strictObject({ profileId: parsedText(ProfileId), text: noteTextField })
    .transform((data): CreateNoteCommand => ({ profileId: data.profileId, text: data.text }));

export const rewriteNoteRequest = z
    .strictObject({ id: parsedText(NoteId), text: noteTextField })
    .transform((data): RewriteNoteCommand => ({ id: data.id, text: data.text }));

export const noteIdRequest = z.strictObject({ id: parsedText(NoteId) });
