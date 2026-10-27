import {
    Currency,
    Money,
    roundHalfAwayFromZero,
    type AccountResponse,
    type CategoryBranchResponse,
    type CreditCardResponse,
    type EntriesWithoutPartnerResponse,
    type MoneyResponse,
    type PartnerReportResponse,
    type TagResponse,
    type TransactionResponse,
} from '@finance/core';
import { formatMonthShort } from '../format/dates.ts';
import { formatMoney } from '../format/money.ts';
import { formatPercent } from '../format/percent.ts';
import type { OtherProfileAccount } from './otherProfileAccounts.ts';
import { buildTransactionTable, NO_TRANSACTION_FILTERS, type TransactionDirection } from './transactionTable.ts';

/** Um indicador do topo. */
export interface PartnerKpi {
    readonly label: string;
    readonly value: string;
    readonly sub: string;
}

/** Para que lado a diferença de um sócio aponta. */
export type PartnerBalance = 'more' | 'less' | 'even';

/** Uma linha da tabela de sócios. */
export interface PartnerRow {
    readonly partnerId: string;
    readonly name: string;
    /** `60%`, ou `33,3%` quando a participação não é inteira. */
    readonly share: string;
    readonly expected: string;
    readonly contributed: string;
    /** `▲ +R$ 200,00 · aportou a mais`, `▼ −R$ 200,00 · aportou a menos` ou `em dia`. */
    readonly difference: string;
    readonly balance: PartnerBalance;
}

/** As duas barras de um sócio no gráfico "Aportou × deveria", em % da maior barra. */
export interface PartnerBars {
    readonly partnerId: string;
    readonly name: string;
    readonly contributedWidth: number;
    readonly expectedWidth: number;
}

/** Uma transferência do acerto, com os nomes. */
export interface PartnerTransfer {
    readonly from: string;
    readonly to: string;
    readonly amount: string;
}

/** O relatório por sócio pronto para a tela. */
export interface PartnerReportView {
    readonly kpis: { readonly contributions: PartnerKpi; readonly month: PartnerKpi; readonly unassigned: PartnerKpi };
    readonly rows: readonly PartnerRow[];
    readonly total: { readonly share: string; readonly expected: string; readonly contributed: string };
    readonly bars: readonly PartnerBars[];
    /** O acerto dos aportes; vazio quando equilibrado ou sem divisão possível (`note` explica). */
    readonly transfers: readonly PartnerTransfer[];
    /** Texto do quadro do acerto quando não há transferência a mostrar; `null` quando há. */
    readonly note: string | null;
    /** Aviso de participações que não somam 100%; `null` quando somam. */
    readonly sharesWarning: string | null;
    readonly hasPartners: boolean;
}

/**
 * Monta o relatório por sócio (D7; reports-design §8). Os números vêm prontos do núcleo; aqui só
 * os textos e as larguras do gráfico.
 * Regra de negócio (Sócios — aportes, P1–P4): a tabela e o acerto são dos aportes de **todos os
 * períodos** — o que cada sócio pôs na empresa contra a parte dele no total aportado. O mês de
 * referência só aparece nos dois indicadores do mês: os aportes dele e as entradas sem sócio, que
 * ficam fora da divisão (a receita de serviço é lucro, não aporte).
 *
 * @param report Relatório do núcleo.
 * @return Indicadores, tabela, gráfico e acerto.
 */
