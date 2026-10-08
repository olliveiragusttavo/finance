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
export { APP_UUID_NAMESPACE, deriveUuid } from './domain/shared/DeterministicIds.ts';
export { parseUuid, type Uuid } from './domain/shared/ids.ts';
export { LocalDate } from './domain/shared/LocalDate.ts';
export { YearMonth } from './domain/shared/YearMonth.ts';
export { Currency } from './domain/shared/Currency.ts';
export { MONEY_MAX_AMOUNT, Money, roundHalfAwayFromZero } from './domain/shared/Money.ts';
// Regras puras do tipo da transação: o formulário de lançamento mostra o sinal do efeito e pede
// a conta de destino e a meta pela mesma regra que o núcleo aplica, sem reimplementá-la na UI.
export { feedsGoal, movesToDestination, originEffect, TRANSACTION_TYPES, type TransactionType } from './domain/transaction/TransactionType.ts';
