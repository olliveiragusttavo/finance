// API pública do núcleo: composição, contrato de rotas, portas e o domínio que os
// adaptadores e testes precisam enxergar. O resto é detalhe interno do pacote.
export { createCore, openDatabase, type Core, type CorePorts, type CoreServices } from './composition/createCore.ts';
export type { CoreApi, CoreInput, CoreOutput, CoreRoute, CoreRoutes } from './controllers/routes.ts';
export type { CoreError, CoreResult } from './controllers/CoreResult.ts';
export type * from './dto/index.ts';
export type { Clock, Timestamp } from './ports/Clock.ts';
export type { Database, SqlParams, SqlRow, SqlValue } from './ports/Database.ts';
export type { IdGenerator } from './ports/IdGenerator.ts';
export type { ErrorCode, ErrorDetails } from './domain/shared/errors.ts';
export { SchemaNewerThanAppError, type MigrationReport } from './infrastructure/migrations/MigrationRunner.ts';
export { APP_UUID_NAMESPACE, deriveUuid } from './domain/shared/DeterministicIds.ts';
export { LocalDate } from './domain/shared/LocalDate.ts';
export { YearMonth } from './domain/shared/YearMonth.ts';
export { Currency } from './domain/shared/Currency.ts';
export { Money } from './domain/shared/Money.ts';
