// API pública do núcleo: composição, contrato de rotas, portas e o domínio que os
// adaptadores e testes precisam enxergar. O resto é detalhe interno do pacote.
export { createCore, openDatabase, type Core, type CorePorts, type CoreServices, type OpenDatabaseOptions } from './composition/createCore.ts';
export type { CoreApi, CoreInput, CoreOutput, CoreRoute, CoreRoutes } from './controllers/routes.ts';
export type { CoreError, CoreResult } from './controllers/CoreResult.ts';
export type * from './dto/index.ts';
export type { BackupDirectory } from './ports/BackupDirectory.ts';
export { parseTimestamp, type Clock, type Timestamp } from './ports/Clock.ts';
export type { Database, SqlParams, SqlRow, SqlValue } from './ports/Database.ts';
export type { IdGenerator } from './ports/IdGenerator.ts';
export type { BusinessRule, ErrorCode, ErrorDetails } from './domain/shared/errors.ts';
export { MigrationFailedError, MigrationIntegrityError, SchemaNewerThanAppError, type MigrationReport } from './infrastructure/migrations/MigrationRunner.ts';
export { MigrationBackupError, newestBackup } from './infrastructure/migrations/PreMigrationBackup.ts';
export { copyDatabaseTo, DatabaseCopyError } from './infrastructure/sqlite/DatabaseCopy.ts';
export { APP_UUID_NAMESPACE, deriveUuid } from './domain/shared/DeterministicIds.ts';
export { parseUuid, type Uuid } from './domain/shared/ids.ts';
export { LocalDate } from './domain/shared/LocalDate.ts';
export { YearMonth } from './domain/shared/YearMonth.ts';
export { Currency } from './domain/shared/Currency.ts';
export { MONEY_MAX_AMOUNT, Money, roundHalfAwayFromZero } from './domain/shared/Money.ts';
// Modos de comparação dos relatórios: a tela valida o modo vindo da URL pela mesma lista que a
// Request usa, sem manter uma cópia própria.
export { COMPARISON_MODES, type ComparisonMode } from './domain/report/Comparison.ts';
export { TAG_REPORT_RANGES, type TagReportRange } from './domain/report/TagReport.ts';
export type { FlowMonthTiming } from './domain/report/AccountFlowReport.ts';
// Regras puras do tipo da transação: o formulário de lançamento mostra o sinal do efeito e pede
// a conta de destino e a meta pela mesma regra que o núcleo aplica, sem reimplementá-la na UI.
export { feedsGoal, movesToDestination, originEffect, TRANSACTION_TYPES, withdrawsFromGoal, type TransactionType } from './domain/transaction/TransactionType.ts';
// Análise da importação: a tela de revisão mostra os números pela mesma função que o núcleo usa
// ao gravar, para que a prévia aprovada nunca discorde do que entra no banco (import-design §2).
export { analyzeImport, type ImportAccountUse, type ImportAnalysis, type ImportCategoryUse, type ImportCreditCardUse, type ImportIssue, type ImportIssueReason, type ImportSource, type PlannedRow, type PlannedSeries } from './domain/import/ImportAnalysis.ts';
export { IMPORT_TRANSACTION_TYPES, type ImportOptions, type ImportRepetition, type ImportRow, type ImportTransactionType } from './domain/import/ImportRow.ts';
export { RECURRENCE_FREQUENCIES, type RecurrenceFrequency } from './domain/recurrence/RecurrenceSchedule.ts';
