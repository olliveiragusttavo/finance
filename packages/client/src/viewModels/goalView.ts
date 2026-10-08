import type { AccountResponse, CategoryBranchResponse, CreditCardResponse, GoalContributionResponse, GoalProgressResponse, MoneyResponse } from '@finance/core';
import { formatDate, formatDayMonth, formatMonthShort } from '../format/dates.ts';
import { formatMoney } from '../format/money.ts';
import { formatPercent } from '../format/percent.ts';

/*
 * Textos da tela de Metas (mockup `DesktopMetas`; desktop-mvp-plan Fase 9.3). O progresso e o
 * ritmo vêm prontos do núcleo (`goals.list`); aqui só se decide como lê-los, para que desktop e
 * celular digam o mesmo.
 */

/** Item da lista de metas: nome, percentual, barra e a linha "quanto de quanto · prazo". */
export interface GoalListItem {
    /** `35%`, arredondado sem casa decimal, como no mockup. */
    readonly percentText: string;
    /** Preenchimento da barra entre 0 e 1: o estorno não a deixa negativa, e passar do alvo não a estoura. */
    readonly barRatio: number;
    /** `R$ 1.400,00 de R$ 4.000,00 · até 15/01/2027` ou `… · sem data-alvo`. */
    readonly summary: string;
}

/**
 * @param goal Meta com o progresso, como `goals.list` a devolve.
 * @return Os textos do item da lista e do cabeçalho do detalhe.
 */
export function describeGoalListItem(goal: GoalProgressResponse): GoalListItem {
    const deadline = goal.targetDate === null ? 'sem data-alvo' : `até ${formatDate(goal.targetDate)}`;
    return {
        percentText: formatPercent(goal.ratio, { sign: 'negative', decimals: 0 }),
        barRatio: Math.min(1, Math.max(0, goal.ratio)),
        summary: `${formatMoney(goal.saved)} de ${formatMoney(goal.value)} · ${deadline}`,
    };
}

/** Um dos três números do detalhe (`.kpi` do mockup). */
export interface GoalFigure {
    readonly label: string;
    readonly value: string;
    readonly note: string;
}

/**
 * Os três números do detalhe: quanto falta, a data-alvo e o ritmo necessário.
 * Regra de negócio (Metas, desktop-mvp-plan Fase 9.3): o prazo e o ritmo contam a partir do fim
 * do mês de referência; sem data-alvo, com o prazo encerrado ou com a meta atingida não há
 * ritmo a seguir, e a nota diz por quê em vez de mostrar um número sem sentido.
 *
 * @param goal Meta com o progresso.
 * @return Falta, data-alvo e ritmo necessário, nessa ordem.
 */
export function goalFigures(goal: GoalProgressResponse): readonly [GoalFigure, GoalFigure, GoalFigure] {
    return [
        { label: 'Falta', value: formatMoney(goal.remaining), note: goal.reached ? 'meta atingida' : 'para o valor-alvo' },
        {
            label: 'Data-alvo',
            value: goal.targetDate === null ? 'Sem data-alvo' : formatDate(goal.targetDate),
            note: goal.monthsLeft === null ? 'meta sem prazo' : describeMonthsLeft(goal.monthsLeft),
        },
        { label: 'Ritmo necessário', value: goal.requiredPerMonth === null ? '—' : `≈ ${formatMoney(goal.requiredPerMonth)}/mês`, note: paceNote(goal) },
    ];
}

/**
 * Frase do destaque abaixo dos números (`.note` do mockup): de quanto o ritmo parte e onde a
 * média leva a meta na data-alvo.
 * Regra de negócio (Metas, desktop-mvp-plan Fase 9.3): o ritmo parte do guardado no fim do mês
 * de referência; fora do mês atual esse valor difere do total de hoje, mostrado no progresso
 * logo acima, e a frase o diz para que os dois números não pareçam se contradizer.
 *
 * @param goal Meta com o progresso.
 * @return A frase, ou `null` quando não há o que dizer (sem prazo, prazo encerrado, ou mês
 * atual sem aporte) — a meta atingida tem a própria frase.
 */
