import type { Goal } from '../../domain/goal/Goal.ts';
import type { GoalContributionView, GoalOptionView, GoalWithProgress } from '../../services/goal/GoalViews.ts';
import { toMoneyResponse, type MoneyResponse } from '../shared/MoneyResponse.ts';
import { toTransactionResponse, type TransactionResponse } from '../transactions/TransactionResponse.ts';

/** Meta serializável. */
export interface GoalResponse {
    readonly id: string;
    readonly profileId: string;
    readonly name: string;
    /**
     * De onde vem o progresso: os lançamentos vinculados, ou o saldo consolidado de hoje de uma
     * conta de investimento (database-design §4.11).
     */
    readonly funding: { readonly kind: 'transactions' } | { readonly kind: 'account'; readonly accountId: string };
    /** Valor-alvo. */
    readonly value: MoneyResponse;
    /** Data-alvo `YYYY-MM-DD`; `null` numa meta sem prazo. */
    readonly targetDate: string | null;
    /** Arquivada: fora da lista padrão de Metas e das escolhas de lançamentos novos (desktop-mvp-plan Fase 13.4). */
    readonly archived: boolean;
}

/**
 * Meta como opção do campo "Meta" do lançamento: só o que o seletor mostra e agrupa. Existe à
 * parte do `GoalProgressResponse` para que o formulário não meça o ritmo de todas as metas só
 * para listar os nomes (revisão de 2026-10-08, item 5).
 */
export interface GoalOptionResponse {
    readonly id: string;
    readonly name: string;
    /** Atingida: vai para o grupo à parte (desktop-mvp-plan Fase 13.4). */
    readonly reached: boolean;
    /** Arquivada: só aparece na edição do lançamento que já está vinculado a ela. */
    readonly archived: boolean;
}

/** Meta na lista de Metas, com o progresso e o ritmo no mês de referência (mockup `DesktopMetas`). */
export interface GoalProgressResponse extends GoalResponse {
    /** Soma das transações vinculadas pagas até hoje, ou o saldo consolidado de hoje da conta vinculada. */
    readonly saved: MoneyResponse;
    /** Quanto falta para o alvo; zero com a meta atingida. */
    readonly remaining: MoneyResponse;
    /** `saved ÷ value`, sem limite (1,2 é 120%). */
    readonly ratio: number;
    readonly reached: boolean;
    /** Vinculadas vivas, pagas ou não: quantas perdem o vínculo se a meta for excluída. */
    readonly linkedCount: number;
    /** Vinculadas que ainda não contam (em aberto ou pagas depois de hoje). */
    readonly pending: { readonly count: number; readonly total: MoneyResponse };
    /** Meses com fração do fim do mês de referência à data-alvo; zero com o prazo encerrado, `null` sem prazo. */
    readonly monthsLeft: number | null;
    /**
     * Guardado no fim do mês de referência (`period` `YYYY-MM`), de onde o ritmo e a projeção
     * partem; fora do mês atual difere de `saved`, e a tela mostra os dois.
     */
    readonly paceBase: { readonly period: string; readonly saved: MoneyResponse; readonly kind: 'current' | 'past' | 'estimated' };
    /** Quanto guardar por mês para chegar ao alvo na data, a partir de `paceBase`; `null` quando não se aplica. */
    readonly requiredPerMonth: MoneyResponse | null;
    /** Média mensal guardada desde a 1ª contribuição; `null` antes dela. */
    readonly averagePerMonth: MoneyResponse | null;
    /** No ritmo da média, partindo de `paceBase`, quanto fica acima (positivo) ou abaixo (negativo) do alvo na data-alvo. */
    readonly projectedGap: MoneyResponse | null;
}

/** Transação que conta no progresso, com o dia em que passou a contar. */
export interface GoalContributionResponse {
    readonly transaction: TransactionResponse;
    /** Dia do pagamento `YYYY-MM-DD`: o da transação numa conta, o da fatura num cartão. */
    readonly paidOn: string;
}

/**
 * Converte a entidade em dado puro, porque `Money` e `LocalDate` não sobrevivem ao
 * `structuredClone` do IPC entre o núcleo e a tela (mobile-shell-design §4.4): o valor-alvo vira
 * `{ amount, currency }` e a data-alvo, texto `YYYY-MM-DD`. É a base comum das respostas de meta.
 *
 * @param goal Meta do domínio.
 * @return A meta serializável, sem o progresso.
 */
export function toGoalResponse(goal: Goal): GoalResponse {
    return {
        id: goal.id,
        profileId: goal.profileId,
        name: goal.name,
        funding: goal.funding.kind === 'account' ? { kind: 'account', accountId: goal.funding.accountId } : { kind: 'transactions' },
        value: toMoneyResponse(goal.target),
        targetDate: goal.targetDate?.toString() ?? null,
        archived: goal.archived,
    };
}

/**
 * @param options Metas do perfil com o progresso de hoje, na ordem do Repository (por nome).
 * @return As opções do seletor, na mesma ordem.
 */
export function toGoalOptionResponses(options: readonly GoalOptionView[]): readonly GoalOptionResponse[] {
    return options.map(({ goal, reached }) => ({ id: goal.id, name: goal.name, reached, archived: goal.archived }));
}

/**
 * O progresso vai pronto porque é regra de negócio (database-design §4.11): a UI só formata, e
 * desktop e celular mostram o mesmo número.
 *
 * @param list Metas com progresso, montadas pelo Service.
 * @return A lista serializável, na ordem do Service.
 */
export function toGoalProgressResponses(list: readonly GoalWithProgress[]): readonly GoalProgressResponse[] {
    return list.map(({ goal, progress, linkedCount }) => ({
        ...toGoalResponse(goal),
        saved: toMoneyResponse(progress.saved),
        remaining: toMoneyResponse(progress.remaining),
        ratio: progress.ratio,
        reached: progress.reached,
        linkedCount,
        pending: { count: progress.pending.count, total: toMoneyResponse(progress.pending.total) },
        monthsLeft: progress.monthsLeft,
        paceBase: { period: progress.paceBase.period.toString(), saved: toMoneyResponse(progress.paceBase.saved), kind: progress.paceBase.kind },
        requiredPerMonth: progress.requiredPerMonth === null ? null : toMoneyResponse(progress.requiredPerMonth),
        averagePerMonth: progress.averagePerMonth === null ? null : toMoneyResponse(progress.averagePerMonth),
        projectedGap: progress.projectedGap === null ? null : toMoneyResponse(progress.projectedGap),
    }));
}

/**
 * @param list Transações que contam no progresso, montadas pelo Service.
 * @return A lista serializável, na ordem do Service.
 */
export function toGoalContributionResponses(list: readonly GoalContributionView[]): readonly GoalContributionResponse[] {
    return list.map(({ transaction, paidOn }) => ({ transaction: toTransactionResponse(transaction), paidOn: paidOn.toString() }));
}
