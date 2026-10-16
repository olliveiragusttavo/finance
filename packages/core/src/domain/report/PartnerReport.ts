import { byLargestShare, type Partner } from '../partner/Partner.ts';
import type { PartnerId } from '../shared/ids.ts';
import { Money } from '../shared/Money.ts';
import type { YearMonth } from '../shared/YearMonth.ts';
import type { PartnerContributionTotals } from './ReportTotals.ts';

/** Um sócio no relatório: quanto aportou e quanto deveria ter aportado pela participação. */
export interface PartnerLine {
    readonly partnerId: PartnerId;
    readonly name: string;
    /** Participação de 0 a 1. */
    readonly share: number;
    /** Aportes do sócio em todos os períodos. */
    readonly contributed: Money;
    /** Parte do total de aportes pela participação. */
    readonly expected: Money;
    /** Aportou − deveria: positivo quando aportou a mais; negativo, a menos. */
    readonly difference: Money;
    /** Lançamentos de aporte do sócio, em todos os períodos. */
    readonly count: number;
}

/** Uma transferência do acerto: quem aportou a menos repõe a quem aportou a mais. */
export interface PartnerSettlement {
    readonly from: PartnerId;
    readonly to: PartnerId;
    readonly amount: Money;
}

/** O relatório por sócio de um perfil empresarial, com o mês de referência para a lista do mês. */
export interface PartnerReport {
    readonly reference: YearMonth;
    /** Total de aportes com sócio em todos os períodos: a base da divisão pela participação. */
    readonly contributions: Money;
    /** Aportes com sócio no mês de referência. */
    readonly monthContributions: Money;
    readonly monthContributionCount: number;
    /** Entradas do mês de referência sem sócio — receitas de serviço e aportes ainda sem dono. */
    readonly unassigned: Money;
    readonly unassignedCount: number;
    /** Todos os sócios vivos do perfil, inclusive os que nunca aportaram. */
    readonly partners: readonly PartnerLine[];
    /** Soma das participações, de 0 a 1 quando o cadastro está certo. */
    readonly sharesTotal: number;
    /**
     * Quem transfere quanto a quem para que cada um tenha aportado a sua parte. Vazio quando já
     * está equilibrado ou quando as participações não somam 100%.
     */
    readonly settlements: readonly PartnerSettlement[];
}

/** Dados de entrada do montador, lidos pelo Service na mesma unidade de trabalho. */
export interface PartnerReportInput {
    readonly reference: YearMonth;
    readonly partners: readonly Partner[];
    readonly totals: readonly PartnerContributionTotals[];
    readonly zero: Money;
}

/**
 * Tolerância da soma das participações: são `REAL` no banco, e 33,33 + 33,33 + 33,34 não dá 100
 * exato em ponto flutuante.
 */
const SHARES_EPSILON = 1e-9;

/**
 * Monta o relatório por sócio.
 * Regra de negócio (Sócios — aportes, reports-design §8, P1–P5): toda despesa do perfil
 * empresarial é paga com o dinheiro da empresa, e o que cada sócio põe nela são os **aportes** —
 * receitas e transferências vindas de outro perfil com o sócio vinculado. O total de aportes de
 * **todos os períodos** é dividido pela participação: Matheus (60%) e Gustavo (40%) aportaram
 * R$ 1.000,00 cada; do total de R$ 2.000,00, Matheus deveria ter aportado R$ 1.200,00 e Gustavo
 * R$ 800,00. As entradas sem sócio ficam fora da divisão: a receita de serviço é lucro, não aporte.
 * O mês de referência só recorta os números do mês (aportes e entradas sem sócio a atribuir).
 *
 * Os valores trabalham em unidades menores inteiras para que a divisão feche exatamente na base e
 * o acerto zere todas as diferenças, sem sobra de centavo.
 *
 * @param input Mês, sócios vivos do perfil, somas por sócio e o zero na moeda do perfil.
 * @return O relatório, com os sócios pela participação (maior primeiro).
 */
export function buildPartnerReport(input: PartnerReportInput): PartnerReport {
    const { zero } = input;
    const known = new Set(input.partners.map((partner) => partner.id));
    const contributedCents = new Map<PartnerId, number>();
    const counts = new Map<PartnerId, number>();
    let monthCents = 0;
    let monthCount = 0;
    let unassignedCents = 0;
    let unassignedCount = 0;
    for (const row of input.totals) {
        if (row.partnerId !== null && known.has(row.partnerId)) {
            contributedCents.set(row.partnerId, (contributedCents.get(row.partnerId) ?? 0) + toMinor(row.total));
            counts.set(row.partnerId, (counts.get(row.partnerId) ?? 0) + row.count);
            monthCents += toMinor(row.month);
            monthCount += row.monthCount;
        } else {
            unassignedCents += toMinor(row.month);
            unassignedCount += row.monthCount;
        }
    }
    const ordered = [...input.partners].sort(byLargestShare);
    const baseCents = ordered.reduce((total, partner) => total + (contributedCents.get(partner.id) ?? 0), 0);
    const sharesTotal = ordered.reduce((total, partner) => total + partner.share(), 0);
    const complete = Math.abs(sharesTotal - 1) < SHARES_EPSILON;
    const expectedCents = allocateByShares(baseCents, ordered.map((partner) => partner.share()), complete);
    const lines = ordered.map((partner, index): PartnerLine => {
        const contributed = contributedCents.get(partner.id) ?? 0;
        const expected = expectedCents[index] ?? 0;
        return {
            partnerId: partner.id,
            name: partner.name,
            share: partner.share(),
            contributed: fromMinor(contributed, zero),
            expected: fromMinor(expected, zero),
            difference: fromMinor(contributed - expected, zero),
            count: counts.get(partner.id) ?? 0,
        };
    });
    return {
        reference: input.reference,
        contributions: fromMinor(baseCents, zero),
        monthContributions: fromMinor(monthCents, zero),
        monthContributionCount: monthCount,
        unassigned: fromMinor(unassignedCents, zero),
        unassignedCount,
        partners: lines,
        sharesTotal,
        // Regra de negócio (Relatórios, P4): sem as participações somando 100% as diferenças não
        // fecham em zero, e qualquer acerto sugerido deixaria alguém aportando a parte de outro.
        settlements: complete ? settle(lines, zero) : [],
    };
}

