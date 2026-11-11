import { Directory, Paths } from 'expo-file-system';
import { openDatabaseSync } from 'expo-sqlite';
import { ExpoBackupDirectory, fileUriToPath } from './ExpoBackupDirectory.ts';
import { ExpoSqliteDatabase } from './ExpoSqliteDatabase.ts';
import { assertSqliteCapabilities } from './sqliteCapabilities.ts';

/** Nome do arquivo do banco no aparelho, o mesmo do desktop. */
export const DATABASE_FILE_NAME = 'finance.sqlite';

/** O banco aberto e a pasta de backups ao lado dele, prontos para `openDatabase` do núcleo. */
export interface ExpoDatabaseFiles {
    readonly database: ExpoSqliteDatabase;
    readonly backups: ExpoBackupDirectory;
    /** Versão do SQLite do aparelho, para o log da abertura. */
    readonly sqliteVersion: string;
}

/**
 * Abre o banco do app pela API síncrona do `expo-sqlite`, confere o SQLite e monta a pasta de
 * backups ao lado do arquivo. É o único módulo do pacote que carrega código nativo; a raiz de
 * composição do `apps/mobile` chama esta função e passa o resultado a `openDatabase` e
 * `createCore`. O diretório é montado aqui, sobre `Paths.document` (o `filesDir` do Android,
 * fora do cache que o sistema limpa), em vez de usar o padrão do `expo-sqlite`, para que o
 * banco e `backups/` venham da mesma origem e nunca se separem.
 *
 * @param fileName Nome do arquivo do banco; outro nome só no app de contrato e em testes.
 * @return O banco, a pasta de backups e a versão do SQLite.
 * @throws {UnsupportedSqliteError} Quando o SQLite do aparelho não tem o que o schema usa; a
 * conexão é fechada antes.
 */
export function openExpoDatabase(fileName: string = DATABASE_FILE_NAME): ExpoDatabaseFiles {
    const folder = new Directory(Paths.document, 'SQLite');
    folder.create({ intermediates: true, idempotent: true });
    const database = ExpoSqliteDatabase.wrap(openDatabaseSync(fileName, {}, fileUriToPath(folder.uri)));
    try {
        const sqliteVersion = assertSqliteCapabilities(database);
        const backups = new ExpoBackupDirectory(new Directory(folder, 'backups'));
        return { database, backups, sqliteVersion };
    } catch (error: unknown) {
        database.close();
        throw error;
    }
}
