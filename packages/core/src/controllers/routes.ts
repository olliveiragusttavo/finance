import type { z } from 'zod';
import type { AccountBalanceResponse } from '../dto/accounts/AccountBalanceResponse.ts';
import type { AccountListResponse } from '../dto/accounts/AccountListResponse.ts';
import type { AccountResponse } from '../dto/accounts/AccountResponse.ts';
import type { CategoryBranchResponse, CategoryResponse, SubCategoryResponse } from '../dto/categories/CategoryResponse.ts';
import type { CreditCardListResponse } from '../dto/creditCards/CreditCardListResponse.ts';
import type { CreditCardResponse } from '../dto/creditCards/CreditCardResponse.ts';
import type { AccountDeletionImpactResponse, CreditCardDeletionImpactResponse } from '../dto/deletion/DeletionImpactResponse.ts';
import type { IntegrityReportResponse } from '../dto/integrity/IntegrityReportResponse.ts';
import type { InvoiceCycleResponse } from '../dto/invoices/InvoiceCycleResponse.ts';
import type { InvoiceDetailResponse } from '../dto/invoices/InvoiceDetailResponse.ts';
import type { InvoiceResponse } from '../dto/invoices/InvoiceResponse.ts';
import type { InvoiceSuggestionResponse } from '../dto/invoices/InvoiceSuggestionResponse.ts';
import type { OnboardingResponse } from '../dto/onboarding/OnboardingResponse.ts';
import type { ProfileBalancesResponse } from '../dto/profiles/ProfileBalancesResponse.ts';
import type { ProfileResponse } from '../dto/profiles/ProfileResponse.ts';
import type { BalanceEvolutionResponse } from '../dto/reports/BalanceEvolutionResponse.ts';
import type { CardImpactResponse } from '../dto/reports/CardImpactResponse.ts';
import type { CategoryReportResponse } from '../dto/reports/CategoryReportResponse.ts';
import type { CategoryTransactionsResponse } from '../dto/reports/CategoryTransactionsResponse.ts';
import type { MonthSummaryResponse } from '../dto/reports/MonthSummaryResponse.ts';
import type { NoteResponse } from '../dto/notes/NoteResponse.ts';
import type { StatementResponse } from '../dto/statements/StatementResponse.ts';
import type { TagResponse, TagUsageResponse } from '../dto/tags/TagResponse.ts';
import type { OccurrencePreviewResponse, RecurrenceResponse } from '../dto/recurrences/RecurrenceResponse.ts';
import type { SeriesPlanResponse } from '../dto/recurrences/SeriesPlanResponse.ts';
import type { TopUpResponse } from '../dto/recurrences/TopUpResponse.ts';
import type { TransactionResponse } from '../dto/transactions/TransactionResponse.ts';
import type { accountIdRequest, createAccountRequest, listAccountsRequest, updateAccountRequest } from '../requests/accountRequests.ts';
import type { profileBalancesRequest, rebuildAccountRequest } from '../requests/balanceRequests.ts';
import type {
    categoryTreeRequest,
    createCategoryRequest,
    createSubCategoryRequest,
    deleteCategoryRequest,
    deleteSubCategoryRequest,
    renameCategoryRequest,
    renameSubCategoryRequest,
} from '../requests/categoryRequests.ts';
import type { createCreditCardRequest, creditCardIdRequest, listCreditCardsRequest, updateCreditCardRequest } from '../requests/creditCardRequests.ts';
import type { verifyBalancesRequest } from '../requests/integrityRequests.ts';
import type { invoiceIdRequest, listInvoicesByCardRequest, payInvoiceRequest, suggestInvoiceRequest } from '../requests/invoiceRequests.ts';
import type { startOnboardingRequest } from '../requests/onboardingRequests.ts';
import type { createProfileRequest, listProfilesRequest, updateProfileRequest } from '../requests/profileRequests.ts';
import type {
    balanceEvolutionRequest,
    cardImpactRequest,
    categoryReportRequest,
    categoryTransactionsRequest,
    monthSummaryRequest,
} from '../requests/reportRequests.ts';
import type { createNoteRequest, listNotesRequest, noteIdRequest, rewriteNoteRequest } from '../requests/noteRequests.ts';
import type {
    listRecurrencesRequest,
    planCreateRequest,
    planDeleteRequest,
    planUpdateRequest,
    previewRecurrenceRequest,
    recurrenceIdRequest,
    topUpRecurrencesRequest,
} from '../requests/recurrenceRequests.ts';
import type { getStatementRequest } from '../requests/statementRequests.ts';
import type { createTagRequest, listTagsRequest, renameTagRequest, tagIdRequest } from '../requests/tagRequests.ts';
import type {
    createTransactionRequest,
    deleteTransactionRequest,
    listTransactionsRequest,
    setPaidRequest,
    transactionIdRequest,
    updateTransactionRequest,
} from '../requests/transactionRequests.ts';
import type { CoreResult } from './CoreResult.ts';

