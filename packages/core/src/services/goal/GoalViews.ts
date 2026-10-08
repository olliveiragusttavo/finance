import type { Goal } from '../../domain/goal/Goal.ts';
import type { GoalProgress } from '../../domain/goal/GoalProgress.ts';
import type { LocalDate } from '../../domain/shared/LocalDate.ts';
import type { Transaction } from '../../domain/transaction/Transaction.ts';

/**
 * Uma meta com o progresso e o ritmo no mês de referência — o que a lista e o detalhe de
 * Metas mostram (mockup `DesktopMetas`).
 */
export interface GoalWithProgress {
    readonly goal: Goal;
    readonly progress: GoalProgress;
    /** Transações vivas vinculadas, pagas ou não: o que perde o vínculo se a meta for excluída. */
    readonly linkedCount: number;
}

/** Transação que conta no progresso, inteira, com o dia em que passou a contar. */
export interface GoalContributionView {
    readonly transaction: Transaction;
    readonly paidOn: LocalDate;
}