export function buildPartnerReportView(report: PartnerReportResponse): PartnerReportView {
    const names = new Map(report.partners.map((partner) => [partner.partnerId, partner.name]));
    const complete = Math.abs(report.sharesTotal - 1) < SHARES_EPSILON;
    const largest = Math.max(0, ...report.partners.flatMap((partner) => [partner.contributed.amount, partner.expected.amount]));
    const currency = report.contributions.currency;
    const expectedTotal = report.partners.reduce((total, partner) => total.add(moneyOf(partner.expected)), Money.zero(Currency.of(currency)));
    const month = formatMonthShort(report.period);
    return {
        kpis: {
            contributions: { label: 'Total de aportes', value: formatMoney(report.contributions), sub: 'todos os períodos · base da divisão' },
            month: { label: `Aportes em ${month}`, value: formatMoney(report.monthContributions), sub: countLabel(report.monthContributionCount, 'lançamento', 'lançamentos') },
            unassigned: {
                label: `Entradas sem sócio em ${month}`,
                value: formatMoney(report.unassigned),
                sub: report.unassignedCount > 0 ? `${countLabel(report.unassignedCount, 'lançamento', 'lançamentos')} · fora da divisão` : 'nenhuma entrada sem sócio',
            },
        },
        rows: report.partners.map((partner) => ({
            partnerId: partner.partnerId,
            name: partner.name,
            share: shareText(partner.share),
            expected: formatMoney(partner.expected),
            contributed: formatMoney(partner.contributed),
            ...differenceOf(partner.difference),
        })),
        total: { share: shareText(report.sharesTotal), expected: formatMoney({ amount: expectedTotal.amount, currency }), contributed: formatMoney(report.contributions) },
        bars: report.partners.map((partner) => ({
            partnerId: partner.partnerId,
            name: partner.name,
            contributedWidth: widthOf(partner.contributed.amount, largest),
            expectedWidth: widthOf(partner.expected.amount, largest),
        })),
        transfers: report.settlements.map((settlement) => ({
            from: names.get(settlement.fromPartnerId) ?? '',
            to: names.get(settlement.toPartnerId) ?? '',
            amount: formatMoney(settlement.amount, 'absolute'),
        })),
        note: report.settlements.length > 0 ? null : noteOf(report, complete),
        sharesWarning: complete || report.partners.length === 0
            ? null
            : `As participações dos sócios somam ${shareText(report.sharesTotal)}, e não 100%. A divisão usa cada participação como está, e o acerto só aparece quando a soma der 100%.`,
        hasPartners: report.partners.length > 0,
    };
}

/**
 * Uma linha da lista de entradas sem sócio: a mesma linha da tabela de Transações, para que o
 * lançamento apareça igual em toda tela.
 */
export interface UnassignedEntryRow {
    readonly id: string;
    readonly transaction: TransactionResponse;
    /** `03/10`: o vencimento, a mesma data que a tela de Transações mostra. */
    readonly date: string;
    readonly name: string;
    /** `Receitas › Serviços`. */
    readonly category: string;
    /** `Nubank`, ou a conta de origem da transferência recebida, com o perfil dela. */
    readonly container: string;
    /** Nomes das tags, na ordem do lançamento. */
    readonly tags: readonly string[];
    /** `+R$ 4.500,00`. */
    readonly amountText: string;
    readonly direction: TransactionDirection;
}

/** Cadastros da lista de entradas sem sócio. */
export interface UnassignedEntrySource {
    readonly profileId: string;
    /** Todas as contas do perfil, desativadas incluídas. */
    readonly accounts: readonly Pick<AccountResponse, 'id' | 'name'>[];
    /** Cartões do perfil; a conta pagadora é exigida pela linha de Transações que a lista reaproveita. */
    readonly creditCards: readonly Pick<CreditCardResponse, 'id' | 'name' | 'accountId'>[];
    readonly categories: readonly CategoryBranchResponse[];
    readonly tags: readonly Pick<TagResponse, 'id' | 'name'>[];
    /**
     * Contas dos outros perfis, para nomear a origem da transferência que chega de lá — a linha é
     * do perfil de origem, e a conta dela não está nas contas deste perfil.
     */
    readonly otherProfileAccounts: readonly OtherProfileAccount[];
}

/** A lista de entradas sem sócio pronta para a tela. */
export interface UnassignedEntryList {
    readonly rows: readonly UnassignedEntryRow[];
    /** `+R$ 4.500,00`: o total do indicador, com o sinal de entrada das linhas. */
    readonly totalText: string;
}

/**
 * Lista "Entradas sem sócio": a mesma linha do drill-down dos outros relatórios, para que o
 * lançamento apareça igual em toda tela — a receita com `+`, a transferência vinda de outro perfil
 * como "Transferência recebida", com `⇄ +` e a conta de origem com o perfil dela.
 * Regra de negócio (Relatórios, P5): a lista vem do núcleo pelo mês do pagamento e soma o
 * indicador "Entradas sem sócio".
 *
 * @param response Entradas sem sócio e o total.
 * @param source Cadastros para os nomes de conta, cartão, subcategoria, tag e das contas de
 * outros perfis.
 * @return As linhas, por data, e o total.
 */