/**
 * Mapa de rotas do núcleo: para cada rota, o DTO de entrada (o que o schema da camada
 * Request aceita) e o de saída. É o contrato tipado que o pacote `client` consome nas duas
 * plataformas (desktop-shell-design §5.1) — mudar uma rota aqui quebra a compilação da UI,
 * não o app em produção.
 */
export interface CoreRoutes {
    'profiles.list': { input: z.input<typeof listProfilesRequest>; output: readonly ProfileResponse[] };
    'profiles.create': { input: z.input<typeof createProfileRequest>; output: ProfileResponse };
    'profiles.update': { input: z.input<typeof updateProfileRequest>; output: ProfileResponse };
    'onboarding.start': { input: z.input<typeof startOnboardingRequest>; output: OnboardingResponse };
    'accounts.list': { input: z.input<typeof listAccountsRequest>; output: AccountListResponse };
    'accounts.create': { input: z.input<typeof createAccountRequest>; output: AccountResponse };
    'accounts.update': { input: z.input<typeof updateAccountRequest>; output: AccountResponse };
    'accounts.disable': { input: z.input<typeof accountIdRequest>; output: AccountResponse };
    'accounts.enable': { input: z.input<typeof accountIdRequest>; output: AccountResponse };
    'accounts.deletionImpact': { input: z.input<typeof accountIdRequest>; output: AccountDeletionImpactResponse };
    'accounts.delete': { input: z.input<typeof accountIdRequest>; output: null };
    'creditCards.list': { input: z.input<typeof listCreditCardsRequest>; output: CreditCardListResponse };
    'creditCards.create': { input: z.input<typeof createCreditCardRequest>; output: CreditCardResponse };
    'creditCards.update': { input: z.input<typeof updateCreditCardRequest>; output: CreditCardResponse };
    'creditCards.disable': { input: z.input<typeof creditCardIdRequest>; output: CreditCardResponse };
    'creditCards.enable': { input: z.input<typeof creditCardIdRequest>; output: CreditCardResponse };
    'creditCards.deletionImpact': { input: z.input<typeof creditCardIdRequest>; output: CreditCardDeletionImpactResponse };
    'creditCards.delete': { input: z.input<typeof creditCardIdRequest>; output: null };
    'categories.tree': { input: z.input<typeof categoryTreeRequest>; output: readonly CategoryBranchResponse[] };
    'categories.create': { input: z.input<typeof createCategoryRequest>; output: CategoryResponse };
    'categories.update': { input: z.input<typeof renameCategoryRequest>; output: CategoryResponse };
    'categories.delete': { input: z.input<typeof deleteCategoryRequest>; output: null };
    'subCategories.create': { input: z.input<typeof createSubCategoryRequest>; output: SubCategoryResponse };
    'subCategories.update': { input: z.input<typeof renameSubCategoryRequest>; output: SubCategoryResponse };
    'subCategories.delete': { input: z.input<typeof deleteSubCategoryRequest>; output: null };
    'tags.list': { input: z.input<typeof listTagsRequest>; output: readonly TagUsageResponse[] };
    'tags.create': { input: z.input<typeof createTagRequest>; output: TagResponse };
    'tags.update': { input: z.input<typeof renameTagRequest>; output: TagResponse };
    'tags.delete': { input: z.input<typeof tagIdRequest>; output: null };
    'notes.list': { input: z.input<typeof listNotesRequest>; output: readonly NoteResponse[] };
    'notes.create': { input: z.input<typeof createNoteRequest>; output: NoteResponse };
    'notes.update': { input: z.input<typeof rewriteNoteRequest>; output: NoteResponse };
    'notes.delete': { input: z.input<typeof noteIdRequest>; output: null };
    'transactions.create': { input: z.input<typeof createTransactionRequest>; output: TransactionResponse };
    'transactions.update': { input: z.input<typeof updateTransactionRequest>; output: TransactionResponse };
    'transactions.delete': { input: z.input<typeof deleteTransactionRequest>; output: null };
    'transactions.get': { input: z.input<typeof transactionIdRequest>; output: TransactionResponse };
    'transactions.listByPeriod': { input: z.input<typeof listTransactionsRequest>; output: readonly TransactionResponse[] };
    'transactions.setPaid': { input: z.input<typeof setPaidRequest>; output: TransactionResponse };
    'recurrences.list': { input: z.input<typeof listRecurrencesRequest>; output: readonly RecurrenceResponse[] };
    'recurrences.occurrences': { input: z.input<typeof recurrenceIdRequest>; output: readonly TransactionResponse[] };
    'recurrences.preview': { input: z.input<typeof previewRecurrenceRequest>; output: readonly OccurrencePreviewResponse[] };
    'recurrences.planCreate': { input: z.input<typeof planCreateRequest>; output: SeriesPlanResponse };
    'recurrences.planUpdate': { input: z.input<typeof planUpdateRequest>; output: SeriesPlanResponse };
    'recurrences.planDelete': { input: z.input<typeof planDeleteRequest>; output: SeriesPlanResponse };
    'recurrences.topUp': { input: z.input<typeof topUpRecurrencesRequest>; output: TopUpResponse };
    'statements.get': { input: z.input<typeof getStatementRequest>; output: StatementResponse };
    'balances.ofProfile': { input: z.input<typeof profileBalancesRequest>; output: ProfileBalancesResponse };
    'balances.rebuildAccount': { input: z.input<typeof rebuildAccountRequest>; output: AccountBalanceResponse };
    'invoices.suggest': { input: z.input<typeof suggestInvoiceRequest>; output: InvoiceSuggestionResponse };
    'invoices.get': { input: z.input<typeof invoiceIdRequest>; output: InvoiceDetailResponse };
    'invoices.listByCard': { input: z.input<typeof listInvoicesByCardRequest>; output: readonly InvoiceCycleResponse[] };
    'invoices.pay': { input: z.input<typeof payInvoiceRequest>; output: InvoiceResponse };
    'invoices.reopen': { input: z.input<typeof invoiceIdRequest>; output: InvoiceResponse };
    'integrity.verifyBalances': { input: z.input<typeof verifyBalancesRequest>; output: IntegrityReportResponse };
    'reports.monthSummary': { input: z.input<typeof monthSummaryRequest>; output: MonthSummaryResponse };
    'reports.balanceEvolution': { input: z.input<typeof balanceEvolutionRequest>; output: BalanceEvolutionResponse };
    'reports.byCategory': { input: z.input<typeof categoryReportRequest>; output: CategoryReportResponse };
    'reports.categoryTransactions': { input: z.input<typeof categoryTransactionsRequest>; output: CategoryTransactionsResponse };
    'reports.cardImpact': { input: z.input<typeof cardImpactRequest>; output: CardImpactResponse };
}