/**
 * Divide a base pelas participações. Exportada para que a prévia do cadastro de sócios (mockup
 * `DesktopSocios`, "Deveria pagar") divida pela mesma conta do relatório e nunca discorde dele
 * por um centavo.
 * Regra de negócio (Relatórios, P3): com as participações somando 100%, a sobra do arredondamento
 * vai, centavo a centavo, para as maiores frações descartadas (maior resto), e a soma das partes
 * é exatamente a base — R$ 100,00 em três terços é 33,34 + 33,33 + 33,33. Sem somar 100%, a soma
 * não teria de fechar, e cada parte é só arredondada.
 *
 * @param totalCents Base em unidades menores; pode ser negativa quando os estornos superam as compras.
 * @param shares Participação de cada sócio, de 0 a 1, na ordem da saída.
 * @param complete Se as participações somam 100%.
 * @return A parte de cada sócio em unidades menores, na ordem de `shares`.
 */
export function allocateByShares(totalCents: number, shares: readonly number[], complete: boolean): readonly number[] {
    const sign = totalCents < 0 ? -1 : 1;
    const magnitude = Math.abs(totalCents);
    if (!complete) {
        return shares.map((share) => sign * Math.round(magnitude * share));
    }
    const exact = shares.map((share) => magnitude * share);
    const parts = exact.map((value) => Math.floor(value + SHARES_EPSILON));
    let remainder = magnitude - parts.reduce((total, part) => total + part, 0);
    // Índices pela fração descartada, maior primeiro; o empate fica com quem vem antes na lista
    // (maior participação), para que a mesma base dê sempre a mesma divisão.
    const byFraction = exact.map((value, index) => ({ index, fraction: value - (parts[index] ?? 0) })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
    for (const { index } of byFraction) {
        if (remainder <= 0) {
            break;
        }
        parts[index] = (parts[index] ?? 0) + 1;
        remainder--;
    }
    return parts.map((part) => sign * part);
}

/**
 * Acerto dos aportes: quem aportou a menos transfere para quem aportou a mais, e o total aportado
 * fica dividido como as participações.
 * Regra de negócio (Relatórios, P4): o maior devedor paga primeiro o maior credor, até zerar um
 * dos dois, e assim por diante — com dois sócios é uma transferência só ("Matheus transfere
 * R$ 200,00 para Gustavo"); com mais, no máximo uma a menos que o número de sócios.
 *
 * @param lines Sócios com a diferença já calculada; as diferenças somam zero.
 * @param zero Zero na moeda do perfil.
 * @return As transferências, da maior para a menor.
 */
function settle(lines: readonly PartnerLine[], zero: Money): readonly PartnerSettlement[] {
    const debtors = lines.map((line) => ({ id: line.partnerId, cents: -toMinor(line.difference) })).filter((entry) => entry.cents > 0);
    const creditors = lines.map((line) => ({ id: line.partnerId, cents: toMinor(line.difference) })).filter((entry) => entry.cents > 0);
    debtors.sort((a, b) => b.cents - a.cents);
    creditors.sort((a, b) => b.cents - a.cents);
    const settlements: PartnerSettlement[] = [];
    let d = 0;
    let c = 0;
    while (d < debtors.length && c < creditors.length) {
        const debtor = debtors[d];
        const creditor = creditors[c];
        if (debtor === undefined || creditor === undefined) {
            break;
        }
        const cents = Math.min(debtor.cents, creditor.cents);
        settlements.push({ from: debtor.id, to: creditor.id, amount: fromMinor(cents, zero) });
        debtor.cents -= cents;
        creditor.cents -= cents;
        if (debtor.cents === 0) {
            d++;
        }
        if (creditor.cents === 0) {
            c++;
        }
    }
    return settlements;
}

/**
 * @param money Valor qualquer.
 * @return O valor arredondado em unidades menores inteiras (centavos no BRL).
 */
function toMinor(money: Money): number {
    return Math.round(money.rounded().amount * 10 ** money.currency.minorUnits);
}

/**
 * @param cents Unidades menores.
 * @param zero Zero na moeda de destino.
 * @return O valor na moeda.
 */
function fromMinor(cents: number, zero: Money): Money {
    return Money.of(cents / 10 ** zero.currency.minorUnits, zero.currency);
}
