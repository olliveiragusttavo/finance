import { z } from 'zod';
import { AccountId, ProfileId } from '../domain/shared/ids.ts';
import { parsedText } from './fields.ts';

export const profileBalancesRequest = z.strictObject({ profileId: parsedText(ProfileId) });

export const rebuildAccountRequest = z.strictObject({ accountId: parsedText(AccountId) });
