import { z } from 'zod';
import { BALANCE_PROJECTION_BASES } from '../domain/report/BalanceProjection.ts';
import { ProfileId } from '../domain/shared/ids.ts';
import { parsedText, yearMonthField } from './fields.ts';

/** Relatório por sócio: o mês de referência recorta só os números do mês (reports-design §8, P1). */
export const partnerReportRequest = z.strictObject({ profileId: parsedText(ProfileId), period: yearMonthField });

export const entriesWithoutPartnerRequest = z.strictObject({ profileId: parsedText(ProfileId), period: yearMonthField });

/**
 * Projeção de saldo (reports-design §9, B1): a janela da média é escolhida na tela e não é
 * gravada; sem ela, vale o ano inteiro.
 */
export const balanceProjectionRequest = z.strictObject({
    profileId: parsedText(ProfileId),
    basis: z.literal(BALANCE_PROJECTION_BASES).default(12),
});
