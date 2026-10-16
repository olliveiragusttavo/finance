import { z } from 'zod';
import { AccountId, GoalId, ProfileId } from '../domain/shared/ids.ts';
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
 * De onde vem o progresso (database-design §4.11): os lançamentos vinculados ou o saldo de uma
 * conta de investimento. Na criação o padrão é por lançamentos, o caso de sempre; na edição o
 * tipo vem explícito, porque trocá-lo desfaz os vínculos e não pode acontecer por omissão.
 */
export const goalFundingField = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('transactions') }),
    z.strictObject({ kind: z.literal('account'), accountId: parsedText(AccountId) }),
]);

/**
 * Converte a saída do schema no conteúdo do Service campo a campo, pelo mesmo motivo do
 * `toAccountInput`: sob `exactOptionalPropertyTypes` o comando precisa de todos os campos.
 *
 * @param data Saída validada do schema.
 * @return O conteúdo da meta no formato do Service.
 */
function toGoalContent(data: z.output<z.ZodObject<typeof goalContentShape>> & { readonly funding: z.output<typeof goalFundingField> }): GoalContentCommand {
    return { name: data.name, funding: data.funding, value: data.value, targetDate: data.targetDate };
}

export const listGoalsRequest = z.strictObject({ profileId: parsedText(ProfileId), period: yearMonthField });

/** Só o perfil: as opções do campo "Meta" não dependem do mês de referência. */
export const goalOptionsRequest = z.strictObject({ profileId: parsedText(ProfileId) });

export const createGoalRequest = z
    .strictObject({ profileId: parsedText(ProfileId), ...goalContentShape, funding: goalFundingField.default({ kind: 'transactions' }) })
    .transform((data): CreateGoalCommand => ({ profileId: data.profileId, ...toGoalContent(data) }));

export const updateGoalRequest = z
    .strictObject({ id: parsedText(GoalId), ...goalContentShape, funding: goalFundingField })
    .transform((data): UpdateGoalCommand => ({ id: data.id, ...toGoalContent(data) }));

export const goalIdRequest = z.strictObject({ id: parsedText(GoalId) });
