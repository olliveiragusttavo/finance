// Adaptadores das portas `Database` e `BackupDirectory` do núcleo sobre o `expo-sqlite` e o
// `expo-file-system`. Esta entrada não carrega código nativo, para rodar no Vitest; a
// abertura do banco no aparelho fica em `@finance/sqlite-expo/open`.
export { ExpoBackupDirectory, fileUriToPath, type ExpoBackupEntry, type ExpoBackupFolder } from './ExpoBackupDirectory.ts';
export { ExpoSqliteDatabase, prefixParams, type ExpoConnection, type ExpoExecuteResult, type ExpoStatement } from './ExpoSqliteDatabase.ts';
export { assertSqliteCapabilities, UnsupportedSqliteError } from './sqliteCapabilities.ts';
