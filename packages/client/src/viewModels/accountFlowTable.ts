import { Currency, Money, type AccountFlowMonthResponse, type AccountFlowResponse, type BalancePairResponse, type MoneyResponse } from '@finance/core';
import { formatMonthShort } from '../format/dates.ts';
import { formatMoney } from '../format/money.ts';

/** Tom de uma célula, que a tela converte nos tokens `in`, `out`, `ink` ou `muted`. */
export type AccountFlowTone = 'in' | 'out' | 'neutral' | 'muted';

/** Uma coluna do fluxo (um mês). */
export interface AccountFlowColumn {
    readonly period: string;
    /** `jul/2026`. */
    readonly label: string;
    /** `atual` no mês corrente, `previsto` nos meses depois dele; `null` nos passados. */
    readonly note: 'atual' | 'previsto' | null;
    readonly isReference: boolean;
}

/** Uma célula: o valor e, quando parte dele ainda não aconteceu, a nota embaixo. */
export interface AccountFlowCell {
    readonly text: string;
    /** `−R$ 500,00 em aberto`, `em aberto · só no previsto` ou `previsto R$ 1.870,40`. */
    readonly sub: string | null;
    readonly tone: AccountFlowTone;
}

/** Uma linha do fluxo. */
export interface AccountFlowRow {
    readonly key: 'opening' | 'inflows' | 'outflows' | 'invoices' | 'closing' | 'projectedClosing';
    /** `↑ Entradas`: a seta diz a direção sem depender da cor (decisão de interface 7 dos mockups). */
    readonly label: string;
    /** `total` destaca o consolidado final; `muted` apaga o previsto final, de peso menor (decisão 6). */
    readonly emphasis: 'total' | 'muted' | null;
    readonly cells: readonly AccountFlowCell[];
}

/** O fluxo por conta pronto para a tela. */
export interface AccountFlowTable {
    /** `Nubank — extratos encadeados`. */
    readonly title: string;
    readonly subtitle: string;
    readonly columns: readonly AccountFlowColumn[];
    readonly rows: readonly AccountFlowRow[];
}

/** Consolidado final de mês futuro: nada aconteceu ainda, então não há o que mostrar (F5). */
const NOT_YET = '—';

/**
 * Monta a tabela do fluxo por conta (mockup DesktopRelFluxo) a partir do relatório do núcleo. Os
 * números vêm prontos do núcleo, lidos do extrato de cada conta (F2); aqui só se escolhem o texto,
 * a nota e o tom de cada célula.
 * Regra de negócio (Relatórios, F5): as linhas de movimento mostram o previsto — tudo que pesa no
 * mês — e dizem quanto ainda está em aberto; nos meses depois do mês corrente o mês inteiro é
 * previsto, a nota sairia em toda célula e não diria nada, e o consolidado final é "—"
 * (desktop-mvp-plan §3.4).
 *
 * @param report Relatório do núcleo.
 * @return O título, as colunas e as seis linhas da tabela.
 */
export function buildAccountFlowTable(report: AccountFlowResponse): AccountFlowTable {
    const name = report.scope.kind === 'account' ? report.scope.accountName : 'Todas as contas do total';
    const counted = report.scope.kind === 'total' ? ` · soma de ${countAccounts(report.scope.accountIds.length)}` : '';
    return {
        title: `${name} — extratos encadeados`,
        subtitle: `3 meses antes e 1 depois do mês de referência · o saldo final de um mês é o inicial do seguinte${counted}`,
        columns: report.months.map((month) => ({
            period: month.period,
            label: formatMonthShort(month.period),
            note: month.timing === 'current' ? 'atual' : month.timing === 'future' ? 'previsto' : null,
            isReference: month.period === report.period,
        })),
        rows: [
            { key: 'opening', label: 'Saldo inicial', emphasis: null, cells: report.months.map(openingCell) },
            { key: 'inflows', label: '↑ Entradas', emphasis: null, cells: report.months.map((month) => movementCell(month, month.inflows, 'in')) },
            { key: 'outflows', label: '↓ Saídas', emphasis: null, cells: report.months.map((month) => movementCell(month, month.outflows, 'out')) },
            { key: 'invoices', label: '↓ Faturas', emphasis: null, cells: report.months.map((month) => movementCell(month, month.invoices, 'out')) },
            {
                key: 'closing',
                label: 'Saldo final consolidado',
                emphasis: 'total',
                cells: report.months.map((month) => (month.timing === 'future' ? { text: NOT_YET, sub: null, tone: 'muted' } : { text: formatMoney(month.closing.consolidated), sub: null, tone: 'neutral' })),
            },
            {
                key: 'projectedClosing',
                label: 'Saldo final previsto',
                emphasis: 'muted',
                cells: report.months.map((month) => ({ text: formatMoney(month.closing.projected), sub: null, tone: month.timing === 'future' ? 'neutral' : 'muted' })),
            },
        ],
    };
}

/**
 * O saldo inicial é o consolidado, com o previsto embaixo quando difere — a cadeia que o leitor
 * confere é a do consolidado. No mês futuro o consolidado não diz nada, e vale o previsto, que é
 * o final previsto do mês anterior.
 *
 * @param month Mês do relatório.
 * @return A célula do saldo inicial.
 */
function openingCell(month: AccountFlowMonthResponse): AccountFlowCell {
    if (month.timing === 'future') {
        return { text: formatMoney(month.opening.projected), sub: null, tone: 'muted' };
    }
    const differs = !sameMoney(month.opening.consolidated, month.opening.projected);
    return { text: formatMoney(month.opening.consolidated), sub: differs ? `previsto ${formatMoney(month.opening.projected)}` : null, tone: 'neutral' };
}

/**
 * Uma célula de movimento: o previsto, com sinal, e o que ainda está em aberto.
 *
 * @param month Mês do relatório, para saber se é futuro.
 * @param pair Consolidado e previsto da linha.
 * @param direction Tom da linha quando há valor; o zero fica neutro.
 * @return A célula.
 */
function movementCell(month: AccountFlowMonthResponse, pair: BalancePairResponse, direction: 'in' | 'out'): AccountFlowCell {
    const projected = toMoney(pair.projected);
    const pending = projected.subtract(toMoney(pair.consolidated)).rounded();
    const tone = projected.rounded().isZero() ? 'neutral' : direction;
    if (month.timing === 'future' || pending.isZero()) {
        return { text: formatMoney(pair.projected, 'always'), sub: null, tone };
    }
    const allPending = toMoney(pair.consolidated).rounded().isZero();
    return {
        text: formatMoney(pair.projected, 'always'),
        sub: allPending ? 'em aberto · só no previsto' : `${formatMoney({ amount: pending.amount, currency: pair.projected.currency }, 'always')} em aberto`,
        tone,
    };
}

/**
 * @param money Valor do núcleo.
 * @return O mesmo valor como `Money`, para subtrair sem o erro binário do ponto flutuante.
 */
function toMoney(money: MoneyResponse): Money {
    return Money.of(money.amount, Currency.of(money.currency));
}

/**
 * @param a Primeiro valor.
 * @param b Segundo valor.
 * @return `true` quando a tela os mostraria iguais.
 */
function sameMoney(a: MoneyResponse, b: MoneyResponse): boolean {
    return toMoney(a).equals(toMoney(b));
}

/**
 * @param count Quantas contas entraram na soma.
 * @return `1 conta` ou `3 contas`.
 */
function countAccounts(count: number): string {
    return count === 1 ? '1 conta' : `${String(count)} contas`;
}
