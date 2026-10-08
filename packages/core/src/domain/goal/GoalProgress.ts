import type { TransactionId } from '../shared/ids.ts';
import { LocalDate } from '../shared/LocalDate.ts';
import { Money } from '../shared/Money.ts';
import { YearMonth } from '../shared/YearMonth.ts';
import type { Goal } from './Goal.ts';

/**
 * Duração média de um mês em dias (365,2425 ÷ 12, o ano gregoriano). O prazo de uma meta vira
 * "meses" com fração — "cerca de 2,5 meses" no mockup —, e contar pelos dias corridos com o
 * mês médio dá a mesma resposta qualquer que seja o tamanho dos meses no caminho; contar mês a
 * mês pelo calendário faria 31/01 → 28/02 valer um mês inteiro e 01/02 → 28/02 quase um.
 */
const AVERAGE_MONTH_DAYS = 365.2425 / 12;

/** Uma transação vinculada a uma meta, como o Repository a lê. */
export interface GoalLink {
    readonly transactionId: TransactionId;
    /** Valor com sinal, na moeda do perfil: o estorno (negativo) desconta da meta. Sem encargos. */
    readonly value: Money;
    /**
     * Dia em que o dinheiro de fato se moveu: o pagamento numa conta, o da fatura num cartão.
     * `null` enquanto está em aberto.
     */
    readonly paidOn: LocalDate | null;
}

/** Transação que conta no progresso, com o dia em que passou a contar. */
export interface GoalContribution {
    readonly transactionId: TransactionId;
    readonly value: Money;
    readonly paidOn: LocalDate;
}

/**
 * De onde o ritmo parte: quanto estava (ou estará) guardado no fim do mês de referência. Vai
 * junto do progresso porque, fora do mês atual, esse valor difere do `saved` de hoje, e a tela
 * precisa mostrá-lo para que o ritmo e a projeção não pareçam contradizer o total guardado.
 */
export interface GoalPaceBase {
    /** Mês de referência. */
    readonly period: YearMonth;
    /** Guardado no fim do mês: o real até ele, ou a previsão pela média quando ele é futuro. */
    readonly saved: Money;
    /**
     * `current` no mês de hoje (vale o `saved` de hoje), `past` num mês encerrado (o que já
     * estava pago no fim dele) e `estimated` num mês futuro (o de hoje mais a média dos meses
     * até ele).
     */
    readonly kind: 'current' | 'past' | 'estimated';
}

/** Progresso de uma meta e o ritmo até a data-alvo (mockup `DesktopMetas`). */
export interface GoalProgress {
    /** Soma das contribuições; pode passar do alvo, e fica negativa se os estornos superarem os aportes. */
    readonly saved: Money;
    /** Quanto falta para o alvo; zero quando a meta foi atingida. */
    readonly remaining: Money;
    /** `saved ÷ alvo`, sem limite: 1,2 é 120%. */
    readonly ratio: number;
    readonly reached: boolean;
    /** Transações que contam, da mais antiga para a mais recente. */
    readonly contributions: readonly GoalContribution[];
    /** Vinculadas que ainda não contam: em aberto, ou pagas com data depois de hoje. */
    readonly pending: { readonly count: number; readonly total: Money };
    /**
     * Meses (com fração) entre o fim do mês de referência e a data-alvo; zero quando a data já
     * passou, `null` numa meta sem prazo.
     */
    readonly monthsLeft: number | null;
    /** Guardado no fim do mês de referência, de onde o ritmo e a projeção partem. */
    readonly paceBase: GoalPaceBase;
    /**
     * Quanto guardar por mês para chegar ao alvo na data, a partir de `paceBase`; `null` sem
     * prazo, com prazo encerrado ou com o alvo já alcançado em `paceBase`.
     */
    readonly requiredPerMonth: Money | null;
    /** Média mensal guardada desde o mês da 1ª contribuição; `null` antes dela. */
    readonly averagePerMonth: Money | null;
    /**
     * No ritmo da média, partindo de `paceBase`, quanto a meta fica acima (positivo) ou abaixo
     * (negativo) do alvo na data-alvo; `null` quando não há o que projetar (sem prazo, sem
     * média, prazo encerrado ou alvo já alcançado em `paceBase`).
     */
    readonly projectedGap: Money | null;
}

/** O que o cálculo do progresso precisa saber. */
export interface GoalProgressInput {
    readonly goal: Goal;
    /** Todas as transações vivas vinculadas à meta, pagas ou não. */
    readonly links: readonly GoalLink[];
    /** Mês de referência da tela: o ritmo conta a partir do fim dele. */
    readonly period: YearMonth;
    /** Hoje, no fuso do usuário. */
    readonly today: LocalDate;
}

/**
 * Mede o progresso de uma meta a partir das transações vinculadas.
 * Regra de negócio (Metas — decisões perguntadas, desktop-mvp-plan Fase 9.3):
 * - o progresso soma só as vinculadas **pagas até hoje**, independente do mês de referência:
 *   uma série fixa é gerada 12 meses à frente (database-design §4.12), e somar o que ainda não
 *   saiu da conta daria a meta por cumprida antes da hora;
 * - o valor entra com sinal (o estorno desconta) e sem encargos, que são custo do meio de
 *   pagamento, não dinheiro guardado — o mesmo critério do total das tags;
 * - o prazo, o ritmo necessário e a projeção contam a partir do **fim do mês de referência**,
 *   para que navegar pelos meses mostre a situação de cada um — e partem do guardado **nesse
 *   mesmo ponto** (`paceBase`), não do de hoje. Misturar o saldo de hoje com o prazo de um mês
 *   passado contava duas vezes os aportes entre os dois, e num mês futuro deixava de fora os
 *   meses entre hoje e ele (revisão de 2026-10-08, item 2);
 * - a média mensal vai do mês da 1ª contribuição até o mês de referência (ou o atual, se o de
 *   referência for futuro, porque nada depois de hoje conta), com mês sem aporte valendo zero.
 *
 * @param input Meta, transações vinculadas, mês de referência e hoje.
 * @return O progresso e o ritmo.
 */
