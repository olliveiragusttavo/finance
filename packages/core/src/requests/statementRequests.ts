import { z } from 'zod';
import { AccountId } from '../domain/shared/ids.ts';
import { parsedText, yearMonthField } from './fields.ts';

export const getStatementRequest = z.strictObject({ accountId: parsedText(AccountId), period: yearMonthField });
