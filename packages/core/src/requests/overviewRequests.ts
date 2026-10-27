import { z } from 'zod';
import { ProfileId } from '../domain/shared/ids.ts';
import { parsedText, yearMonthField } from './fields.ts';

/** Gastos da Visão geral: os seis meses terminam no mês de referência da barra. */
export const overviewSpendingRequest = z.strictObject({ profileId: parsedText(ProfileId), period: yearMonthField });

/**
 * Itens em aberto e próximas faturas: partem de hoje (o `Clock`), e não do mês de referência,
 * porque atraso é sempre em relação a hoje.
 */
export const overviewProfileRequest = z.strictObject({ profileId: parsedText(ProfileId) });
