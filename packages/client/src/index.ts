// API pública do `client`: a camada headless compartilhada entre desktop e mobile
// (desktop-shell-design §4.2) — contrato do núcleo, hooks de dados, formatadores e
// view-models. Nada aqui importa React DOM, React Native, Electron ou Node.
export { DirectCoreClient, type CoreCallScheduler, type CoreClient } from './core/CoreClient.ts';
export { CoreCallError } from './errors/CoreCallError.ts';
export { describeError, type ErrorDescription } from './errors/describeError.ts';
export { allRoutes, coreQueryKey, coreRouteKey, CORE_QUERY_ROOT, isReadRoute, type ReadRoute, type WriteRoute } from './queries/routes.ts';
export { invalidatedBy, isRehearsalRoute, REHEARSAL_ROUTES, type RehearsalRoute } from './queries/invalidation.ts';
export { CoreClientProvider, useCoreClient } from './hooks/CoreClientContext.tsx';
export { callOrThrow, createQueryClient, invalidateAfter, invalidateAllCoreQueries, useCoreMutation, useCoreQueries, useCoreQuery } from './hooks/coreHooks.ts';
export * from './hooks/routeHooks.ts';
export { formatMoney, formatMoneyCompact, formatMoneyDigits, formatMoneyForInput, MINUS, type MoneySign } from './format/money.ts';
export { formatDate, formatDayMonth, formatMonthAbbreviation, formatMonthLong, formatMonthShort } from './format/dates.ts';
export { formatPercent } from './format/percent.ts';
export { formatProfileSummary, formatProfileType } from './format/profile.ts';
export { formatAccountHeading, formatAccountType } from './format/account.ts';
export { summarizeNote, type NoteSummary } from './format/note.ts';
export { matchesAllTerms, normalizeForSearch } from './format/searchText.ts';
export { parseMoneyInput, type MoneyInputRejection, type MoneyInputResult } from './format/parseMoneyInput.ts';
// Leitura dos formulários com os schemas do núcleo, comum ao desktop e ao celular
// (desktop-shell-design §5.4): as mensagens de erro de um campo são as mesmas nos dois apps.
export * from './forms/formIssues.ts';
export * from './forms/currencies.ts';
export * from './forms/onboardingForm.ts';
// Regras do shell comuns ao desktop e ao celular: mês corrente, mês vizinho e perfil reaberto.
export { currentDate, currentPeriod, isValidPeriod, pickActiveProfile, shiftPeriod } from './shell/referenceMonth.ts';
export * from './viewModels/otherProfileAccounts.ts';
export * from './viewModels/transactionTable.ts';
// Lista de Transações do celular (mockup `MobileTransacoes`): dias e totais da mesma tabela.
export * from './viewModels/transactionDays.ts';
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
// Calendário do mês (mockup `DesktopCalendario`): receitas × despesas e saldo do dia.
export * from './viewModels/calendarView.ts';
// Extrato em vários meses (mockup `DesktopExtrato`): o resultado de cada dia numa tabela dia × mês.
export * from './viewModels/dailyStatementView.ts';
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
export { blockingCopy, canTryRestore, restoreMessage, type BlockedStatus, type BlockingCopy, type RestoreState } from './startup/blockingCopy.ts';
export type { RestoreResult, StartupStatus } from './startup/openCoreSequence.ts';