export function goalProjectionNote(goal: GoalProgressResponse): string | null {
    if (goal.reached) {
        return `Meta atingida: ${formatMoney(goal.saved)} guardados de ${formatMoney(goal.value)}.`;
    }
    const sentences = [paceBaseSentence(goal), projectionSentence(goal)].filter((sentence) => sentence !== null);
    return sentences.length === 0 ? null : sentences.join(' ');
}

/**
 * Regra de negócio (Metas): só contam as transações pagas até hoje; as vinculadas ainda em
 * aberto ficam fora da tabela e do progresso, e a tela avisa que existem para que a meta não
 * pareça ter perdido um lançamento.
 *
 * @param goal Meta com o progresso.
 * @return A frase sobre as pendentes, ou `null` sem nenhuma.
 */
export function goalPendingNote(goal: GoalProgressResponse): string | null {
    const { count, total } = goal.pending;
    if (count === 0) {
        return null;
    }
    return count === 1
        ? `1 lançamento vinculado ainda não conta (${formatMoney(total)}): entra no progresso quando for pago.`
        : `${String(count)} lançamentos vinculados ainda não contam (${formatMoney(total)}): entram no progresso quando forem pagos.`;
}

/**
 * Aviso da exclusão. Regra de negócio (Metas): excluir tira a meta dos lançamentos, que
 * continuam existindo.
 *
 * @param goal Meta a excluir.
 * @return A frase com quantos lançamentos perdem o vínculo.
 */
export function describeGoalDeletion(goal: Pick<GoalProgressResponse, 'name' | 'linkedCount'>): string {
    if (goal.linkedCount === 0) {
        return `Nenhum lançamento está vinculado a ${goal.name}; excluir só apaga a meta.`;
    }
    const linked = goal.linkedCount === 1 ? 'O lançamento vinculado perde' : `Os ${String(goal.linkedCount)} lançamentos vinculados perdem`;
    return `${linked} o vínculo com ${goal.name} e continua${goal.linkedCount === 1 ? '' : 'm'} existindo, com os mesmos valores e saldos.`;
}

/** Linha da tabela "Transações vinculadas". */
export interface GoalContributionRow {
    readonly id: string;
    /** Dia do pagamento, `05/10`. */
    readonly date: string;
    readonly name: string;
    /** `Investimentos › Aporte`. */
    readonly category: string;
    /** `Nubank`, ou `Nubank → Tesouro` numa transferência. */
    readonly account: string;
    /** Quanto soma à meta, com o sinal do estorno. */
    readonly amountText: string;
    readonly refund: boolean;
}

/** Os cadastros que dão nome às linhas. */
export interface GoalContributionSource {
    readonly contributions: readonly GoalContributionResponse[];
    /** Todas as contas do perfil, desativadas incluídas: o histórico continua mostrando o nome. */
    readonly accounts: readonly Pick<AccountResponse, 'id' | 'name'>[];
    readonly creditCards: readonly Pick<CreditCardResponse, 'id' | 'name'>[];
    readonly categories: readonly CategoryBranchResponse[];
}

/**
 * Monta a tabela das transações que contam, na ordem do núcleo (dia do pagamento). O valor é o
 * que a transação soma à meta — o valor dela, sem encargos —, e não o efeito na conta: a
 * transferência para o Tesouro sai da corrente, mas entra na meta.
 *
 * @param source Contribuições e os cadastros.
 * @return As linhas da tabela.
 */
export function buildGoalContributionRows(source: GoalContributionSource): readonly GoalContributionRow[] {
    const accounts = new Map(source.accounts.map((account) => [account.id, account.name]));
    const creditCards = new Map(source.creditCards.map((creditCard) => [creditCard.id, creditCard.name]));
    const subCategories = new Map(source.categories.flatMap((category) => category.subCategories.map((sub) => [sub.id, `${category.name} › ${sub.name}`])));
    return source.contributions.map(({ transaction, paidOn }) => {
        const { container } = transaction;
        const origin = container.kind === 'statement' ? accounts.get(container.accountId) ?? '' : creditCards.get(container.creditCardId) ?? '';
        return {
            id: transaction.id,
            date: formatDayMonth(paidOn),
            name: transaction.name,
            category: subCategories.get(transaction.subCategoryId) ?? '',
            account: transaction.destinationAccountId === null ? origin : `${origin} → ${accounts.get(transaction.destinationAccountId) ?? ''}`,
            amountText: formatMoney(transaction.value),
            refund: transaction.value.amount < 0,
        };
    });
}

