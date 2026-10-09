import { z } from 'zod';
import { AccountId, ProfileId } from '../domain/shared/ids.ts';
import { parsedText, yearMonthField } from './fields.ts';

export const getStatementRequest = z.strictObject({ accountId: parsedText(AccountId), period: yearMonthField });

export const profileInvoicesRequest = z.strictObject({ profileId: parsedText(ProfileId), period: yearMonthField });
