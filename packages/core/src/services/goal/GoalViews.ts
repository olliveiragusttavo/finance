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

/**
 * Meta como opção do campo "Meta" do lançamento: o formulário agrupa as atingidas à parte e só
 * oferece a arquivada ao lançamento que já está vinculado a ela (desktop-mvp-plan Fase 13.4).
 */
export interface GoalOptionView {
    readonly goal: Goal;
    /** Se o guardado até hoje alcançou o alvo. */
    readonly reached: boolean;
}

/** Transação que conta no progresso, inteira, com o dia em que passou a contar. */
export interface GoalContributionView {
    readonly transaction: Transaction;
    readonly paidOn: LocalDate;
}
