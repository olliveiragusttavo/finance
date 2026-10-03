import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BetterSqliteDatabase, NodeBackupDirectory } from '@finance/sqlite-better';
import { describe, expect, it } from 'vitest';
import { MigrationBackupError, openDatabase, type BackupDirectory, type Database } from '../../src/index.ts';
import { embeddedMigrations } from '../../src/infrastructure/migrations/embedded.generated.ts';
import type { Migration } from '../../src/infrastructure/migrations/Migration.ts';
import { backupFileName, staleBackups } from '../../src/infrastructure/migrations/PreMigrationBackup.ts';
import { FixedClock } from '../support/adapters.ts';

const clock = new FixedClock('2026-10-02');
const EXPECTED_FILE = 'pre-v1-2026-10-02-120000.sqlite';

/**
 * Uma migration além das publicadas, para simular a atualização do app: sem ela o banco de
 * teste já nasce na última versão e não haveria o que migrar nem o que copiar.
 *
 * @param sql Corpo da migration; um SQL inválido simula a migration que falha no meio.
 * @return As migrations embutidas seguidas da versão nova.
 */
function withNextMigration(sql: string): readonly Migration[] {
    return [...embeddedMigrations, { version: embeddedMigrations.length + 1, name: 'next', sql }];
}

/**
 * @return Um banco em memória já na última versão publicada e com um perfil gravado — o dado
 * que o backup precisa preservar — e a pasta de backups numa pasta temporária real, porque o
 * `VACUUM INTO` grava em disco de verdade.
 */
function publishedDatabase(): { readonly database: Database; readonly backups: BackupDirectory; readonly folder: string } {
    const database: Database = BetterSqliteDatabase.open(':memory:');
    openDatabase(database, { backups: null, clock });
    database.run(
        `INSERT INTO profiles (id, name, type, currency, updated_at) VALUES ('00000000-0000-4000-8000-000000000001', 'Antes', 1, 'BRL', :now)`,
        { now: clock.now() },
    );
    const folder = join(mkdtempSync(join(tmpdir(), 'finance-backup-')), 'backups');
    const backups: BackupDirectory = new NodeBackupDirectory(folder);
    return { database, backups, folder };
}

describe('backup antes de migrar (backend-design §4.6)', () => {
    it('grava a cópia da versão anterior, com os dados de antes, e a informa no relatório', () => {
        const { database, backups, folder } = publishedDatabase();

        const report = openDatabase(database, { backups, clock, migrations: withNextMigration('CREATE TABLE extra (id INTEGER) STRICT;') });

        expect(report.backupFile).toBe(EXPECTED_FILE);
        expect(report.applied).toEqual([embeddedMigrations.length + 1]);
        const copy = BetterSqliteDatabase.open(join(folder, EXPECTED_FILE));
        expect(copy.get('PRAGMA user_version')).toEqual({ user_version: embeddedMigrations.length });
        expect(copy.get('SELECT name FROM profiles')).toEqual({ name: 'Antes' });
        expect(copy.get(`SELECT count(*) AS n FROM sqlite_schema WHERE name = 'extra'`)).toEqual({ n: 0 });
        copy.close();
    });

    it('não copia banco novo nem banco já em dia: não há o que preservar', () => {
        const fresh = BetterSqliteDatabase.open(':memory:');
        const folder = join(mkdtempSync(join(tmpdir(), 'finance-backup-')), 'backups');
        const backups = new NodeBackupDirectory(folder);

        expect(openDatabase(fresh, { backups, clock }).backupFile).toBeNull();
        expect(openDatabase(fresh, { backups, clock }).backupFile).toBeNull();
        expect(backups.list()).toEqual([]);
    });

    it('migration que falha deixa o banco na versão anterior e o backup disponível para restaurar', () => {
        const { database, backups } = publishedDatabase();

        expect(() => openDatabase(database, { backups, clock, migrations: withNextMigration('CREATE TABLE profiles (x INTEGER);') })).toThrow();

        expect(database.get('PRAGMA user_version')).toEqual({ user_version: embeddedMigrations.length });
        expect(backups.list()).toEqual([EXPECTED_FILE]);
    });

    it('sem backup não há migration: a falha na cópia mantém o banco intacto', () => {
        const { database, backups } = publishedDatabase();
        // Um arquivo não vazio com o mesmo nome faz o VACUUM INTO recusar a gravação.
        writeFileSync(backups.pathOf(EXPECTED_FILE), 'ocupado');

        expect(() => openDatabase(database, { backups, clock, migrations: withNextMigration('CREATE TABLE extra (id INTEGER) STRICT;') }))
            .toThrow(MigrationBackupError);

        expect(database.get('PRAGMA user_version')).toEqual({ user_version: embeddedMigrations.length });
    });

    it('guarda só as três cópias mais recentes e preserva arquivos que não são dela', () => {
        const { database, backups, folder } = publishedDatabase();
        for (const name of ['pre-v1-2026-01-01-080000.sqlite', 'pre-v1-2026-02-01-080000.sqlite', 'pre-v1-2026-03-01-080000.sqlite', 'meu-backup.sqlite']) {
            writeFileSync(backups.pathOf(name), 'x');
        }

        openDatabase(database, { backups, clock, migrations: withNextMigration('CREATE TABLE extra (id INTEGER) STRICT;') });

        expect(readdirSync(folder).sort()).toEqual([
            'meu-backup.sqlite',
            'pre-v1-2026-02-01-080000.sqlite',
            'pre-v1-2026-03-01-080000.sqlite',
            EXPECTED_FILE,
        ]);
    });
});

describe('nome e rotação dos backups', () => {
    it('nomeia pela versão copiada e pelo instante UTC, para não colidir no mesmo dia', () => {
        expect(backupFileName(7, clock.now())).toBe('pre-v7-2026-10-02-120000.sqlite');
    });

    it('ordena pelo instante, e não pelo texto: pre-v10 é mais novo que pre-v9', () => {
        const files = [
            'pre-v9-2026-01-01-000000.sqlite',
            'pre-v9-2026-02-01-000000.sqlite',
            'pre-v9-2026-03-01-000000.sqlite',
            'pre-v10-2026-04-01-000000.sqlite',
        ];
        expect(staleBackups(files)).toEqual(['pre-v9-2026-01-01-000000.sqlite']);
    });
});
