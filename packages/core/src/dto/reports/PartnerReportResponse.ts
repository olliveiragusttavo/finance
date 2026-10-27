import type { PartnerLine, PartnerReport, PartnerSettlement } from '../../domain/report/PartnerReport.ts';
import type { EntriesWithoutPartnerView } from '../../services/report/FixedReportViews.ts';
import { toMoneyResponse, type MoneyResponse } from '../shared/MoneyResponse.ts';
import { toTransactionResponse, type TransactionResponse } from '../transactions/TransactionResponse.ts';

/** Um sócio do relatório. */
export interface PartnerLineResponse {
    readonly partnerId: string;
    readonly name: string;
    /** Participação como proporção (0,6 para 60%). */
    readonly share: number;
    /** Aportes do sócio em todos os períodos. */
    readonly contributed: MoneyResponse;
    /** Parte do total de aportes pela participação. */
    readonly expected: MoneyResponse;
    /** Aportou − deveria: positivo quando aportou a mais. */
    readonly difference: MoneyResponse;
    /** Lançamentos de aporte do sócio, em todos os períodos. */
    readonly count: number;
}

/** Uma transferência do acerto dos aportes. */
export interface PartnerSettlementResponse {
    readonly fromPartnerId: string;
    readonly toPartnerId: string;
    readonly amount: MoneyResponse;
}

/** Relatório por sócio (rota `reports.byPartner`). */
export interface PartnerReportResponse {
    /** Mês de referência, que recorta os números do mês. */
    readonly period: string;
    /** Total de aportes com sócio em todos os períodos: a base da divisão. */
    readonly contributions: MoneyResponse;
    /** Aportes com sócio no mês de referência. */
    readonly monthContributions: MoneyResponse;
    readonly monthContributionCount: number;
    /** Entradas do mês sem sócio, fora da divisão. */
    readonly unassigned: MoneyResponse;
    readonly unassignedCount: number;
    /** Pela participação, maior primeiro; todos os sócios vivos do perfil. */
    readonly partners: readonly PartnerLineResponse[];
    /** Soma das participações (1 para 100%); a tela avisa quando difere. */
    readonly sharesTotal: number;
    /** Vazio quando já está equilibrado ou quando as participações não somam 100%. */
    readonly settlements: readonly PartnerSettlementResponse[];
}

/** Entradas do mês sem sócio (rota `reports.entriesWithoutPartner`). */
export interface EntriesWithoutPartnerResponse {
    readonly period: string;
    /** Receitas do perfil e transferências vindas de outro perfil. */
    readonly transactions: readonly TransactionResponse[];
    /** O que entrou no saldo, o mesmo valor do indicador "Entradas sem sócio". */
    readonly total: MoneyResponse;
}

/**
 * @param line Sócio do domínio.
 * @return O sócio serializável, com os valores arredondados.
 */
function toLineResponse(line: PartnerLine): PartnerLineResponse {
    return {
        partnerId: line.partnerId,
        name: line.name,
        share: line.share,
        contributed: toMoneyResponse(line.contributed),
        expected: toMoneyResponse(line.expected),
        difference: toMoneyResponse(line.difference),
        count: line.count,
    };
}

/**
 * @param settlement Transferência do domínio.
 * @return A transferência serializável.
 */
function toSettlementResponse(settlement: PartnerSettlement): PartnerSettlementResponse {
    return { fromPartnerId: settlement.from, toPartnerId: settlement.to, amount: toMoneyResponse(settlement.amount) };
}

/**
 * @param report Relatório montado pelo domínio.
 * @return O relatório serializável.
 */
export function toPartnerReportResponse(report: PartnerReport): PartnerReportResponse {
    return {
        period: report.reference.toString(),
        contributions: toMoneyResponse(report.contributions),
        monthContributions: toMoneyResponse(report.monthContributions),
        monthContributionCount: report.monthContributionCount,
        unassigned: toMoneyResponse(report.unassigned),
        unassignedCount: report.unassignedCount,
        partners: report.partners.map(toLineResponse),
        sharesTotal: report.sharesTotal,
        settlements: report.settlements.map(toSettlementResponse),
    };
}

/**
 * @param view Lista montada pelo Service.
 * @return A lista serializável.
 */
export function toEntriesWithoutPartnerResponse(view: EntriesWithoutPartnerView): EntriesWithoutPartnerResponse {
    return { period: view.period.toString(), transactions: view.transactions.map(toTransactionResponse), total: toMoneyResponse(view.total) };
}
