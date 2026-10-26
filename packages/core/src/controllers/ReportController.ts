import { toReportDefinitionResponse, type ReportDefinitionResponse } from '../dto/reports/ReportDefinitionResponse.ts';
import { toReportResultResponse, type ReportResultResponse } from '../dto/reports/ReportResultResponse.ts';
import {
    createReportRequest,
    listReportsRequest,
    previewReportRequest,
    reportIdRequest,
    runReportRequest,
    updateReportRequest,
} from '../requests/reportRequests.ts';
import type { ReportService } from '../services/report/ReportService.ts';
import { handle, type CoreResult, type UnexpectedErrorListener } from './CoreResult.ts';

/** Rotas dos relatórios personalizados (reports-design §5). */
export class ReportController {
    /**
     * @param reports Cadastro e execução dos relatórios.
     * @param onUnexpected Destino do log de falhas inesperadas.
     */
    public constructor(
        private readonly reports: ReportService,
        private readonly onUnexpected: UnexpectedErrorListener,
    ) {}

    /**
     * @param raw Entrada com o perfil.
     * @return As definições do perfil, por nome.
     */
    public list(raw: unknown): Promise<CoreResult<readonly ReportDefinitionResponse[]>> {
        return handle(listReportsRequest, raw, ({ profileId }) => this.reports.list(profileId).map(toReportDefinitionResponse), this.onUnexpected);
    }

    /**
     * @param raw Entrada com a definição.
     * @return A definição, para o editor abrir.
     */
    public get(raw: unknown): Promise<CoreResult<ReportDefinitionResponse>> {
        return handle(reportIdRequest, raw, ({ id }) => toReportDefinitionResponse(this.reports.require(id)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com o perfil, o nome, o filtro e o formato.
     * @return A definição criada.
     */
    public create(raw: unknown): Promise<CoreResult<ReportDefinitionResponse>> {
        return handle(createReportRequest, raw, (command) => toReportDefinitionResponse(this.reports.create(command)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com a definição, o nome, o filtro e o formato.
     * @return A definição regravada.
     */
    public update(raw: unknown): Promise<CoreResult<ReportDefinitionResponse>> {
        return handle(updateReportRequest, raw, (command) => toReportDefinitionResponse(this.reports.update(command)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com a definição.
     * @return `null` em caso de sucesso.
     */
    public delete(raw: unknown): Promise<CoreResult<null>> {
        return handle(reportIdRequest, raw, ({ id }) => {
            this.reports.delete(id);
            return null;
        }, this.onUnexpected);
    }

    /**
     * @param raw Entrada com a definição e o mês de referência.
     * @return O resultado da definição salva.
     */
    public run(raw: unknown): Promise<CoreResult<ReportResultResponse>> {
        return handle(runReportRequest, raw, (command) => toReportResultResponse(this.reports.run(command)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com o perfil, o mês de referência, o filtro e o formato.
     * @return O resultado sem salvar, para o editor.
     */
    public preview(raw: unknown): Promise<CoreResult<ReportResultResponse>> {
        return handle(previewReportRequest, raw, (command) => toReportResultResponse(this.reports.preview(command)), this.onUnexpected);
    }
}