export type CoreRoute = keyof CoreRoutes;
export type CoreInput<R extends CoreRoute> = CoreRoutes[R]['input'];
export type CoreOutput<R extends CoreRoute> = CoreRoutes[R]['output'];

/**
 * Tabela rota → handler. Tipada por rota para que o compilador exija um handler para cada
 * rota do mapa e confira o tipo de saída de cada um.
 */
export type RouteHandlers = { readonly [R in CoreRoute]: (raw: unknown) => Promise<CoreResult<CoreOutput<R>>> };

/** O núcleo como a UI o enxerga, em qualquer plataforma. */
export interface CoreApi {
    /**
     * Chamada tipada, para quem conhece a rota em tempo de compilação (`DirectCoreClient`).
     *
     * @param route Rota chamada.
     * @param input Entrada da rota; validada de novo pela camada Request, porque o tipo em
     * tempo de compilação não protege contra o renderer.
     * @return O resultado da rota.
     */
    call<R extends CoreRoute>(route: R, input: CoreInput<R>): Promise<CoreResult<CoreOutput<R>>>;

    /**
     * Chamada não tipada, para o transporte (IPC) que recebe a rota como texto.
     *
     * @param route Nome da rota recebido do transporte.
     * @param input Entrada não confiável.
     * @return O resultado da rota; `VALIDATION_FAILED` quando a rota não existe.
     */
    dispatch(route: string, input: unknown): Promise<CoreResult<unknown>>;
}