export function buildUnassignedEntryList(response: EntriesWithoutPartnerResponse, source: UnassignedEntrySource): UnassignedEntryList {
    // A situação não aparece nesta lista, então as faturas não são necessárias; sem elas, a
    // tabela nunca agrupa, e toda linha é um lançamento.
    const table = buildTransactionTable({ ...source, transactions: response.transactions, invoices: [] }, NO_TRANSACTION_FILTERS);
    const tagNames = new Map(source.tags.map((tag) => [tag.id, tag.name]));
    return {
        rows: table.rows.flatMap((row) => (row.kind !== 'transaction' ? [] : [{
            id: row.id,
            transaction: row.transaction,
            date: row.date,
            name: row.name,
            category: row.category,
            container: row.container,
            tags: row.transaction.tagIds.flatMap((id) => {
                const name = tagNames.get(id);
                return name === undefined ? [] : [name];
            }),
            amountText: row.amountText,
            direction: row.direction,
        }])),
        totalText: formatMoney(response.total, 'always'),
    };
}

/** Tolerância da soma das participações, a mesma do núcleo. */
const SHARES_EPSILON = 1e-9;

/**
 * @param share Proporção (0,6).
 * @return `60%` quando inteira; `33,3%` com uma casa quando não.
 */
function shareText(share: number): string {
    return formatPercent(share, { sign: 'negative', decimals: Number.isInteger(roundHalfAwayFromZero(share * 100, 1)) ? 0 : 1 });
}

/**
 * A diferença lida sem depender da cor (decisão de interface 7): seta, sinal e as palavras.
 *
 * @param difference Aportou − deveria.
 * @return O texto e o lado da diferença.
 */
function differenceOf(difference: MoneyResponse): { readonly difference: string; readonly balance: PartnerBalance } {
    if (isZero(difference)) {
        return { difference: 'em dia', balance: 'even' };
    }
    return difference.amount > 0
        ? { difference: `▲ ${formatMoney(difference, 'always')} · aportou a mais`, balance: 'more' }
        : { difference: `▼ ${formatMoney(difference, 'always')} · aportou a menos`, balance: 'less' };
}

/**
 * @param report Relatório sem transferência a sugerir.
 * @param complete Se as participações somam 100%.
 * @return Por que não há acerto: sem sócio, sem aporte, participações erradas ou aportes
 * equilibrados.
 */
function noteOf(report: PartnerReportResponse, complete: boolean): string {
    if (report.partners.length === 0) {
        return 'Este perfil ainda não tem sócios cadastrados. Cadastre os sócios e as participações na tela Sócios para ver quanto cada um deveria ter aportado.';
    }
    if (!complete) {
        return 'Sem acerto sugerido: as participações não somam 100%.';
    }
    if (isZero(report.contributions)) {
        return 'Nenhum aporte com sócio ainda. Vincule o sócio às receitas e transferências que são aporte.';
    }
    return 'Os aportes estão equilibrados: cada sócio aportou a sua parte.';
}

/**
 * Largura de uma barra. Valor negativo (devoluções maiores que os aportes) não tem barra.
 *
 * @param amount Valor da barra.
 * @param largest Maior valor entre as barras, que ocupa a largura toda.
 * @return A largura em %, de 0 a 100.
 */
function widthOf(amount: number, largest: number): number {
    return largest <= 0 || amount <= 0 ? 0 : Math.round((amount / largest) * 1000) / 10;
}

/**
 * @param money Valor do núcleo.
 * @return O `Money` correspondente, para somar sem erro de ponto flutuante na tela.
 */
function moneyOf(money: MoneyResponse): Money {
    return Money.of(money.amount, Currency.of(money.currency));
}

/**
 * @param money Valor do núcleo.
 * @return `true` quando a tela o mostraria como zero.
 */
function isZero(money: MoneyResponse): boolean {
    return moneyOf(money).rounded().isZero();
}

/**
 * @param count Quantidade.
 * @param singular Palavra no singular.
 * @param plural Palavra no plural.
 * @return `1 lançamento` ou `2 lançamentos`.
 */
function countLabel(count: number, singular: string, plural: string): string {
    return `${String(count)} ${count === 1 ? singular : plural}`;
}
