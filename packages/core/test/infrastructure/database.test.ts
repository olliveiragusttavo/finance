import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BetterSqliteDatabase } from '@finance/sqlite-better';
import { describe, expect, it } from 'vitest';
import { MigrationFailedError, openDatabase, SchemaNewerThanAppError, type Database } from '../../src/index.ts';
import { embeddedMigrations } from '../../src/infrastructure/migrations/embedded.generated.ts';
import { FixedClock } from '../support/adapters.ts';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', '..', '..', 'db', 'migrations');
const clock = new FixedClock('2026-01-01');

/**
 * @return Um banco em memória novo, tipado pela porta: a atribuição é a verificação, em
 * tempo de compilação, de que o adaptador cumpre o contrato `Database`.
 */
function freshDatabase(): Database {
    const database: Database = BetterSqliteDatabase.open(':memory:');
    return database;
}

describe('contrato da porta Database (backend-design §5.10)', () => {
    it('desfaz a transação inteira quando o trabalho lança exceção', () => {
        const database = freshDatabase();
        database.exec('CREATE TABLE t (v INTEGER) STRICT');
        expect(() => database.transaction(() => {
            database.run('INSERT INTO t (v) VALUES (:v)', { v: 1 });
            throw new Error('falha no meio');
        })).toThrow('falha no meio');
        expect(database.get('SELECT count(*) AS n FROM t')).toEqual({ n: 0 });
    });

    it('devolve REAL como number e NULL como null', () => {
        const database = freshDatabase();
        expect(database.get('SELECT 1.5 AS r, NULL AS n, 2 AS i')).toEqual({ r: 1.5, n: null, i: 2 });
    });

    it('respeita STRICT: rejeita texto não numérico em coluna REAL', () => {
        const database = freshDatabase();
        database.exec('CREATE TABLE t (v REAL) STRICT');
        expect(() => database.run('INSERT INTO t (v) VALUES (:v)', { v: 'abc' })).toThrow();
    });
});

describe('abertura do banco (backend-design §4.5)', () => {
    it('liga foreign_keys: um hard delete de perfil cascateia de verdade (database-design §3.2)', () => {
        const database = freshDatabase();
        openDatabase(database, { backups: null, clock });
        expect(database.get('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });

        const now = '2026-01-01 00:00:00';
        const profile = '00000000-0000-4000-8000-000000000001';
        const account = '00000000-0000-4000-8000-000000000002';
        database.run(`INSERT INTO profiles (id, name, type, currency, updated_at) VALUES (:profile, 'P', 1, 'BRL', :now)`, { profile, now });
        database.run(
            `INSERT INTO accounts (id, profile_id, name, balance, projected_balance, currency, type, updated_at)
            VALUES (:account, :profile, 'C', 0, 0, 'BRL', 1, :now)`,
            { account, profile, now },
        );
        database.run('DELETE FROM profiles WHERE id = :profile', { profile });
        expect(database.get('SELECT count(*) AS n FROM accounts')).toEqual({ n: 0 });
    });

    it('aplica as migrations uma vez e registra a versão em user_version', () => {
        const database = freshDatabase();
        const first = openDatabase(database, { backups: null, clock });
        expect(first).toEqual({ fromVersion: 0, toVersion: embeddedMigrations.length, applied: embeddedMigrations.map((m) => m.version), backupFile: null });

        const second = openDatabase(database, { backups: null, clock });
        expect(second.applied).toEqual([]);
    });

    it('recusa abrir um banco mais novo que o app (backend-design §4.8)', () => {
        const database = freshDatabase();
        openDatabase(database, { backups: null, clock });
        database.exec('PRAGMA user_version = 999');
        expect(() => openDatabase(database, { backups: null, clock })).toThrow(SchemaNewerThanAppError);
    });

    it('erro de SQL numa migration vira MigrationFailedError e mantém as anteriores', () => {
        const database = freshDatabase();
        const migrations = [
            { version: 1, name: '0001_inicial', sql: 'CREATE TABLE notes (id INTEGER PRIMARY KEY) STRICT;' },
            { version: 2, name: '0002_quebrada', sql: 'INSERT INTO tabela_que_nao_existe VALUES (1);' },
        ];
        expect(() => openDatabase(database, { backups: null, clock, migrations })).toThrow(MigrationFailedError);
        expect(database.get('PRAGMA user_version')).toEqual({ user_version: 1 });
    });

    it('as migrations embutidas são idênticas aos arquivos de db/migrations', () => {
        const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')).sort();
        expect(embeddedMigrations.map((migration) => `${migration.name}.sql`)).toEqual(files);
        for (const migration of embeddedMigrations) {
            expect(migration.sql, `${migration.name} desatualizada: rode pnpm embed:migrations`).toBe(
                readFileSync(join(MIGRATIONS_DIR, `${migration.name}.sql`), 'utf8'),
            );
        }
    });
});

describe('imutabilidade das migrations (backend-design §4.3)', () => {
    /**
     * Lê o lock sem passar pelo script que o grava, para que um bug no script não aprove a
     * si mesmo.
     *
     * @return O hash travado de cada arquivo, pelo nome.
     */
    function lockedHashes(): ReadonlyMap<string, string> {
        const lines = readFileSync(join(MIGRATIONS_DIR, 'checksums.lock'), 'utf8').split('\n').filter((line) => line !== '');
        return new Map(lines.map((line) => {
            const [hash = '', file = ''] = line.split('  ');
            return [file, hash];
        }));
    }

    it('toda migration está travada e nenhuma travada foi editada ou removida', () => {
        const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')).sort();
        const locked = lockedHashes();

        expect([...locked.keys()].sort(), 'checksums.lock desatualizado: rode pnpm embed:migrations').toEqual(files);
        for (const file of files) {
            const hash = createHash('sha256').update(readFileSync(join(MIGRATIONS_DIR, file))).digest('hex');
            expect(hash, `${file} foi editada depois de publicada: corrija com uma migration nova`).toBe(locked.get(file));
        }
    });
});
