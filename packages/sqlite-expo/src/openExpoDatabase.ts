import { Directory, File, Paths } from 'expo-file-system';
import { openDatabaseSync } from 'expo-sqlite';
import { ExpoBackupDirectory, fileUriToPath } from './ExpoBackupDirectory.ts';
import { ExpoSqliteDatabase } from './ExpoSqliteDatabase.ts';
import { assertSqliteCapabilities } from './sqliteCapabilities.ts';

/** Nome do arquivo do banco no aparelho, o mesmo do desktop. */
export const DATABASE_FILE_NAME = 'finance.sqlite';

/** Onde o banco e a pasta de backups moram no aparelho. */
export interface ExpoDatabaseLocation {
    /** Pasta do banco, que também guarda as marcas da abertura. */
    readonly folder: Directory;
    /** O arquivo do banco. */
    readonly databaseFile: File;
    /** `backups/`, ao lado do banco (backend-design §4.6). */
    readonly backupsFolder: Directory;
    /** A porta `BackupDirectory` sobre `backupsFolder`. */
    readonly backups: ExpoBackupDirectory;
}

/**
 * Monta os caminhos num lugar só, sobre `Paths.document` (o `filesDir` do Android, fora do
 * cache que o sistema limpa), em vez de usar o diretório padrão do `expo-sqlite`, para que o
 * banco, `backups/` e as marcas venham da mesma origem e nunca se separem — a abertura, a
 * rotação e a restauração precisam concordar sobre eles.
 *
 * @param fileName Nome do arquivo do banco; outro nome só no app de contrato e em testes.
 * @return A pasta, o arquivo do banco e a pasta de backups; nada é criado aqui.
 */
export function databaseLocation(fileName: string = DATABASE_FILE_NAME): ExpoDatabaseLocation {
    const folder = new Directory(Paths.document, 'SQLite');
    const backupsFolder = new Directory(folder, 'backups');
    return { folder, databaseFile: new File(folder, fileName), backupsFolder, backups: new ExpoBackupDirectory(backupsFolder) };
}

/** O banco aberto e a versão do SQLite do aparelho, para o log da abertura. */
export interface ExpoOpenedDatabase {
    readonly database: ExpoSqliteDatabase;
    readonly sqliteVersion: string;
}

/**
 * Abre o banco do app pela API síncrona do `expo-sqlite` e confere o SQLite antes de qualquer
 * migration. É o único módulo do pacote que carrega código nativo; a raiz de composição do
 * `apps/mobile` passa o resultado à sequência de abertura do `client`.
 *
 * @param location Onde o banco mora, de `databaseLocation`.
 * @return O banco aberto e a versão do SQLite.
 * @throws {UnsupportedSqliteError} Quando o SQLite do aparelho não tem o que o schema usa; a
 * conexão é fechada antes.
 */
export function openExpoDatabase(location: ExpoDatabaseLocation = databaseLocation()): ExpoOpenedDatabase {
    location.folder.create({ intermediates: true, idempotent: true });
    const database = ExpoSqliteDatabase.wrap(openDatabaseSync(location.databaseFile.name, {}, fileUriToPath(location.folder.uri)));
    try {
        return { database, sqliteVersion: assertSqliteCapabilities(database) };
    } catch (error: unknown) {
        database.close();
        throw error;
    }
}
