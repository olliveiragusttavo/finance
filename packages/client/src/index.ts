// API pública do `client`: a camada headless compartilhada entre desktop e mobile
// (desktop-shell-design §4.2) — contrato do núcleo, hooks de dados, formatadores e
// view-models. Nada aqui importa React DOM, React Native, Electron ou Node.
export { DirectCoreClient, type CoreClient } from './core/CoreClient.ts';
export { CoreCallError } from './errors/CoreCallError.ts';
export { describeError, type ErrorDescription } from './errors/describeError.ts';
export { allRoutes, coreQueryKey, coreRouteKey, CORE_QUERY_ROOT, isReadRoute, type ReadRoute, type WriteRoute } from './queries/routes.ts';
export { invalidatedBy, isRehearsalRoute, REHEARSAL_ROUTES, type RehearsalRoute } from './queries/invalidation.ts';
export { CoreClientProvider, useCoreClient } from './hooks/CoreClientContext.tsx';
export { callOrThrow, createQueryClient, invalidateAfter, invalidateAllCoreQueries, useCoreMutation, useCoreQueries, useCoreQuery } from './hooks/coreHooks.ts';
export * from './hooks/routeHooks.ts';
export { formatMoney, formatMoneyForInput, MINUS, type MoneySign } from './format/money.ts';
export { formatDate, formatDayMonth, formatMonthAbbreviation, formatMonthLong, formatMonthShort } from './format/dates.ts';
export { formatPercent } from './format/percent.ts';
export { formatProfileSummary, formatProfileType } from './format/profile.ts';
export { formatAccountHeading, formatAccountType } from './format/account.ts';
export { summarizeNote, type NoteSummary } from './format/note.ts';
export { matchesAllTerms, normalizeForSearch } from './format/searchText.ts';
export { parseMoneyInput, type MoneyInputRejection, type MoneyInputResult } from './format/parseMoneyInput.ts';
export * from './viewModels/otherProfileAccounts.ts';
export * from './viewModels/transactionTable.ts';
export * from './viewModels/transactionEditor.ts';
export * from './viewModels/recurrenceView.ts';
export * from './viewModels/partnerRoster.ts';
export * from './viewModels/deletionImpact.ts';
export * from './viewModels/statementTable.ts';
export * from './viewModels/invoiceView.ts';
export * from './viewModels/movementList.ts';
export * from './viewModels/goalView.ts';
export * from './viewModels/listViews.ts';
export * from './viewModels/overviewView.ts';
// Relatórios personalizados (reports-design): o editor e a visualização do resultado.
export * from './viewModels/reportEditor.ts';
export * from './viewModels/reportView.ts';
// Relatórios fixos (reports-design §8 e §9): por sócio e projeção de saldo.
export * from './viewModels/partnerReport.ts';
export * from './viewModels/balanceProjection.ts';
// Importação de transações (import-design): leitura do arquivo, ligação de colunas e revisão.
export * from './import/csv.ts';
export * from './import/cellFormats.ts';
export * from './import/importFields.ts';
export * from './import/importTable.ts';
export * from './import/interpretRows.ts';
export * from './import/importReview.ts';
export * from './import/mappingTemplates.ts';
