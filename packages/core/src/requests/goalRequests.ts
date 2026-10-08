import { z } from 'zod';
import { GoalId, ProfileId } from '../domain/shared/ids.ts';
import type { CreateGoalCommand, GoalContentCommand, UpdateGoalCommand } from '../services/goal/GoalCommands.ts';
import { localDateField, moneyField, parsedText, registryNameField, yearMonthField } from './fields.ts';

/**
 * Campos do cadastro da meta, exportados para o formulário validar com o mesmo schema.
 * Regra de negócio (Metas): o valor-alvo é maior que zero; a data-alvo é opcional — `null` é a
 * meta sem prazo, como a reserva de emergência (database-design §4.11).
 */
export const goalContentShape = {
    name: registryNameField,
    value: moneyField.positive(),
    targetDate: localDateField.nullable().default(null),
};

/**
 * Converte a saída do schema no conteúdo do Service campo a campo, pelo mesmo motivo do
 * `toAccountInput`: sob `exactOptionalPropertyTypes` o comando precisa de todos os campos.
 *
 * @param data Saída validada do schema.
 * @return O conteúdo da meta no formato do Service.
 */
function toGoalContent(data: z.output<z.ZodObject<typeof goalContentShape>>): GoalContentCommand {
    return { name: data.name, value: data.value, targetDate: data.targetDate };
}

export const listGoalsRequest = z.strictObject({ profileId: parsedText(ProfileId), period: yearMonthField });

/** Só o perfil: as opções do campo "Meta" não dependem do mês de referência. */
export const goalOptionsRequest = z.strictObject({ profileId: parsedText(ProfileId) });

export const createGoalRequest = z
    .strictObject({ profileId: parsedText(ProfileId), ...goalContentShape })
    .transform((data): CreateGoalCommand => ({ profileId: data.profileId, ...toGoalContent(data) }));

export const updateGoalRequest = z
    .strictObject({ id: parsedText(GoalId), ...goalContentShape })
    .transform((data): UpdateGoalCommand => ({ id: data.id, ...toGoalContent(data) }));

export const goalIdRequest = z.strictObject({ id: parsedText(GoalId) });
