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
export { copyDatabaseTo, DatabaseCopyError, inspectDatabaseCopy, type DatabaseCopyInspection, type DatabaseCopyRejection } from './infrastructure/sqlite/DatabaseCopy.ts';
export { APP_UUID_NAMESPACE, deriveUuid } from './domain/shared/DeterministicIds.ts';
export { parseUuid, type Uuid } from './domain/shared/ids.ts';
export { LocalDate } from './domain/shared/LocalDate.ts';
export { YearMonth } from './domain/shared/YearMonth.ts';
export { Currency } from './domain/shared/Currency.ts';
export { MONEY_MAX_AMOUNT, Money, roundHalfAwayFromZero } from './domain/shared/Money.ts';
// Vocabulário dos relatórios personalizados: o editor oferece as mesmas opções e limites que a
// Request aceita, sem manter uma cópia própria (reports-design §2 e §3).
export {
    REPORT_DATE_BASES,
    REPORT_MAX_PREVIOUS_MONTHS,
    REPORT_STATUS_FILTERS,
    REPORT_TAG_MATCHES,
    type ReportDateBasis,
    type ReportStatusFilter,
    type ReportTagMatch,
} from './domain/report/ReportFilter.ts';
export {
    REPORT_DIMENSIONS,
    REPORT_FLOW_GROUPS,
    REPORT_FORMATS,
    REPORT_MEASURES,
    REPORT_RECURRENCE_GROUPS,
    type ReportDimension,
    type ReportFlowGroup,
    type ReportFormat,
    type ReportMeasure,
    type ReportRecurrenceGroup,
} from './domain/report/ReportLayout.ts';
export { REPORT_NAME_MAX_LENGTH } from './domain/report/ReportDefinition.ts';
// Janelas da média da projeção de saldo: a tela oferece as mesmas que a Request aceita (reports-design §9).
export { BALANCE_PROJECTION_BASES, type BalanceProjectionBasis } from './domain/report/BalanceProjection.ts';
export { PARTNER_NAME_MAX_LENGTH } from './domain/partner/Partner.ts';
// Regras puras do tipo da transação: o formulário de lançamento mostra o sinal do efeito e pede
// a conta de destino e a meta pela mesma regra que o núcleo aplica, sem reimplementá-la na UI.
export { feedsGoal, movesToDestination, originEffect, TRANSACTION_TYPES, withdrawsFromGoal, type TransactionType } from './domain/transaction/TransactionType.ts';
// Análise da importação: a tela de revisão mostra os números pela mesma função que o núcleo usa
// ao gravar, para que a prévia aprovada nunca discorde do que entra no banco (import-design §2).
export { analyzeImport, type ImportAccountUse, type ImportAnalysis, type ImportCategoryUse, type ImportCreditCardUse, type ImportIssue, type ImportIssueReason, type ImportSource, type PlannedRow, type PlannedSeries } from './domain/import/ImportAnalysis.ts';
export { IMPORT_TRANSACTION_TYPES, type ImportOptions, type ImportRepetition, type ImportRow, type ImportTransactionType } from './domain/import/ImportRow.ts';
export { RECURRENCE_FREQUENCIES, type RecurrenceFrequency } from './domain/recurrence/RecurrenceSchedule.ts';