/**
 * @param monthsLeft Meses com fração até a data-alvo.
 * @return `cerca de 2,5 meses`, `cerca de 1 mês`, `menos de 1 mês` ou `prazo encerrado`.
 */
function describeMonthsLeft(monthsLeft: number): string {
    if (monthsLeft === 0) {
        return 'prazo encerrado';
    }
    const rounded = Math.round(monthsLeft * 10) / 10;
    if (rounded < 1) {
        return 'menos de 1 mês';
    }
    if (rounded === 1) {
        return 'cerca de 1 mês';
    }
    return `cerca de ${(Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)).replace('.', ',')} meses`;
}

/**
 * @param goal Meta com o progresso.
 * @return A nota sob o ritmo necessário: a média para comparar, ou por que não há ritmo — o que
 * inclui o alvo já alcançado no fim de um mês passado ou previsto para um futuro, quando a meta
 * ainda não foi atingida hoje.
 */
function paceNote(goal: GoalProgressResponse): string {
    if (goal.reached) {
        return 'a meta já foi atingida';
    }
    if (goal.monthsLeft === null) {
        return 'sem data-alvo não há ritmo a seguir';
    }
    if (goal.monthsLeft === 0) {
        return 'o prazo terminou';
    }
    const { kind, period } = goal.paceBase;
    if (goal.requiredPerMonth === null) {
        return kind === 'estimated' ? `pela média, alcança o alvo até ${formatMonthShort(period)}` : `alvo alcançado em ${formatMonthShort(period)}`;
    }
    if (goal.averagePerMonth === null) {
        return 'nenhum aporte até este mês';
    }
    return kind === 'past' ? `média até ${formatMonthShort(period)}: ${perMonth(goal.averagePerMonth)}` : `média atual: ${perMonth(goal.averagePerMonth)}`;
}

/**
 * Diz de quanto o ritmo parte quando o mês de referência não é o atual. No mês atual a base é o
 * próprio total do progresso, e repeti-la só ocuparia espaço.
 *
 * @param goal Meta com o progresso.
 * @return A frase com o guardado no fim do mês de referência, ou `null` no mês atual e quando
 * não há ritmo (sem prazo ou prazo encerrado).
 */
function paceBaseSentence(goal: GoalProgressResponse): string | null {
    const { kind, period, saved } = goal.paceBase;
    if (kind === 'current' || goal.monthsLeft === null || goal.monthsLeft === 0) {
        return null;
    }
    const month = formatMonthShort(period);
    return kind === 'past' ? `No fim de ${month} havia ${formatMoney(saved)} guardados.` : `A previsão para o fim de ${month} é de ${formatMoney(saved)} guardados.`;
}

/**
 * @param goal Meta com o progresso.
 * @return Onde a média leva a meta na data-alvo, ou `null` sem projeção. Num mês passado a
 * média é a daquele mês, e a frase diz isso em vez de "atual".
 */
function projectionSentence(goal: GoalProgressResponse): string | null {
    const gap = goal.projectedGap;
    if (gap === null) {
        return null;
    }
    const pace = goal.paceBase.kind === 'past' ? `No ritmo até ${formatMonthShort(goal.paceBase.period)}` : 'No ritmo atual';
    if (gap.amount === 0) {
        return `${pace} a meta é atingida exatamente na data-alvo.`;
    }
    return gap.amount < 0
        ? `${pace} a meta fica ${formatMoney(gap, 'absolute')} abaixo na data-alvo.`
        : `${pace} a meta passa ${formatMoney(gap, 'absolute')} do valor-alvo na data-alvo.`;
}

/**
 * @param money Valor mensal.
 * @return `R$ 700,00/mês`.
 */
function perMonth(money: MoneyResponse): string {
    return `${formatMoney(money)}/mês`;
}
