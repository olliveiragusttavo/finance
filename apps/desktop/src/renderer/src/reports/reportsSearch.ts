import type { ReportDefinitionResponse } from '@finance/core';
import { z } from 'zod';

/*
 * Relatório aberto na página de Relatórios e no editor (reports-design, Fase 15). Fica na URL
 * como *search param* `report`, como a conta em Contas: voltar no histórico devolve o relatório
 * que estava aberto, e o relatório salvo abre pela navegação.
 */

/** Parâmetros de busca da página de Relatórios e do editor. */
export interface ReportsSearch {
    /** Relatório aberto; na página, ausente abre o primeiro da lista; no editor, ausente cria um novo. */
    readonly report?: string;
}

/** Ids do núcleo são UUIDs; outro texto nunca é um relatório. */
const reportSchema = z.uuid();

/**
 * Valida a busca da URL. O parâmetro malformado (URL editada) é descartado em vez de derrubar a
 * rota.
 *
 * @param search Busca crua, como o roteador a leu.
 * @return O relatório pedido, quando o parâmetro tem formato válido.
 */
export function parseReportsSearch(search: Readonly<Record<string, unknown>>): ReportsSearch {
    const report = reportSchema.safeParse(search['report']);
    return report.success ? { report: report.data } : {};
}

/**
 * Relatório que a página mostra. Quando o da URL não existe mais — excluído aqui, ou pedido em
 * outro perfil —, vale o primeiro da lista, e a página nunca fica num relatório "não encontrado".
 *
 * @param reports Relatórios do perfil, por nome.
 * @param search Busca já validada.
 * @return O relatório da URL, ou o primeiro; `null` quando o perfil não tem nenhum.
 */
export function openReport(reports: readonly ReportDefinitionResponse[], search: ReportsSearch): ReportDefinitionResponse | null {
    return reports.find((report) => report.id === search.report) ?? reports[0] ?? null;
}
