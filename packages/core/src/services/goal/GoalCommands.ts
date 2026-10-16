import type { GoalFunding } from '../../domain/goal/Goal.ts';
import type { GoalId, ProfileId } from '../../domain/shared/ids.ts';
import type { LocalDate } from '../../domain/shared/LocalDate.ts';

/** Conteúdo de uma meta como a Request o entrega; o valor vira `Money` na moeda do perfil no Service. */
export interface GoalContentCommand {
    readonly name: string;
    /** De onde vem o progresso: os lançamentos vinculados ou o saldo de uma conta de investimento. */
    readonly funding: GoalFunding;
    /** Valor-alvo na moeda do perfil. */
    readonly value: number;
    readonly targetDate: LocalDate | null;
}

/** Meta nova num perfil. */
export interface CreateGoalCommand extends GoalContentCommand {
    readonly profileId: ProfileId;
}

/** Editar uma meta. */
export interface UpdateGoalCommand extends GoalContentCommand {
    readonly id: GoalId;
}
