import type { ProfileResponse, ReportDefinitionResponse } from '@finance/core';
import { z } from 'zod';

/*
 * Relatório aberto na página de Relatórios e no editor (reports-design, Fase 15). Fica na URL
 * como *search param* `report`, como a conta em Contas: voltar no histórico devolve o relatório
 * que estava aberto, e o relatório salvo abre pela navegação. Os relatórios fixos (§8 e §9) usam
 * o mesmo parâmetro, com uma chave própria no lugar do id.
 */

/** Relatórios fixos, na ordem em que ficam no topo da lista. */
export const FIXED_REPORTS = ['projection', 'partners'] as const;

/** Um relatório fixo. */
export type FixedReport = (typeof FIXED_REPORTS)[number];

/** Nome de cada relatório fixo na lista e no título. */
export const FIXED_REPORT_NAMES: Readonly<Record<FixedReport, string>> = {
    projection: 'Projeção de saldo',
    partners: 'Distribuição por sócio',
};

/** Parâmetros de busca da página de Relatórios e do editor. */
export interface ReportsSearch {
    /**
     * Relatório aberto: o id de um salvo ou a chave de um fixo. Na página, ausente abre o primeiro
     * fixo; no editor, só o id vale, e ausente cria um novo.
     */
    readonly report?: string;
}

/** Ids do núcleo são UUIDs; outro texto só vale se for a chave de um fixo. */
const savedSchema = z.uuid();

const reportSchema = z.union([savedSchema, z.enum(FIXED_REPORTS)]);

/**
 * Valida a busca da URL da página. O parâmetro malformado (URL editada) é descartado em vez de
 * derrubar a rota.
 *
 * @param search Busca crua, como o roteador a leu.
 * @return O relatório pedido, quando o parâmetro é um id ou a chave de um fixo.
 */
export function parseReportsSearch(search: Readonly<Record<string, unknown>>): ReportsSearch {
    const report = reportSchema.safeParse(search['report']);
    return report.success ? { report: report.data } : {};
}

/**
 * Valida a busca da URL do editor. Só o id de um relatório salvo vale: um fixo não se edita, e a
 * chave dele vinda da página (o "+ Novo" mantém a busca) abre o editor de um relatório novo.
 *
 * @param search Busca crua, como o roteador a leu.
 * @return O relatório salvo a editar, quando o parâmetro é um id.
 */
export function parseReportEditorSearch(search: Readonly<Record<string, unknown>>): ReportsSearch {
    const report = savedSchema.safeParse(search['report']);
    return report.success ? { report: report.data } : {};
}

/**
 * Regra de negócio (Perfis): sócio só existe em perfil empresarial (database-design §4.2), então a
 * distribuição por sócio só fica fixada nele; a projeção de saldo, em todos.
 *
 * @param profileType Tipo do perfil ativo.
 * @return Os relatórios fixos do perfil, na ordem da lista.
 */
export function fixedReportsFor(profileType: ProfileResponse['type']): readonly FixedReport[] {
    return FIXED_REPORTS.filter((report) => report !== 'partners' || profileType === 'business');
}

/** O relatório que a página mostra: um fixo ou um salvo. */
export type OpenReport = { readonly kind: 'fixed'; readonly report: FixedReport } | { readonly kind: 'saved'; readonly report: ReportDefinitionResponse };

/**
 * Relatório que a página mostra. Quando o da URL não existe mais — excluído aqui, pedido em outro
 * perfil, ou a distribuição por sócio depois de trocar para um perfil pessoal —, vale o primeiro
 * fixo, e a página nunca fica num relatório "não encontrado" nem vazia.
 *
 * @param reports Relatórios salvos do perfil, por nome.
 * @param fixed Relatórios fixos do perfil; nunca vazio, porque a projeção vale em todos.
 * @param search Busca já validada.
 * @return O relatório da URL, ou o primeiro fixo.
 */
export function openReport(reports: readonly ReportDefinitionResponse[], fixed: readonly FixedReport[], search: ReportsSearch): OpenReport {
    const saved = reports.find((report) => report.id === search.report);
    if (saved !== undefined) {
        return { kind: 'saved', report: saved };
    }
    const pinned = fixed.find((report) => report === search.report) ?? fixed[0] ?? 'projection';
    return { kind: 'fixed', report: pinned };
}
