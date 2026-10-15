import { toImportResponse, type ImportResponse } from '../dto/imports/ImportResponse.ts';
import { runImportRequest } from '../requests/importRequests.ts';
import type { ImportService } from '../services/import/ImportService.ts';
import { handle, type CoreResult, type UnexpectedErrorListener } from './CoreResult.ts';

/** Rotas da importação de transações (import-design). */
export class ImportController {
    /**
     * @param imports Importação.
     * @param onUnexpected Destino do log de falhas inesperadas.
     */
    public constructor(
        private readonly imports: ImportService,
        private readonly onUnexpected: UnexpectedErrorListener,
    ) {}

    /**
     * @param raw Linhas do arquivo, opções e decisões da revisão.
     * @return O resumo do que foi gravado.
     */
    public run(raw: unknown): Promise<CoreResult<ImportResponse>> {
        return handle(runImportRequest, raw, (command) => toImportResponse(this.imports.run(command)), this.onUnexpected);
    }
}