export function measureGoalProgress(input: GoalProgressInput): GoalProgress {
    const { goal, links, period, today } = input;
    const currency = goal.target.currency;
    const contributions = links
        .flatMap((link): GoalContribution[] => (link.paidOn !== null && !today.isBefore(link.paidOn) ? [{ transactionId: link.transactionId, value: link.value, paidOn: link.paidOn }] : []))
        .sort((a, b) => a.paidOn.compare(b.paidOn) || a.transactionId.localeCompare(b.transactionId));
    const counted = new Set(contributions.map((contribution) => contribution.transactionId));
    const pendingLinks = links.filter((link) => !counted.has(link.transactionId));

    const saved = sum(contributions.map((contribution) => contribution.value), currency);
    const missing = goal.target.subtract(saved);
    const reached = missing.isZero() || missing.isNegative();
    const remaining = reached ? Money.zero(currency) : missing;
    const monthsLeft = goal.targetDate === null ? null : monthsBetween(endOf(period), goal.targetDate);
    const averagePerMonth = averageOf(contributions, YearMonth.min(period, today.period), currency);
    const paceBase = paceBaseOf(contributions, saved, averagePerMonth, period, today);
    const missingAtBase = goal.target.subtract(paceBase.saved);
    const open = monthsLeft !== null && monthsLeft > 0 && !missingAtBase.isZero() && !missingAtBase.isNegative();

    return {
        saved,
        remaining,
        ratio: saved.amount / goal.target.amount,
        reached,
        contributions,
        pending: { count: pendingLinks.length, total: sum(pendingLinks.map((link) => link.value), currency) },
        monthsLeft,
        paceBase,
        requiredPerMonth: open ? missingAtBase.times(1 / monthsLeft) : null,
        averagePerMonth,
        projectedGap: open && averagePerMonth !== null ? paceBase.saved.add(averagePerMonth.times(monthsLeft)).subtract(goal.target) : null,
    };
}

/**
 * Guardado no fim do mês de referência, para o ritmo partir do mesmo ponto que o prazo.
 * Regra de negócio (Metas, desktop-mvp-plan Fase 9.3): num mês encerrado vale o que já estava
 * pago no fim dele; no mês atual, o de hoje — o resto do mês não é projetado, porque o aporte
 * do mês pode já ter entrado e a média o contaria de novo; num mês futuro, o de hoje mais a
 * média por mês inteiro depois do atual, que é a mesma média da projeção.
 *
 * @param contributions Contribuições pagas até hoje, em ordem de data.
 * @param saved Guardado até hoje, já somado pelo chamador.
 * @param averagePerMonth Média mensal até o mês de referência (ou o atual); `null` sem aporte.
 * @param period Mês de referência.
 * @param today Hoje, que separa o mês passado, o atual e o futuro.
 * @return A base do ritmo.
 */
function paceBaseOf(contributions: readonly GoalContribution[], saved: Money, averagePerMonth: Money | null, period: YearMonth, today: LocalDate): GoalPaceBase {
    if (period.isBefore(today.period)) {
        const end = endOf(period);
        const until = contributions.filter((contribution) => !end.isBefore(contribution.paidOn));
        return { period, saved: sum(until.map((contribution) => contribution.value), saved.currency), kind: 'past' };
    }
    if (today.period.isBefore(period)) {
        const ahead = averagePerMonth === null ? Money.zero(saved.currency) : averagePerMonth.times(today.period.monthsUntil(period));
        return { period, saved: saved.add(ahead), kind: 'estimated' };
    }
    return { period, saved, kind: 'current' };
}

/**
 * @param values Valores a somar, todos na moeda do perfil.
 * @param currency Moeda do zero, para a lista vazia.
 * @return A soma, sem arredondar (database-design §3.7).
 */
function sum(values: readonly Money[], currency: Money['currency']): Money {
    return values.reduce((total, value) => total.add(value), Money.zero(currency));
}

/**
 * @param period Mês de referência.
 * @return O último dia do mês, de onde o prazo começa a contar.
 */
function endOf(period: YearMonth): LocalDate {
    return LocalDate.of(period.year, period.month, period.lengthInDays());
}

/**
 * @param from Início do prazo.
 * @param to Data-alvo.
 * @return Os meses médios entre as datas, com fração; zero quando a data-alvo não está depois.
 */
function monthsBetween(from: LocalDate, to: LocalDate): number {
    return Math.max(0, (to.toEpochDay() - from.toEpochDay()) / AVERAGE_MONTH_DAYS);
}

/**
 * @param contributions Contribuições em ordem de data.
 * @param last Último mês da média (inclusivo).
 * @param currency Moeda do perfil.
 * @return A soma das contribuições até `last` dividida pelos meses desde a 1ª; `null` quando
 * nenhuma contribuição cai até `last`.
 */
function averageOf(contributions: readonly GoalContribution[], last: YearMonth, currency: Money['currency']): Money | null {
    const window = contributions.filter((contribution) => !last.isBefore(contribution.paidOn.period));
    const first = window[0];
    if (first === undefined) {
        return null;
    }
    const months = first.paidOn.period.monthsUntil(last) + 1;
    return sum(window.map((contribution) => contribution.value), currency).times(1 / months);
}
