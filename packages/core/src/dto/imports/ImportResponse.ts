import type { ImportOutcome } from '../../services/import/ImportCommands.ts';

/** O que a importação gravou, para a tela confirmar (mockup `DesktopImportRevisar`). */
export interface ImportResponse {
    readonly transactions: number;
    readonly fixedSeries: number;
    readonly installmentSeries: number;
    readonly invoicesPaid: number;
    readonly accountsCreated: number;
    readonly creditCardsCreated: number;
    readonly categoriesCreated: number;
    readonly subCategoriesCreated: number;
    readonly tagsCreated: number;
    readonly skipped: number;
}

/**
 * @param outcome Resultado do Service.
 * @return O resumo serializável — uma cópia campo a campo, para que um campo novo do Service não
 * vaze para o contrato sem passar por aqui.
 */
export function toImportResponse(outcome: ImportOutcome): ImportResponse {
    return {
        transactions: outcome.transactions,
        fixedSeries: outcome.fixedSeries,
        installmentSeries: outcome.installmentSeries,
        invoicesPaid: outcome.invoicesPaid,
        accountsCreated: outcome.accountsCreated,
        creditCardsCreated: outcome.creditCardsCreated,
        categoriesCreated: outcome.categoriesCreated,
        subCategoriesCreated: outcome.subCategoriesCreated,
        tagsCreated: outcome.tagsCreated,
        skipped: outcome.skipped,
    };
}
