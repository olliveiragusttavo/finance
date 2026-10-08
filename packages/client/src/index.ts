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
export { formatVariation, type VariationDirection, type VariationView } from './format/variation.ts';
export { matchesAllTerms, normalizeForSearch } from './format/searchText.ts';
export { parseMoneyInput, type MoneyInputRejection, type MoneyInputResult } from './format/parseMoneyInput.ts';
export * from './viewModels/transactionTable.ts';
export * from './viewModels/transactionEditor.ts';
export * from './viewModels/recurrenceView.ts';
export * from './viewModels/categoryReport.ts';
export * from './viewModels/cardImpactGrid.ts';
export * from './viewModels/deletionImpact.ts';
export * from './viewModels/statementTable.ts';
export * from './viewModels/invoiceView.ts';
